import { useEffect, useRef, useState } from 'react'
import { ArrowRight, CheckCircle, CircleNotch, Package, Sparkle, WarningCircle, X } from '@phosphor-icons/react'
import { addToCart, pendingConfirmationId, searchCatalog } from '../lib/api'
import { money } from '../lib/format'
import { safeLink } from '../lib/links'
import { backendSearchQuery, translations } from '../i18n'
import type { Language } from '../i18n'
import type { Cart, Product, SearchResult } from '../types'
import { ProductCard } from './ProductCard'
import { ErrorText, uiError } from './ErrorText'
import type { UiError } from './ErrorText'

type Selection = { product: Product; quantity: number; confirmationId: string }
type Message = { role: 'user' | 'assistant'; text: string; language: Language; sourceUrl?: string; retryable?: boolean }

export function AssistantWidget({ updateCart, language, onLanguageChange }: {
  updateCart: (cart: Cart) => void
  language: Language | null
  onLanguageChange: (language: Language) => void
}) {
  const t = translations[language ?? 'ru']
  const [open, setOpen] = useState(() => !window.matchMedia?.('(max-width: 480px)').matches)
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const searchPending = useRef(false)
  const messageList = useRef<HTMLElement>(null)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<UiError | null>(null)
  const [selected, setSelected] = useState<Selection | null>(null)
  const [confirmationVisible, setConfirmationVisible] = useState(false)
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [confirmError, setConfirmError] = useState<UiError | null>(null)
  const [confirmAttempted, setConfirmAttempted] = useState(false)
  const confirmationInFlight = useRef(false)
  const widgetRef = useRef<HTMLElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const firstLanguageRef = useRef<HTMLButtonElement>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const confirmationRef = useRef<HTMLElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const reviewRequestRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLButtonElement | null>(null)
  const restoreConfirmationFocus = useRef(false)
  const restoreLauncherFocus = useRef(false)
  const openedFromLauncher = useRef(false)

  useEffect(() => {
    if (messageList.current) messageList.current.scrollTop = messageList.current.scrollHeight
  }, [messages, loading, result, error, open])

  useEffect(() => {
    if (open && openedFromLauncher.current) {
      if (language) messageRef.current?.focus()
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
      else confirmButtonRef.current?.focus()
    } else if (restoreConfirmationFocus.current) {
      const target = returnFocusRef.current?.isConnected ? returnFocusRef.current : reviewRequestRef.current ?? messageRef.current
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
        setOpen(false)
      }
    }
    document.addEventListener('focusin', onFocusOutside)
    return () => document.removeEventListener('focusin', onFocusOutside)
  }, [open, selected, confirmationVisible])

  const closeChat = () => {
    restoreLauncherFocus.current = true
    setOpen(false)
  }

  const openChat = () => {
    openedFromLauncher.current = true
    setOpen(true)
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

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (selected && confirmationVisible) {
        event.preventDefault()
        closeConfirmation()
      } else if (open) {
        event.preventDefault()
        if (widgetRef.current?.contains(document.activeElement)) closeChat()
        else setOpen(false)
      }
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [open, selected, confirmationVisible, confirmAttempted])

  const submit = async (value = query) => {
    if (searchPending.current) return
    const message = value.trim()
    if (!message) {
      setError({ key: 'shortQuery' })
      messageRef.current?.focus()
      return
    }
    const messageLanguage = language ?? 'ru'
    searchPending.current = true
    setQuery(''); setSubmittedQuery(message); setError(null); setResult(null); setLoading(true)
    setMessages((previous) => {
      const retained = previous.at(-1)?.retryable && previous.at(-2)?.role === 'user' && previous.at(-2)?.text === message
        ? previous.slice(0, -1) : previous
      return retained.at(-1)?.role === 'user' && retained.at(-1)?.text === message
        ? retained : [...retained.slice(-39), { role: 'user', text: message, language: messageLanguage }]
    })
    try {
      const next = await searchCatalog(backendSearchQuery(message, language))
      setResult(next)
      const retryable = next.notice !== undefined && next.notice !== 'AI_OFFLINE'
      if (retryable) setError({ key: 'requestFailed' })
      setMessages((previous) => [...previous.slice(-39), {
        role: 'assistant', text: next.message, sourceUrl: next.sourceUrl,
        language: next.answerKind === 'conversation' ? messageLanguage : 'ru',
        retryable,
      }])
    } catch (caught) {
      setError(uiError(caught))
    } finally {
      searchPending.current = false
      setLoading(false)
    }
  }

  const choose = (product: Product, trigger: HTMLButtonElement) => {
    if (!result || confirmationInFlight.current) return
    const quantity = result.quantity
    const retryId = pendingConfirmationId(product.sku, quantity)
    setConfirmError(null)
    setConfirmAttempted(Boolean(retryId))
    returnFocusRef.current = trigger
    setSelected({ product, quantity, confirmationId: retryId ?? crypto.randomUUID() })
    setConfirmationVisible(true)
  }

  const keepConfirmationFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
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
    if (!selected || confirmationInFlight.current) return
    confirmationInFlight.current = true
    setConfirmLoading(true)
    setConfirmAttempted(true)
    setConfirmError(null)
    try {
      const cart = await addToCart(selected.product.sku, selected.quantity, selected.confirmationId)
      updateCart(cart)
      setSelected(null)
    } catch (caught) {
      setConfirmError(uiError(caught))
    } finally {
      confirmationInFlight.current = false
      setConfirmLoading(false)
    }
  }

  return <>
    {open && <aside ref={widgetRef} className="widget" aria-labelledby="ekt-chat-title" role="dialog" aria-modal="false" lang={language ?? 'ru'}>
      <header><div className="agent"><span aria-hidden="true"><Sparkle size={17} weight="regular" /></span><div><strong id="ekt-chat-title">{t.assistant}</strong><small>{t.assistantSubtitle}</small></div></div><button className="icon" type="button" aria-label={t.closeChat} onClick={closeChat}><X size={19} /></button></header>
      <section className="messages" ref={messageList} role="log" aria-label={t.historyLabel} aria-live="polite" aria-relevant="additions">
        <div className="message assistant"><small>{t.assistant}</small>{language ? <p>{t.greeting}</p> : <p><span lang="ru">Здравствуйте! Выберите язык для общения.</span><br /><span lang="kk">Сәлеметсіз бе! Қарым-қатынас тілін таңдаңыз.</span></p>}<div className="language-options" role="group" aria-label={t.languageLabel}><button ref={firstLanguageRef} type="button" lang="ru" aria-pressed={language === 'ru'} onClick={() => onLanguageChange('ru')}>Русский</button><button type="button" lang="kk" aria-pressed={language === 'kk'} onClick={() => onLanguageChange('kk')}>Қазақша</button></div>{language && messages.length === 0 && !loading && <div className="starter-prompts"><p>{t.suggestionsHeading}</p><button type="button" onClick={() => useSuggestion(t.demoQuery)}>{t.productSuggestion}<ArrowRight size={14} aria-hidden="true" /></button><button type="button" onClick={() => useSuggestion(t.termsQuery)}>{t.termsSuggestion}<ArrowRight size={14} aria-hidden="true" /></button></div>}</div>
        {messages.map((message, index) => {
          const sourceHref = safeLink(message.sourceUrl)
          return <div className={`message ${message.role === 'user' ? 'customer' : 'assistant'}`} key={index}>
            <small>{message.role === 'user' ? t.you : t.assistant}</small><p lang={message.language}>{message.text}</p>
            {sourceHref && <a className="source-link" href={sourceHref} target="_blank" rel="noreferrer">{t.source}</a>}
          </div>
        })}
        {result && <>
          {result.interpretedQuery && <p className="interpreted-query">{t.interpreted}: {result.interpretedQuery}</p>}
          {result.products.length > 0 && <div className="suggestions">{result.products.map((product) => <ProductCard key={product.id} product={product} quantity={result.quantity} choose={choose} t={t} busy={confirmLoading} />)}</div>}
          {result.products.length === 0 && (result.answerKind === 'product' || result.answerKind === 'alternatives') && <div className="empty-result"><Package size={23} /> {t.noResults}</div>}
        </>}
        {loading && <div className="loading" role="status"><CircleNotch className="spin" size={17} /> {t.searching}</div>}
      </section>
      {selected && confirmAttempted && !confirmationVisible && <div className="pending-cart">
        <p role="status">{confirmLoading ? t.pendingCart : t.cartNeedsReview}</p>
        <button ref={reviewRequestRef} type="button" onClick={() => setConfirmationVisible(true)}>{t.reviewCartRequest}</button>
      </div>}
      <form className="composer" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <label htmlFor="ekt-message">{t.messageLabel}</label>
        <textarea id="ekt-message" ref={messageRef} aria-invalid={error?.key === 'shortQuery' || undefined} aria-describedby={error ? 'ekt-message-error' : undefined} value={query} onChange={(event) => { setQuery(event.target.value); if (error?.key === 'shortQuery') setError(null) }} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() }
        }} placeholder={t.messagePlaceholder} maxLength={4000} rows={2} />
        {error && <p id="ekt-message-error" className="error" role="alert"><WarningCircle size={15} weight="fill" aria-hidden="true" /><span><ErrorText error={error} t={t} /></span></p>}
        <div>{error && submittedQuery && <button className="demo" type="button" disabled={loading} onClick={() => void submit(submittedQuery)}>{t.retry}</button>}<button className="demo" type="button" disabled={loading} onClick={() => void submit(t.demoQuery)}>{t.demo}</button><button className="send" type="submit" disabled={loading} aria-label={t.send}>{loading ? <CircleNotch className="spin" size={17} aria-hidden="true" /> : t.send}</button></div>
      </form>
    </aside>}
    {!open && <button ref={launcherRef} className="fab" type="button" aria-label={t.openChat} onClick={openChat} lang={language ?? 'ru'}><Sparkle size={19} weight="regular" aria-hidden="true" /> {t.askAssistant}</button>}
    {selected && confirmationVisible && <div className="shade" role="presentation"><section ref={confirmationRef} className="confirm" role="dialog" aria-modal="true" aria-labelledby="ekt-confirm-title" aria-describedby={confirmAttempted ? 'ekt-confirm-status' : undefined} tabIndex={-1} onKeyDown={keepConfirmationFocus} lang={language ?? 'ru'}>
      <button className="icon close" type="button" aria-label={t.closeConfirmation} onClick={closeConfirmation}><X size={19} /></button>
      <span className="confirm-icon"><CheckCircle size={28} weight="fill" /></span><p className="eyebrow">{t.explicitConfirmation}</p><h2 id="ekt-confirm-title">{t.addToCart}</h2>
      <p lang="ru">{selected.product.name}<br /><small>{selected.product.sku}</small></p>
      <div className="total"><span>{t.quantity} <b>{selected.quantity} {t.piece}</b></span><span>{t.total} <b>{money.format(selected.product.price * selected.quantity)}</b></span></div>
      {confirmAttempted && <p id="ekt-confirm-status" role="status">{confirmLoading ? t.pendingCart : t.retryNote}</p>}
      {confirmError && <p className="confirm-error" role="alert"><ErrorText error={confirmError} t={t} /></p>}
      <footer><button className="cancel" type="button" onClick={closeConfirmation}>{confirmAttempted ? t.hideRequest : t.cancel}</button><button ref={confirmButtonRef} className="yes" type="button" disabled={confirmLoading} onClick={() => void confirm()}>{confirmLoading ? t.adding : confirmAttempted ? t.retry : t.yesAdd}</button></footer>
    </section></div>}
  </>
}
