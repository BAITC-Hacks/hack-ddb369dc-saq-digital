import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { ArrowRight, CheckCircle, CircleNotch, Heart, List, MagnifyingGlass, MapPin, Package, Phone, ShoppingCart, Sparkle, UserCircle, WarningCircle, X } from '@phosphor-icons/react'
import { addToCart, ApiError, frontendCartUrl, getCart, searchCatalog } from './lib/api'
import { backendSearchQuery, storedLanguage, translations } from './i18n'
import type { Language, UiText } from './i18n'
import type { ApiProduct, CartSnapshot } from './types'
import { createChat, HISTORY_KEY, loadChatHistory, saveChatHistory, type Chat, type ChatTurn, type UiError } from './lib/chatHistory'
import { quantityError, stepQuantity } from './lib/quantity'
import { safeLink } from './lib/links'
import { ProductEvidence } from './ProductEvidence'
import { UploadPanel, type UploadState } from './UploadPanel'
import { uploadText } from './uploadText'

const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 })

function uiError(error: unknown): UiError {
  if (error instanceof ApiError) {
    if (error.code === 'REQUEST_TIMEOUT') return { key: 'requestTimeout' }
    if (error.code === 'NETWORK_ERROR') return { key: 'serverUnavailable' }
    return { key: 'requestFailed', detail: error.message }
  }
  return { key: 'requestFailed' }
}

function ErrorText({ error, t, search = false }: { error: UiError; t: UiText; search?: boolean }) {
  // The current API supplies Russian prose; interface errors use translation keys.
  return <>{search && error.key === 'requestTimeout' ? t.searchTimeout : t[error.key]}{error.detail && <> <span lang="ru">{error.detail}</span></>}</>
}

function Suggestion({ product, quantity, exact, reason, choose, t, busy, historical = false }: {
  product: ApiProduct
  quantity: number
  exact: boolean
  reason?: string
  choose: (product: ApiProduct, quantity: number, trigger: HTMLButtonElement) => void
  t: UiText
  busy: boolean
  historical?: boolean
}) {
  const available = quantityError(String(quantity), product) === null
  const canAdjust = stepQuantity(String(quantity), product, -1) !== null
  const specifications = [
    product.poles ? `${product.poles}P` : null,
    product.curve && product.amps ? `${product.curve}${product.amps}` : null,
    product.breakingCapacityKa ? `${product.breakingCapacityKa} kA` : null,
  ].filter(Boolean)

  return <article className="suggestion">
    <div className="suggestion-top">
      <span className={exact ? 'tag tag-muted' : 'tag'}>{exact ? t.exactMatch : t.compatible}</span>
      <span className={available ? 'stock ok' : 'stock out'}><i />{t.inStock}: {product.stock} {t.piece}</span>
    </div>
    <p className="sku">{product.sku}</p>
    <h3 lang="ru">{product.name}</h3>
    {specifications.length > 0 && <p className="specs">{specifications.join(' · ')}</p>}
    {exact && reason && <p className="reason">{reason}</p>}
    {product.minimumOrderQuantity && quantity % product.minimumOrderQuantity !== 0 && <p className="reason">{t.multipleOf} {product.minimumOrderQuantity}.</p>}
    <ProductEvidence product={product} alternative={!exact} alternativeReason={exact ? undefined : reason} t={t} />
    <footer>
      <strong>{money.format(product.priceKzt)}</strong>
      <button type="button" disabled={historical || !canAdjust} aria-disabled={historical || busy || !canAdjust} onClick={(event) => { if (!historical && !busy && canAdjust) choose(product, quantity, event.currentTarget) }}>
        {historical ? t.previousResult : available ? t.choose : canAdjust ? t.adjustQuantity : t.unavailable} <ArrowRight size={15} weight="bold" />
      </button>
    </footer>
  </article>
}

type Confirmation = { product: ApiProduct; quantity: number; confirmationId: string; sourceExpiresAt?: number }

type ReadingModeProps = { readingMode: boolean; onReadingModeChange: () => void }
const readingModeKey = 'ekt-reading-mode'
const chatOpenKey = 'ekt-assistant-open'

function storedReadingMode(): boolean {
  try { return window.localStorage.getItem(readingModeKey) === 'true' } catch { return false }
}

function storedChatOpen(): boolean {
  try { return window.sessionStorage.getItem(chatOpenKey) === 'true' } catch { return false }
}

function ReadingModeToggle({ readingMode, onReadingModeChange, t }: ReadingModeProps & { t: UiText }) {
  return <button className="reading-toggle" type="button" aria-label={t.readingMode} aria-pressed={readingMode} onClick={onReadingModeChange}>
    {t.readingMode}<span aria-hidden="true">{readingMode ? t.modeEnabled : t.modeDisabled}</span>
  </button>
}

function Widget({ onCartChanged, language, onLanguageChange, readingMode, onReadingModeChange, conversation, setConversation, chats, chatId, query, setQuery, onSelectChat, onNewChat, onDeleteChats, storageError, historyConflict, upload, setUpload, uploadNames }: ReadingModeProps & {
  onCartChanged: (cart: CartSnapshot) => void
  language: Language | null
  onLanguageChange: (language: Language) => void
  conversation: ChatTurn[]
  setConversation: Dispatch<SetStateAction<ChatTurn[]>>
  chats: Chat[]
  chatId: string
  query: string
  setQuery: (query: string) => void
  onSelectChat: (id: string) => void
  onNewChat: () => void
  onDeleteChats: (id: string) => boolean
  storageError: boolean
  historyConflict: boolean
  upload: UploadState
  setUpload: Dispatch<SetStateAction<UploadState>>
  uploadNames: Record<string, string>
}) {
  const t = translations[language ?? 'ru']
  // Keep a fresh visit unobstructed; remember an explicit choice only for this tab session.
  const [open, setOpen] = useState(storedChatOpen)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const deleteCancelRef = useRef<HTMLButtonElement>(null)
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null)
  const historyHeadingRef = useRef<HTMLHeadingElement>(null)
  const historyButtonRef = useRef<HTMLButtonElement>(null)
  const historyReturnFocus = useRef<'composer' | 'history' | null>(null)
  const messagesRef = useRef<HTMLElement>(null)
  const followNewest = useRef(true)
  const latestTurn = conversation.at(-1)
  const loading = latestTurn?.status === 'loading'
  const searchInFlight = useRef(false)
  const uploadBusy = upload.phase === 'uploading' || upload.phase === 'deleting'
  const [retryableQuestions, setRetryableQuestions] = useState<Record<string, string>>({})
  const [error, setError] = useState<UiError | null>(null)
  const [selected, setSelected] = useState<Confirmation | null>(null)
  const [quantityDraft, setQuantityDraft] = useState('')
  const quantityInputRef = useRef<HTMLInputElement>(null)
  const [confirmationVisible, setConfirmationVisible] = useState(false)
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [confirmError, setConfirmError] = useState<UiError | null>(null)
  const [unresolvedCart, setUnresolvedCart] = useState(false)
  const [confirmAttempted, setConfirmAttempted] = useState(false)
  const [selectionExpired, setSelectionExpired] = useState(false)
  const confirmationInFlight = useRef(false)
  const retryConfirmations = useRef<Record<string, string>>({})
  const widgetRef = useRef<HTMLElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const firstLanguageRef = useRef<HTMLButtonElement>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const confirmationRef = useRef<HTMLElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const reviewRequestRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLButtonElement | null>(null)
  const restoreConfirmationFocus = useRef(false)
  // A retained conversation means the widget is remounting after the cart route.
  const restoreLauncherFocus = useRef(conversation.length > 0 && !open)
  const openedFromLauncher = useRef(conversation.length > 0)

  const setChatOpen = (nextOpen: boolean) => {
    setOpen(nextOpen)
    try { window.sessionStorage.setItem(chatOpenKey, String(nextOpen)) } catch { /* The chat remains usable without session storage. */ }
  }

  useEffect(() => { if (deleteTarget) deleteCancelRef.current?.focus() }, [deleteTarget])
  useEffect(() => {
    setSelectionExpired(false)
    if (!selected?.sourceExpiresAt || confirmAttempted) return
    const timer = setTimeout(() => setSelectionExpired(true), Math.max(0, selected.sourceExpiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [selected, confirmAttempted])
  const cancelDeletion = () => {
    setDeleteTarget(null)
    deleteTriggerRef.current?.focus()
  }
  const deleteChats = () => {
    if (!deleteTarget || loading || confirmationInFlight.current || unresolvedCart) return
    if (!onDeleteChats(deleteTarget)) return
    setDeleteTarget(null)
    historyHeadingRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    if (historyOpen) historyHeadingRef.current?.focus()
    else if (historyReturnFocus.current) {
      const target = historyReturnFocus.current === 'history' ? historyButtonRef.current
        : language || conversation.length > 0 ? messageRef.current : firstLanguageRef.current
      target?.focus()
      historyReturnFocus.current = null
    }
  }, [historyOpen, chatId, open])

  useEffect(() => {
    if (open && !historyOpen && followNewest.current && messagesRef.current) {
      // Scroll only the transcript, never the page or a focused composer.
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [conversation, historyOpen, open])

  useEffect(() => {
    if (open && openedFromLauncher.current) {
      if (language || conversation.length > 0) messageRef.current?.focus()
      else firstLanguageRef.current?.focus()
      openedFromLauncher.current = false
    } else if (!open && restoreLauncherFocus.current) {
      launcherRef.current?.focus()
      restoreLauncherFocus.current = false
    }
  }, [open, language])

  useEffect(() => {
    if (selected && confirmationVisible) {
      if (confirmationInFlight.current) confirmationRef.current?.focus()
      else if (confirmButtonRef.current?.disabled) quantityInputRef.current?.focus()
      else confirmButtonRef.current?.focus()
    } else if (restoreConfirmationFocus.current) {
      const target = returnFocusRef.current?.isConnected && !returnFocusRef.current.disabled ? returnFocusRef.current : reviewRequestRef.current ?? messageRef.current
      target?.focus()
      restoreConfirmationFocus.current = false
    }
  }, [selected, confirmationVisible])

  useEffect(() => {
    if (!selected || !confirmationVisible || !confirmAttempted) return
    if (confirmLoading) confirmationRef.current?.focus()
    else confirmButtonRef.current?.focus()
  }, [selected, confirmationVisible, confirmAttempted, confirmLoading])

  useEffect(() => {
    if (!open || (selected && confirmationVisible)) return
    const onFocusOutside = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && !widgetRef.current?.contains(event.target)) {
        // Keep the page's focused control visible and leave focus where the user moved it.
        setChatOpen(false)
      }
    }
    document.addEventListener('focusin', onFocusOutside)
    return () => document.removeEventListener('focusin', onFocusOutside)
  }, [open, selected, confirmationVisible])

  const closeChat = () => {
    setDeleteTarget(null)
    restoreLauncherFocus.current = true
    historyReturnFocus.current = null
    setHistoryOpen(false)
    setChatOpen(false)
  }

  const openChat = () => {
    openedFromLauncher.current = true
    setChatOpen(true)
  }

  const useSuggestion = (value: string) => {
    setQuery(value)
    setError(null)
    messageRef.current?.focus()
  }

  const closeConfirmation = () => {
    restoreConfirmationFocus.current = true
    setConfirmationVisible(false)
    if (!confirmAttempted) setSelected(null)
  }
  const closeHistory = () => {
    setDeleteTarget(null)
    historyReturnFocus.current = 'history'
    setHistoryOpen(false)
  }
  const changeChat = (id?: string) => {
    if (loading || searchInFlight.current || confirmationInFlight.current || confirmationVisible || uploadBusy) return
    setError(null)
    setDeleteTarget(null)
    historyReturnFocus.current = 'composer'
    followNewest.current = true
    setHistoryOpen(false)
    const reuseActive = !id && conversation.length === 0 && !query.trim() && upload.phase === 'idle'
    if (id) onSelectChat(id)
    else if (!reuseActive) onNewChat()
    // Handles reselecting the already active/empty chat without a state change.
    if (!historyOpen && (id === chatId || reuseActive)) {
      const target = language || conversation.length > 0 ? messageRef.current : firstLanguageRef.current
      target?.focus()
      historyReturnFocus.current = null
    }
  }

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (deleteTarget) {
        event.preventDefault()
        cancelDeletion()
      } else if (selected && confirmationVisible) {
        event.preventDefault()
        closeConfirmation()
      } else if (open && historyOpen) {
        event.preventDefault()
        closeHistory()
      } else if (open) {
        event.preventDefault()
        if (widgetRef.current?.contains(document.activeElement)) closeChat()
        else setChatOpen(false)
      }
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [open, selected, confirmationVisible, confirmAttempted, historyOpen, deleteTarget])

  const submit = async (value = query, retryTurn?: ChatTurn) => {
    if (loading || searchInFlight.current) return
    if (retryTurn && (retryTurn.id !== latestTurn?.id || retryTurn.restored || retryTurn.status !== 'error' || retryableQuestions[chatId] !== retryTurn.id)) return
    const message = (retryTurn?.query ?? value).trim()
    const messageLanguage = retryTurn?.language ?? language ?? 'ru'
    if (!message) {
      setError({ key: 'shortQuery' })
      messageRef.current?.focus()
      return
    }
    if (message.length > 4000) {
      setError({ key: 'longQuery' })
      messageRef.current?.focus()
      return
    }
    searchInFlight.current = true
    followNewest.current = true
    const id = crypto.randomUUID()
    if (retryTurn) messageRef.current?.focus()
    else setQuery('')
    setError(null)
    setConversation((turns) => [...turns, { id, query: message, language: messageLanguage, status: 'loading' }])
    try {
      const response = await searchCatalog(backendSearchQuery(message, messageLanguage), chatId)
      setConversation((turns) => turns.map((turn) => turn.id === id ? { ...turn, status: 'complete', response } : turn))
    } catch (caught) {
      const failure = uiError(caught)
      if (!(caught instanceof ApiError) || caught.status === 0 || caught.status >= 500) {
        setRetryableQuestions((questions) => ({ ...questions, [chatId]: id }))
      }
      setConversation((turns) => turns.map((turn) => turn.id === id ? { ...turn, status: 'error', error: failure } : turn))
    } finally {
      searchInFlight.current = false
    }
  }

  const choose = (product: ApiProduct, quantity: number, trigger: HTMLButtonElement, sourceExpiresAt?: number) => {
    if (confirmationInFlight.current || unresolvedCart) return
    if (sourceExpiresAt !== undefined && sourceExpiresAt <= Date.now()) return
    const retryId = retryConfirmations.current[JSON.stringify([product.sku, quantity])]
    setConfirmError(null)
    setConfirmAttempted(Boolean(retryId))
    returnFocusRef.current = trigger
    setSelected({ product, quantity, confirmationId: retryId ?? crypto.randomUUID(), sourceExpiresAt })
    setQuantityDraft(String(quantity))
    setConfirmationVisible(true)
  }

  const keepConfirmationFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'))
    const first = buttons[0]
    const last = buttons.at(-1)
    if (!first || !last) {
      event.preventDefault()
      confirmationRef.current?.focus()
      return
    }
    if (document.activeElement === event.currentTarget) {
      event.preventDefault()
      const target = event.shiftKey ? last : first
      target.focus()
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const confirm = async () => {
    if (!selected || confirmationInFlight.current || quantityError(quantityDraft, selected.product)) return
    if (!confirmAttempted && selected.sourceExpiresAt !== undefined && selected.sourceExpiresAt <= Date.now()) {
      setSelectionExpired(true)
      return
    }
    const quantity = confirmAttempted ? selected.quantity : Number(quantityDraft)
    const retryKey = JSON.stringify([selected.product.sku, quantity])
    const confirmationId = retryConfirmations.current[retryKey] ?? (selected.quantity === quantity ? selected.confirmationId : crypto.randomUUID())
    const purchase = { ...selected, quantity, confirmationId }
    confirmationInFlight.current = true
    setConfirmLoading(true)
    setConfirmAttempted(true)
    setConfirmError(null)
    setSelected(purchase)
    retryConfirmations.current = { ...retryConfirmations.current, [retryKey]: confirmationId }
    try {
      const cart = await addToCart(purchase.product.sku, purchase.quantity, purchase.confirmationId)
      frontendCartUrl(cart.cartUrl)
      onCartChanged(cart)
      setUnresolvedCart(false)
      setSelected(null)
    } catch (caught) {
      const unresolved = !(caught instanceof ApiError) || caught.status === 0 || caught.status >= 500
      setUnresolvedCart(unresolved)
      if (caught instanceof ApiError && caught.status === 409 && ['INSUFFICIENT_STOCK', 'INVALID_ORDER_MULTIPLE'].includes(caught.code ?? '')) {
        // Retain this attempt for an identical retry; a fresh selection may
        // change quantity after the server definitively rejected the purchase.
        const { [retryKey]: _discarded, ...remainingConfirmations } = retryConfirmations.current
        retryConfirmations.current = remainingConfirmations
      }
      setConfirmError(uiError(caught))
    } finally {
      confirmationInFlight.current = false
      setConfirmLoading(false)
    }
  }

  const navigationBusy = loading || confirmLoading || confirmationVisible || uploadBusy
  const quantityIssue = selected ? quantityError(quantityDraft, selected.product) : null
  const quantityLocked = confirmAttempted || confirmLoading
  const lowerQuantity = selected ? stepQuantity(quantityDraft, selected.product, -1) : null
  const higherQuantity = selected ? stepQuantity(quantityDraft, selected.product, 1) : null
  const editQuantity = (value: string) => {
    if (confirmAttempted || confirmationInFlight.current) return
    setQuantityDraft(value)
  }

  return <>
    {open && <aside ref={widgetRef} className={`widget${readingMode ? ' reading-mode' : ''}`} aria-labelledby="ekt-chat-title" role="dialog" aria-modal="false" lang={language ?? 'ru'}>
      <header><div className="agent"><span aria-hidden="true"><Sparkle size={17} weight="regular" /></span><div><strong id="ekt-chat-title">{t.assistant}</strong><small>{t.assistantSubtitle}</small></div></div><button className="icon" type="button" aria-label={t.closeChat} onClick={closeChat}><X size={19} /></button></header>
      <ReadingModeToggle readingMode={readingMode} onReadingModeChange={onReadingModeChange} t={t} />
      <nav className="chat-navigation" aria-label={t.chatNavigation}>
        <button ref={historyButtonRef} type="button" disabled={navigationBusy} aria-expanded={historyOpen} aria-controls="ekt-chat-history" onClick={() => { if (historyOpen) closeHistory(); else setHistoryOpen(true) }}>{t.chatHistory}</button>
        <button type="button" disabled={navigationBusy} onClick={() => changeChat()}>{t.newChat}</button>
      </nav>
      {historyConflict ? <div className="history-sync-notice" role="status"><span>{t.historyConflict}</span><span id="ekt-history-refresh-warning" className="visually-hidden">{t.refreshHistoryWarning}</span><button type="button" aria-describedby="ekt-history-refresh-warning" onClick={() => window.location.reload()}>{t.refreshHistory}</button></div> : storageError && <p className="history-warning" role="status">{t.historyStorageError}</p>}
      {historyOpen ? <section id="ekt-chat-history" className="chat-history" aria-labelledby="ekt-history-title">
        <h2 id="ekt-history-title" ref={historyHeadingRef} tabIndex={-1}>{t.chatHistory}</h2>
        <p>{t.historyLifetime}</p>
        <ul className="chat-list" aria-label={t.dialogues}>{chats.map((chat) => {
          const firstTurn = chat.turns[0]
          const title = firstTurn?.query ?? (chat.draft.trim() || uploadNames[chat.id] || t.untitledChat)
          return <li key={chat.id}><button type="button" aria-label={title} aria-current={chat.id === chatId ? 'true' : undefined} onClick={() => changeChat(chat.id)}>
            <span lang={firstTurn?.language}>{title}</span>{chat.id === chatId && <small>{t.currentChat}</small>}
          </button><button className="delete-chat" type="button" disabled={navigationBusy || unresolvedCart || historyConflict} aria-label={`${t.deleteChat}: ${title}`} onClick={(event) => { deleteTriggerRef.current = event.currentTarget; setDeleteTarget(chat.id) }}>{t.deleteChat}</button></li>
        })}</ul>
        <button className="history-back" type="button" disabled={navigationBusy || unresolvedCart || historyConflict} onClick={(event) => { deleteTriggerRef.current = event.currentTarget; setDeleteTarget('all') }}>{t.clearHistory}</button>
        {deleteTarget && <section className="history-delete" aria-labelledby="ekt-delete-title">
          <h3 id="ekt-delete-title">{deleteTarget === 'all' ? t.clearHistoryQuestion : t.deleteChatQuestion}</h3>
          {deleteTarget !== 'all' && <p>{chats.find((chat) => chat.id === deleteTarget)?.turns[0]?.query || chats.find((chat) => chat.id === deleteTarget)?.draft || t.untitledChat}</p>}
          <p>{t.deleteHistoryWarning}</p>
          <div><button ref={deleteCancelRef} className="history-back" type="button" onClick={cancelDeletion}>{t.cancel}</button><button className="history-back" type="button" onClick={deleteChats}>{t.deleteConfirm}</button></div>
        </section>}
        <button className="history-back" type="button" onClick={closeHistory}>{t.backToChat}</button>
      </section> : <>
      <section className="messages" ref={messagesRef} onScroll={(event) => {
        const panel = event.currentTarget
        if (panel.scrollHeight > panel.clientHeight) followNewest.current = panel.scrollHeight - panel.clientHeight - panel.scrollTop < 80
      }}>
        {conversation.some((turn) => turn.restored) && <p className="history-note">{t.restoredHistoryNote}</p>}
        <div className="message assistant"><small>{t.assistant}</small>{language ? <p>{t.greeting}</p> : <p><span lang="ru">Здравствуйте! Выберите язык для общения.</span><br /><span lang="kk">Сәлеметсіз бе! Қарым-қатынас тілін таңдаңыз.</span></p>}<div className="language-options" role="group" aria-label={t.languageLabel}><button ref={firstLanguageRef} type="button" lang="ru" aria-pressed={language === 'ru'} onClick={() => onLanguageChange('ru')}>Русский</button><button type="button" lang="kk" aria-pressed={language === 'kk'} onClick={() => onLanguageChange('kk')}>Қазақша</button></div>{language && conversation.length === 0 && <div className="starter-prompts"><p>{t.suggestionsHeading}</p><button type="button" onClick={() => useSuggestion(t.demoQuery)}>{t.productSuggestion}<ArrowRight size={14} aria-hidden="true" /></button><button type="button" onClick={() => useSuggestion(t.termsQuery)}>{t.termsSuggestion}<ArrowRight size={14} aria-hidden="true" /></button></div>}</div>
        <div role="log" aria-label={t.conversationHistory} aria-live="polite" aria-relevant="additions text" aria-atomic="false">
          {conversation.map((turn) => {
            const result = turn.response
            const historical = Boolean(turn.restored) || turn.id !== latestTurn?.id
            const quantity = result?.quantity ?? result?.filters?.quantity ?? 1
            const sourceHref = safeLink(result?.sourceUrl)
            return <div className="conversation-turn" key={turn.id}>
              <div className="message customer"><small>{t.you}</small><p lang={turn.language}>{turn.query}</p></div>
              {result && <>
                <div className="message assistant"><small>{t.assistant}</small><p lang="ru">{result.answer}</p>{sourceHref && <a className="source-link" href={sourceHref} target="_blank" rel="noreferrer">{t.source}</a>}</div>
                {historical && (result.exactMatch || result.alternatives.length > 0) && <p className="history-note">{t.previousResultNote}</p>}
                {result.exactMatch && <Suggestion product={result.exactMatch.product} quantity={quantity} exact reason={result.exactMatch.canFulfill ? undefined : t.insufficientStock} choose={choose} t={t} busy={confirmLoading || unresolvedCart} historical={historical} />}
                {result.alternatives.map(({ product, reason }) => <Suggestion key={product.sku} product={product} quantity={quantity} exact={false} reason={reason} choose={choose} t={t} busy={confirmLoading || unresolvedCart} historical={historical} />)}
                {!result.exactMatch && result.alternatives.length === 0 && !['purchase_terms', 'conversation'].includes(result.intent) && <div className="empty-result"><Package size={23} aria-hidden="true" /> {t.noResults}</div>}
              </>}
              {turn.status === 'loading' && <div className="loading"><CircleNotch className="spin" size={17} aria-hidden="true" /> {t.searching}</div>}
              {turn.error && <p className="error" role={historical ? undefined : 'alert'}><WarningCircle size={15} aria-hidden="true" /><span><ErrorText error={turn.error} t={t} search /></span></p>}
              {!historical && turn.status === 'error' && retryableQuestions[chatId] === turn.id && <button className="question-retry" type="button" disabled={loading || confirmLoading || confirmationVisible} onClick={() => void submit(turn.query, turn)}>{t.retryQuestion}</button>}
            </div>
          })}
        </div>
        <UploadPanel key={chatId} state={upload} onChange={setUpload} onChoose={(product, quantity, trigger) => choose(product, quantity, trigger, upload.job ? Date.parse(upload.job.expiresAt) : undefined)} disabled={loading || confirmLoading || unresolvedCart || confirmationVisible} language={language} />
      </section>
      {selected && confirmAttempted && !confirmationVisible && <div className="pending-cart">
        <p role="status">{confirmLoading ? t.pendingCart : t.cartNeedsReview}</p>
        <p>{selected.product.sku} · {selected.quantity} {t.piece}</p>
        {unresolvedCart && <p>{t.resolveCartFirst}</p>}
        <button ref={reviewRequestRef} type="button" onClick={() => setConfirmationVisible(true)}>{t.reviewCartRequest}</button>
      </div>}
      <form className="composer" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <label htmlFor="ekt-message">{t.messageLabel}</label>
        <textarea id="ekt-message" ref={messageRef} maxLength={4000} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? 'ekt-message-error' : undefined} value={query} onChange={(event) => { setQuery(event.target.value); if (error) setError(null) }} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void submit()
          }
        }} placeholder={t.messagePlaceholder} rows={2} />
        {error && <p id="ekt-message-error" className="error" role="alert"><WarningCircle size={15} weight="fill" aria-hidden="true" /><span><ErrorText error={error} t={t} /></span></p>}
        <div><button className="send" type="submit" disabled={loading} aria-label={t.send}>{loading ? <CircleNotch className="spin" size={17} aria-hidden="true" /> : t.send}</button></div>
      </form>
      </>}
    </aside>}
    {!open && <button ref={launcherRef} className={`fab${readingMode ? ' reading-mode' : ''}`} type="button" aria-label={t.openChat} onClick={openChat} lang={language ?? 'ru'}><Sparkle size={19} weight="regular" aria-hidden="true" /> {t.askAssistant}</button>}
    {selected && confirmationVisible && <div className="shade" role="presentation"><section ref={confirmationRef} className={`confirm${readingMode ? ' reading-mode' : ''}`} role="dialog" aria-modal="true" aria-labelledby="ekt-confirm-title" aria-describedby={confirmAttempted ? 'ekt-confirm-status' : undefined} tabIndex={-1} onKeyDown={keepConfirmationFocus} lang={language ?? 'ru'}>
      <button className="icon close" type="button" aria-label={t.closeConfirmation} onClick={closeConfirmation}><X size={19} /></button>
      <span className="confirm-icon"><CheckCircle size={28} weight="fill" /></span><p className="eyebrow">{t.explicitConfirmation}</p><h2 id="ekt-confirm-title">{t.addToCart}</h2>
      <p lang="ru">{selected.product.name}<br /><small>{selected.product.sku}</small></p>
      <div className="quantity-editor">
        <label htmlFor="ekt-cart-quantity">{t.quantity}</label>
        <div className="quantity-controls">
          <button type="button" aria-label={t.decreaseQuantity} disabled={quantityLocked || lowerQuantity === null || lowerQuantity >= Number(quantityDraft)} onClick={() => lowerQuantity !== null && editQuantity(String(lowerQuantity))}>−</button>
          <input ref={quantityInputRef} id="ekt-cart-quantity" type="number" inputMode="numeric" min={selected.product.minimumOrderQuantity ?? 1} max={selected.product.stock} step={selected.product.minimumOrderQuantity ?? 1} value={quantityDraft} disabled={quantityLocked} aria-invalid={Boolean(quantityIssue)} aria-describedby={`ekt-quantity-limits${quantityIssue ? ' ekt-quantity-error' : ''}${quantityLocked ? ' ekt-quantity-lock' : ''}`} onChange={(event) => editQuantity(event.target.value)} />
          <button type="button" aria-label={t.increaseQuantity} disabled={quantityLocked || higherQuantity === null || higherQuantity <= Number(quantityDraft)} onClick={() => higherQuantity !== null && editQuantity(String(higherQuantity))}>+</button>
        </div>
        <p id="ekt-quantity-limits">{t.inStock}: {selected.product.stock} {t.piece} · {t.multipleOf} {selected.product.minimumOrderQuantity ?? 1}. {t.stockRechecked}</p>
        {quantityIssue && <p id="ekt-quantity-error" className="confirm-error" role="alert">{t[quantityIssue]}</p>}
        {quantityLocked && <p id="ekt-quantity-lock">{t.quantityLocked}</p>}
      </div>
      <div className="total" aria-live="polite" aria-atomic="true"><span>{t.quantity} <b>{quantityIssue ? '—' : quantityDraft} {t.piece}</b></span><span>{t.total} <b>{quantityIssue ? '—' : money.format(selected.product.priceKzt * Number(quantityDraft))}</b></span></div>
      {confirmAttempted && <p id="ekt-confirm-status" role="status">{confirmLoading ? t.pendingCart : t.retryNote}</p>}
      {confirmError && <p className="confirm-error" role="alert"><ErrorText error={confirmError} t={t} /></p>}
      {selectionExpired && <p className="confirm-error" role="alert">{uploadText[language ?? 'ru'].expired}</p>}
      <footer><button className="cancel" type="button" onClick={closeConfirmation}>{confirmAttempted ? t.hideRequest : t.cancel}</button><button ref={confirmButtonRef} className="yes" type="button" disabled={confirmLoading || Boolean(quantityIssue) || selectionExpired} onClick={() => void confirm()}>{confirmLoading ? t.adding : confirmAttempted ? t.retry : t.yesAdd}</button></footer>
    </section></div>}
  </>
}

function CartScreen({ cart, error, language, readingMode, onReadingModeChange, onBack }: ReadingModeProps & { cart: CartSnapshot | null; error: UiError | null; language: Language | null; onBack: () => void }) {
  const t = translations[language ?? 'ru']
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { headingRef.current?.focus() }, [])
  useEffect(() => {
    const previousTitle = document.title
    document.title = `${t.cart} — EKT`
    return () => { document.title = previousTitle }
  }, [t.cart])
  return <section className={`cart-screen${readingMode ? ' reading-mode' : ''}`} lang={language ?? 'ru'}><p className="crumbs">{t.home} / {t.cart}</p><h1 ref={headingRef} tabIndex={-1}>{t.cart}</h1>
    <ReadingModeToggle readingMode={readingMode} onReadingModeChange={onReadingModeChange} t={t} />
    {error && <p className="error" role="alert"><ErrorText error={error} t={t} /></p>}
    {!cart && !error && <p>{t.loadingCart}</p>}
    {cart && cart.items.length === 0 && <p>{t.emptyCart}</p>}
    {cart?.items.map((item) => <article className="cart-row" key={item.sku}><div><small>{item.sku}</small><h2 lang="ru">{item.name}</h2></div><span>{item.quantity} {t.piece}</span><strong>{money.format(item.lineTotalKzt)}</strong></article>)}
    {cart && cart.items.length > 0 && <p className="cart-total">{t.total}: <strong>{money.format(cart.totalPriceKzt)}</strong></p>}
    <a className="back-link" href="/" onClick={(event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      onBack()
    }}>{t.backCatalog}</a>
  </section>
}

function App() {
  const [language, setLanguage] = useState<Language | null>(storedLanguage)
  const [readingMode, setReadingMode] = useState(storedReadingMode)
  const [savedHistory] = useState(loadChatHistory)
  const [chats, setChats] = useState<Chat[]>(savedHistory.chats)
  // Files, session IDs and extracted lines stay in memory, never in saved chat history.
  const [uploads, setUploads] = useState<Record<string, UploadState>>({})
  const currentChats = useRef(chats)
  currentChats.current = chats
  const [selectedChatId, setSelectedChatId] = useState<string | null>(savedHistory.selectedChatId)
  const [storageError, setStorageError] = useState(savedHistory.storageError)
  const [historyConflict, setHistoryConflict] = useState(false)
  const conflictingHistory = useRef(false)
  const previousHistory = useRef({ chats, selectedChatId })
  const activeChat = chats.find((chat) => chat.id === selectedChatId) ?? chats[0]
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== HISTORY_KEY && event.key !== null) return
      // Never resurrect another tab's deleted history with a stale snapshot.
      conflictingHistory.current = true
      setHistoryConflict(true)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  useEffect(() => {
    if (conflictingHistory.current) return
    if (previousHistory.current.chats === chats && previousHistory.current.selectedChatId === selectedChatId) return
    previousHistory.current = { chats, selectedChatId }
    setStorageError(!saveChatHistory(chats, activeChat.id))
  }, [chats, selectedChatId, activeChat.id])
  const deleteChats = (id: string) => {
    if (conflictingHistory.current) return false
    const remaining = id === 'all' ? [] : chats.filter((chat) => chat.id !== id)
    const next = remaining.length ? remaining : [createChat()]
    const nextId = next.some((chat) => chat.id === activeChat.id) ? activeChat.id : next[0].id
    if (!saveChatHistory(next, nextId)) {
      setStorageError(true)
      return false
    }
    setChats(next)
    setUploads((current) => Object.fromEntries(Object.entries(current).filter(([chatId]) => next.some((chat) => chat.id === chatId))))
    setSelectedChatId(nextId)
    return true
  }
  // Capture the owner ID: a late response must never update a different chat.
  const setConversation: Dispatch<SetStateAction<ChatTurn[]>> = (update) => {
    setChats((current) => current.map((chat) => chat.id === activeChat.id
      ? { ...chat, turns: typeof update === 'function' ? update(chat.turns) : update } : chat))
  }
  const setDraft = (draft: string) => setChats((current) => current.map((chat) => chat.id === activeChat.id ? { ...chat, draft } : chat))
  const setUpload: Dispatch<SetStateAction<UploadState>> = (update) => {
    const owner = activeChat.id
    setUploads((current) => {
      if (!currentChats.current.some((chat) => chat.id === owner)) return current
      const previous = current[owner] ?? { phase: 'idle' }
      return { ...current, [owner]: typeof update === 'function' ? update(previous) : update }
    })
  }
  const newChat = () => {
    const chat = createChat()
    setChats((current) => [chat, ...current])
    setSelectedChatId(chat.id)
  }
  const [cart, setCart] = useState<CartSnapshot | null>(null)
  const [cartError, setCartError] = useState<UiError | null>(null)
  const [route, setRoute] = useState(window.location.pathname)
  const cartVersion = useRef(0)

  useEffect(() => {
    let active = true
    const initialVersion = cartVersion.current
    getCart().then((snapshot) => { if (active && cartVersion.current === initialVersion) setCart(snapshot) })
      .catch((error) => { if (active && cartVersion.current === initialVersion) setCartError(uiError(error)) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const updateRoute = () => setRoute(window.location.pathname)
    window.addEventListener('popstate', updateRoute)
    return () => window.removeEventListener('popstate', updateRoute)
  }, [])

  const openCart = (snapshot: CartSnapshot) => {
    const url = frontendCartUrl(snapshot.cartUrl)
    cartVersion.current += 1
    setCart(snapshot)
    setCartError(null)
    window.history.pushState({}, '', url)
    setRoute(window.location.pathname)
  }

  const cartHref = cart ? frontendCartUrl(cart.cartUrl) : undefined
  const onCartRoute = route !== '/'
  const changeLanguage = (nextLanguage: Language) => {
    setLanguage(nextLanguage)
    try { window.localStorage.setItem('ekt-ui-language', nextLanguage) } catch { /* Chat still works without storage. */ }
  }
  const toggleReadingMode = () => {
    const nextMode = !readingMode
    setReadingMode(nextMode)
    try { window.localStorage.setItem(readingModeKey, String(nextMode)) } catch { /* The mode still works for this visit when storage is blocked. */ }
  }
  const readingProps = { readingMode, onReadingModeChange: toggleReadingMode }
  const backToCatalog = () => {
    window.history.pushState({}, '', '/')
    setRoute('/')
  }

  return <main className="store">
    <div className="site-top"><div className="site-top__inner"><button type="button"><MapPin size={14} weight="fill" /> Алматы</button><div className="site-top__links"><a href="#account"><UserCircle size={14} /> Личный кабинет</a><a href="#b2b">B2B - EKT PRO</a><a href="#buyers">Покупателям</a><a href="#request">Оставить заявку</a><a href="#kz">ҚАЗ</a></div><a className="phones" href="tel:+77273468888"><Phone size={14} weight="fill" /> +7 (727) 346-88-88<br />+7 (778) 046-88-88</a></div></div>
    <header className="store-header"><a className="brand" href="/" aria-label="Группа компаний Электрокомплект"><span>ГРУППА КОМПАНИЙ</span>ЭЛЕКТРОКОМПЛЕКТ</a><button className="catalog-button" type="button">Каталог <List size={19} weight="bold" /></button><label className="site-search"><MagnifyingGlass size={20} /><input placeholder="Поиск" /></label><div className="header-actions"><a href="#compare">Сравнить</a><a href="#favorites"><Heart size={18} /> Избранное</a>{cartHref ? <a href={cartHref}><ShoppingCart size={19} /> Корзина <b>{cart?.items.length ?? 0}</b></a> : <span><ShoppingCart size={19} /> Корзина</span>}</div></header>
    {onCartRoute ? <CartScreen cart={cart} error={cartError} language={language} onBack={backToCatalog} {...readingProps} /> : <>
      <section className="showcase" aria-label="Специальные предложения"><article className="showcase-main"><div className="promo-copy"><p className="promo-brand">Промрукав</p><h1>МОНТАЖНЫЕ <strong>РЕШЕНИЯ</strong></h1><span>ЖАНА / НОВИНКА!</span></div><div className="product-assembly" aria-hidden="true"><i className="assembly-box" /><i className="assembly-rail" /><i className="assembly-cover" /><i className="assembly-tube" /></div></article><article className="showcase-side"><span>CHiNT</span><div className="breaker-pair" aria-hidden="true"><i /><i /></div><small>Низковольтная аппаратура</small></article></section>
      <section className="catalog" id="catalog"><h2>Каталог продукции</h2><div className="category-bar"><a href="#cable">Кабель / Провод</a><a href="#light">Светильники / Лампы</a><a href="#low">Низковольтная аппаратура</a><a href="#tools">Монтаж и инструмент</a><a href="#cabinet">Шкафы / Щиты</a></div></section>
      <Widget onCartChanged={openCart} language={language} onLanguageChange={changeLanguage} conversation={activeChat.turns} setConversation={setConversation} chats={chats} chatId={activeChat.id} query={activeChat.draft} setQuery={setDraft} onSelectChat={setSelectedChatId} onNewChat={newChat} onDeleteChats={deleteChats} storageError={storageError} historyConflict={historyConflict} upload={uploads[activeChat.id] ?? { phase: 'idle' }} setUpload={setUpload} uploadNames={Object.fromEntries(Object.entries(uploads).filter(([, value]) => value.file).map(([id, value]) => [id, value.file!.name]))} {...readingProps} />
    </>}
  </main>
}

export default App
