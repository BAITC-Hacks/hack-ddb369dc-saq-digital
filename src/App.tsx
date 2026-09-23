import { useEffect, useRef, useState } from 'react'
import { ArrowRight, CheckCircle, CircleNotch, FileText, Heart, List, MagnifyingGlass, MapPin, Package, Phone, ShoppingCart, Sparkle, UserCircle, WarningCircle, X } from '@phosphor-icons/react'
import { addToCart, frontendCartUrl, getCart, searchCatalog } from './lib/api'
import { storedLanguage, translations } from './i18n'
import type { Language, UiText } from './i18n'
import type { ApiProduct, CartSnapshot, SearchResponse } from './types'

const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 })

function errorMessage(error: unknown, fallback = translations.ru.requestFailed): string {
  return error instanceof Error ? error.message : fallback
}

function safeLink(value?: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function Suggestion({ product, quantity, exact, reason, choose, t }: {
  product: ApiProduct
  quantity: number
  exact: boolean
  reason?: string
  choose: (product: ApiProduct, quantity: number, trigger: HTMLButtonElement) => void
  t: UiText
}) {
  const available = product.stock >= quantity && (!product.minimumOrderQuantity || quantity % product.minimumOrderQuantity === 0)
  const specifications = [
    product.poles ? `${product.poles}P` : null,
    product.curve && product.amps ? `${product.curve}${product.amps}` : null,
    product.breakingCapacityKa ? `${product.breakingCapacityKa} kA` : null,
  ].filter(Boolean)
  const properties = Object.entries(product.properties ?? {})
    .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
    .slice(0, 3)

  return <article className="suggestion">
    <div className="suggestion-top">
      <span className={exact ? 'tag tag-muted' : 'tag'}>{exact ? t.exactMatch : t.compatible}</span>
      <span className={available ? 'stock ok' : 'stock out'}><i />{t.inStock}: {product.stock} {t.piece}</span>
    </div>
    <p className="sku">{product.sku}</p>
    <h3>{product.name}</h3>
    {specifications.length > 0 && <p className="specs">{specifications.join(' · ')}</p>}
    {properties.length > 0 && <dl className="property-list">{properties.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl>}
    {product.technicalIssue && <p className="reason">{product.technicalIssue}</p>}
    {reason && <p className="reason">{reason}</p>}
    {product.minimumOrderQuantity && quantity % product.minimumOrderQuantity !== 0 && <p className="reason">{t.multipleOf} {product.minimumOrderQuantity}.</p>}
    <div className="certificates">{product.certificates?.map((certificate) => {
      const href = safeLink(certificate.url)
      return href && <a className="certificate" href={href} key={certificate.url} target="_blank" rel="noreferrer"><FileText size={14} /> {certificate.name}</a>
    })}</div>
    <footer>
      <strong>{money.format(product.priceKzt)}</strong>
      <button type="button" disabled={!available} onClick={(event) => choose(product, quantity, event.currentTarget)}>
        {available ? t.choose : t.unavailable} <ArrowRight size={15} weight="bold" />
      </button>
    </footer>
  </article>
}

type Confirmation = { product: ApiProduct; quantity: number; confirmationId: string }

function Widget({ onCartChanged, language, onLanguageChange }: {
  onCartChanged: (cart: CartSnapshot) => void
  language: Language | null
  onLanguageChange: (language: Language) => void
}) {
  const t = translations[language ?? 'ru']
  const [open, setOpen] = useState(() => !window.matchMedia?.('(max-width: 480px)').matches)
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Confirmation | null>(null)
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const [confirmAttempted, setConfirmAttempted] = useState(false)
  const confirmationInFlight = useRef(false)
  const widgetRef = useRef<HTMLElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const firstLanguageRef = useRef<HTMLButtonElement>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const confirmationRef = useRef<HTMLElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLButtonElement | null>(null)
  const restoreLauncherFocus = useRef(false)
  const openedFromLauncher = useRef(false)
  const canDismissConfirmation = !confirmLoading && (!confirmAttempted || Boolean(confirmError))

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
    if (selected) confirmButtonRef.current?.focus()
    else returnFocusRef.current?.focus()
  }, [selected])

  useEffect(() => {
    if (!selected || !confirmAttempted) return
    if (confirmLoading) confirmationRef.current?.focus()
    else confirmButtonRef.current?.focus()
  }, [selected, confirmAttempted, confirmLoading])

  const closeChat = () => {
    restoreLauncherFocus.current = true
    setOpen(false)
  }

  const openChat = () => {
    openedFromLauncher.current = true
    setOpen(true)
  }

  const closeConfirmation = () => {
    setSelected(null)
  }

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (selected) {
        if (canDismissConfirmation) {
          event.preventDefault()
          closeConfirmation()
        }
      } else if (open && widgetRef.current?.contains(document.activeElement)) {
        event.preventDefault()
        closeChat()
      }
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [open, selected, canDismissConfirmation])

  const submit = async (value = query) => {
    const message = value.trim()
    if (message.length < 5) {
      setError(t.shortQuery)
      return
    }
    setQuery(message)
    setSubmittedQuery(message)
    setError('')
    setResult(null)
    setLoading(true)
    try {
      setResult(await searchCatalog(message))
    } catch (caught) {
      setError(errorMessage(caught, t.requestFailed))
    } finally {
      setLoading(false)
    }
  }

  const choose = (product: ApiProduct, quantity: number, trigger: HTMLButtonElement) => {
    setConfirmError('')
    setConfirmAttempted(false)
    returnFocusRef.current = trigger
    setSelected({ product, quantity, confirmationId: crypto.randomUUID() })
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
    if (event.shiftKey && document.activeElement === first) {
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
    setConfirmError('')
    try {
      const cart = await addToCart(selected.product.sku, selected.quantity, selected.confirmationId)
      frontendCartUrl(cart.cartUrl)
      onCartChanged(cart)
      setSelected(null)
    } catch (caught) {
      setConfirmError(errorMessage(caught, t.requestFailed))
    } finally {
      confirmationInFlight.current = false
      setConfirmLoading(false)
    }
  }

  const quantity = result?.filters?.quantity ?? 1
  const sourceHref = safeLink(result?.sourceUrl)

  return <>
    {open && <aside ref={widgetRef} className="widget" aria-labelledby="ekt-chat-title" role="dialog" aria-modal="false" lang={language ?? 'ru'}>
      <header><div className="agent"><span aria-hidden="true"><Sparkle size={17} weight="regular" /></span><div><strong id="ekt-chat-title">{t.assistant}</strong><small>{t.assistantSubtitle}</small></div></div><button className="icon" type="button" aria-label={t.closeChat} onClick={closeChat}><X size={19} /></button></header>
      <section className="messages" aria-live="polite">
        <div className="message assistant"><small>{t.assistant}</small>{language ? <p>{t.greeting}</p> : <p><span lang="ru">Здравствуйте! Выберите язык для общения.</span><br /><span lang="kk">Сәлеметсіз бе! Қарым-қатынас тілін таңдаңыз.</span></p>}<div className="language-options" role="group" aria-label="Язык общения / Қарым-қатынас тілі"><button ref={firstLanguageRef} type="button" lang="ru" aria-pressed={language === 'ru'} onClick={() => onLanguageChange('ru')}>Русский</button><button type="button" lang="kk" aria-pressed={language === 'kk'} onClick={() => onLanguageChange('kk')}>Қазақша</button></div></div>
        {result && <>
          <div className="message customer"><small>{t.you}</small><p>{submittedQuery}</p></div>
          <div className="message assistant"><small>{t.assistant}</small><p>{result.answer}</p>{sourceHref && <a className="source-link" href={sourceHref} target="_blank" rel="noreferrer">{t.source}</a>}</div>
          {result.exactMatch && <Suggestion product={result.exactMatch.product} quantity={quantity} exact reason={result.exactMatch.canFulfill ? undefined : t.insufficientStock} choose={choose} t={t} />}
          {result.alternatives.map(({ product, reason }) => <Suggestion key={product.sku} product={product} quantity={quantity} exact={false} reason={reason} choose={choose} t={t} />)}
          {!result.exactMatch && result.alternatives.length === 0 && result.intent !== 'purchase_terms' && <div className="empty-result"><Package size={23} /> {t.noResults}</div>}
        </>}
        {loading && <div className="loading" role="status"><CircleNotch className="spin" size={17} /> {t.searching}</div>}
      </section>
      <form className="composer" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <textarea ref={messageRef} aria-label={t.messageLabel} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.messagePlaceholder} rows={2} />
        {error && <p className="error" role="alert"><WarningCircle size={15} weight="fill" /> {error}</p>}
        <div><button className="demo" type="button" disabled={loading} onClick={() => void submit(t.demoQuery)}>{t.demo}</button><button className="send" type="submit" disabled={loading}>{loading ? <CircleNotch className="spin" size={17} /> : t.send}</button></div>
      </form>
    </aside>}
    {!open && <button ref={launcherRef} className="fab" type="button" aria-label={t.openChat} onClick={openChat} lang={language ?? 'ru'}><Sparkle size={19} weight="regular" aria-hidden="true" /> {t.askAssistant}</button>}
    {selected && <div className="shade" role="presentation"><section ref={confirmationRef} className="confirm" role="dialog" aria-modal="true" aria-busy={confirmLoading} aria-labelledby="ekt-confirm-title" tabIndex={-1} onKeyDown={keepConfirmationFocus} lang={language ?? 'ru'}>
      {canDismissConfirmation && <button className="icon close" type="button" aria-label={t.closeConfirmation} onClick={closeConfirmation}><X size={19} /></button>}
      <span className="confirm-icon"><CheckCircle size={28} weight="fill" /></span><p className="eyebrow">{t.explicitConfirmation}</p><h2 id="ekt-confirm-title">{t.addToCart}</h2>
      <p>{selected.product.name}<br /><small>{selected.product.sku}</small></p>
      <div className="total"><span>{t.quantity} <b>{selected.quantity} {t.piece}</b></span><span>{t.total} <b>{money.format(selected.product.priceKzt * selected.quantity)}</b></span></div>
      {confirmError && <p className="confirm-error" role="alert">{confirmError} {t.retryNote}</p>}
      <footer>{canDismissConfirmation && <button className="cancel" type="button" onClick={closeConfirmation}>{t.cancel}</button>}<button ref={confirmButtonRef} className="yes" type="button" disabled={confirmLoading} onClick={() => void confirm()}>{confirmLoading ? t.adding : confirmAttempted ? t.retry : t.yesAdd}</button></footer>
    </section></div>}
  </>
}

function CartScreen({ cart, error, language }: { cart: CartSnapshot | null; error: string; language: Language | null }) {
  const t = translations[language ?? 'ru']
  return <section className="cart-screen" lang={language ?? 'ru'}><p className="crumbs">{t.home} / {t.cart}</p><h1>{t.cart}</h1>
    {error && <p className="error" role="alert">{error}</p>}
    {!cart && !error && <p>{t.loadingCart}</p>}
    {cart && cart.items.length === 0 && <p>{t.emptyCart}</p>}
    {cart?.items.map((item) => <article className="cart-row" key={item.sku}><div><small>{item.sku}</small><h2>{item.name}</h2></div><span>{item.quantity} {t.piece}</span><strong>{money.format(item.lineTotalKzt)}</strong></article>)}
    {cart && cart.items.length > 0 && <p className="cart-total">{t.total}: <strong>{money.format(cart.totalPriceKzt)}</strong></p>}
    <a className="back-link" href="/">{t.backCatalog}</a>
  </section>
}

function App() {
  const [language, setLanguage] = useState<Language | null>(storedLanguage)
  const [cart, setCart] = useState<CartSnapshot | null>(null)
  const [cartError, setCartError] = useState('')
  const [route, setRoute] = useState(window.location.pathname)
  const cartVersion = useRef(0)

  useEffect(() => {
    let active = true
    const initialVersion = cartVersion.current
    getCart().then((snapshot) => { if (active && cartVersion.current === initialVersion) setCart(snapshot) })
      .catch((error) => { if (active && cartVersion.current === initialVersion) setCartError(errorMessage(error)) })
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
    window.history.pushState({}, '', url)
    setRoute(window.location.pathname)
  }

  const cartHref = cart ? frontendCartUrl(cart.cartUrl) : undefined
  const onCartRoute = route !== '/'
  const changeLanguage = (nextLanguage: Language) => {
    setLanguage(nextLanguage)
    try { window.localStorage.setItem('ekt-ui-language', nextLanguage) } catch { /* Chat still works without storage. */ }
  }

  return <main className="store">
    <div className="site-top"><div className="site-top__inner"><button type="button"><MapPin size={14} weight="fill" /> Алматы</button><div className="site-top__links"><a href="#account"><UserCircle size={14} /> Личный кабинет</a><a href="#b2b">B2B - EKT PRO</a><a href="#buyers">Покупателям</a><a href="#request">Оставить заявку</a><a href="#kz">ҚАЗ</a></div><a className="phones" href="tel:+77273468888"><Phone size={14} weight="fill" /> +7 (727) 346-88-88<br />+7 (778) 046-88-88</a></div></div>
    <header className="store-header"><a className="brand" href="/" aria-label="Группа компаний Электрокомплект"><span>ГРУППА КОМПАНИЙ</span>ЭЛЕКТРОКОМПЛЕКТ</a><button className="catalog-button" type="button">Каталог <List size={19} weight="bold" /></button><label className="site-search"><MagnifyingGlass size={20} /><input placeholder="Поиск" /></label><div className="header-actions"><a href="#compare">Сравнить</a><a href="#favorites"><Heart size={18} /> Избранное</a>{cartHref ? <a href={cartHref}><ShoppingCart size={19} /> Корзина <b>{cart?.items.length ?? 0}</b></a> : <span><ShoppingCart size={19} /> Корзина</span>}</div></header>
    {onCartRoute ? <CartScreen cart={cart} error={cartError} language={language} /> : <>
      <section className="showcase" aria-label="Специальные предложения"><article className="showcase-main"><div className="promo-copy"><p className="promo-brand">Промрукав</p><h1>МОНТАЖНЫЕ <strong>РЕШЕНИЯ</strong></h1><span>ЖАНА / НОВИНКА!</span></div><div className="product-assembly" aria-hidden="true"><i className="assembly-box" /><i className="assembly-rail" /><i className="assembly-cover" /><i className="assembly-tube" /></div></article><article className="showcase-side"><span>CHiNT</span><div className="breaker-pair" aria-hidden="true"><i /><i /></div><small>Низковольтная аппаратура</small></article></section>
      <section className="catalog" id="catalog"><h2>Каталог продукции</h2><div className="category-bar"><a href="#cable">Кабель / Провод</a><a href="#light">Светильники / Лампы</a><a href="#low">Низковольтная аппаратура</a><a href="#tools">Монтаж и инструмент</a><a href="#cabinet">Шкафы / Щиты</a></div></section>
      <Widget onCartChanged={openCart} language={language} onLanguageChange={changeLanguage} />
    </>}
  </main>
}

export default App
