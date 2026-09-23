import { useEffect, useRef, useState } from 'react'
import { CheckCircle, CircleNotch, Package, Sparkle, WarningCircle, X } from '@phosphor-icons/react'
import configuration from '../../config.json'
import { addToCart, ApiError, searchCatalog } from '../lib/api'
import { money } from '../lib/format'
import { safeLink } from '../lib/links'
import type { Cart, Product, SearchResult } from '../types'
import { ProductCard } from './ProductCard'

type Selection = { product: Product; quantity: number; confirmationId: string }
type Message = { role: 'user' | 'assistant'; text: string; sourceUrl?: string }

export function AssistantWidget({ cartUrl, updateCart }: { cartUrl: string; updateCart: (cart: Cart) => void }) {
  const [open, setOpen] = useState(true)
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [result, setResult] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Selection | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [confirmationError, setConfirmationError] = useState('')
  const [added, setAdded] = useState(false)
  const searchPending = useRef(false)
  const confirmationPending = useRef(false)
  const messageList = useRef<HTMLElement>(null)

  useEffect(() => {
    if (messageList.current) messageList.current.scrollTop = messageList.current.scrollHeight
  }, [messages, loading, result, error])

  const submit = async (value = query) => {
    if (searchPending.current) return
    const message = value.trim()
    if (!message) { setError('Укажите артикул, характеристики или вопрос об условиях покупки.'); return }
    searchPending.current = true
    setQuery(''); setSubmittedQuery(message); setError(''); setResult(null); setLoading(true); setAdded(false)
    setMessages((previous) => previous.at(-1)?.role === 'user' && previous.at(-1)?.text === message
      ? previous : [...previous.slice(-39), { role: 'user', text: message }])
    try {
      const next = await searchCatalog(message)
      setResult(next)
      setMessages((previous) => [...previous.slice(-39), { role: 'assistant', text: next.message, sourceUrl: next.sourceUrl }])
    }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Не удалось связаться с каталогом. Повторите запрос.') }
    finally { searchPending.current = false; setLoading(false) }
  }

  const choose = (product: Product) => {
    if (!result) return
    setConfirmationError('')
    setSelected({ product, quantity: result.quantity, confirmationId: crypto.randomUUID() })
  }

  const confirm = async () => {
    if (!selected || confirmationPending.current) return
    confirmationPending.current = true
    setConfirming(true); setConfirmationError('')
    try {
      updateCart(await addToCart(selected.product.sku, selected.quantity, selected.confirmationId))
      setSelected(null); setAdded(true)
    } catch (cause) {
      setConfirmationError(cause instanceof ApiError && cause.code !== 'NETWORK_ERROR' ? cause.message : 'Не удалось получить подтверждение. Повторите отправку.')
    } finally { confirmationPending.current = false; setConfirming(false) }
  }

  return <>
    {open ? <aside className="widget" aria-label="Чат с помощником EKT" role="dialog" aria-modal="false">
      <header>
        <div className="agent"><span><Sparkle size={17} weight="fill" /></span><div><strong>Помощник EKT</strong><small>Демо · локальный каталог</small></div></div>
        <button className="icon" type="button" aria-label="Свернуть чат" onClick={() => setOpen(false)}><X size={19} /></button>
      </header>
      <section className="messages" ref={messageList} role="log" aria-label="История диалога" aria-live="polite" aria-relevant="additions">
        <div className="message assistant"><small>Помощник EKT</small><p>Здравствуйте! Расскажу об ассортименте, помогу с подбором и отвечу на вопросы о товарах, корзине, доставке и оплате. Что вас интересует?</p></div>
        {messages.map((message, index) => {
          const sourceHref = safeLink(message.sourceUrl)
          return <div className={`message ${message.role === 'user' ? 'customer' : 'assistant'}`} key={index}>
            <small>{message.role === 'user' ? 'Вы' : 'Помощник EKT'}</small><p>{message.text}</p>
            {sourceHref && <a className="source-link" href={sourceHref} target="_blank" rel="noreferrer">Источник условий</a>}
          </div>
        })}
        {result && <>
          {result.interpretedQuery && <p className="interpreted-query">Распознано: {result.interpretedQuery}</p>}
          {result.products.length > 0 && <div className="suggestions">{result.products.map((product) => <ProductCard key={product.id} product={product} quantity={result.quantity} choose={choose} />)}</div>}
          {result.products.length === 0 && (result.answerKind === 'product' || result.answerKind === 'alternatives') && <div className="empty-result"><Package size={26} weight="duotone" /> Нет подходящих позиций. Уточните характеристики или артикул.</div>}
        </>}
        {added && <div className="cart-note" role="status"><CheckCircle size={19} weight="fill" /> Товар добавлен в корзину. <a href={cartUrl}>Перейти в корзину</a></div>}
        {loading && <div className="loading" role="status"><CircleNotch className="spin" size={17} /> Готовлю ответ</div>}
      </section>
      <form className="composer" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <textarea aria-label="Сообщение помощнику EKT" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() }
        }} placeholder="Что есть в каталоге?" maxLength={4000} rows={2} />
        {error && <p className="error" role="alert"><WarningCircle size={15} weight="fill" /> {error}</p>}
        <div>{error && submittedQuery && <button className="demo" type="button" disabled={loading} onClick={() => void submit(submittedQuery)}>Повторить</button>}<button className="demo" type="button" disabled={loading} onClick={() => void submit(configuration.demoQuery)}>Demo</button><button className="send" type="submit" disabled={loading}>{loading ? <CircleNotch className="spin" size={17} /> : 'Отправить'}</button></div>
      </form>
    </aside> : <button className="fab" type="button" onClick={() => setOpen(true)}><Sparkle size={19} weight="fill" /> Спросить помощника</button>}
    {selected && <div className="shade" role="presentation"><section className="confirm" role="dialog" aria-modal="true" aria-label="Добавить товар в корзину?" onKeyDown={(event) => { if (event.key === 'Escape' && !confirming) setSelected(null) }}>
      <button className="icon close" type="button" disabled={confirming} aria-label="Закрыть подтверждение" onClick={() => setSelected(null)}><X size={19} /></button>
      <span className="confirm-icon"><CheckCircle size={28} weight="fill" /></span><p className="eyebrow">Явное подтверждение</p><h2>Добавить товар в корзину?</h2>
      <p>{selected.product.name}<br /><small>{selected.product.sku}</small></p>
      <div className="total"><span>Количество <b>{selected.quantity} шт.</b></span><span>Итого <b>{money.format(selected.product.price * selected.quantity)}</b></span></div>
      {confirmationError && <p className="error" role="alert">{confirmationError}</p>}
      <footer><button className="cancel" type="button" disabled={confirming} autoFocus onClick={() => setSelected(null)}>Отмена</button><button className="yes" type="button" disabled={confirming} onClick={() => void confirm()}>{confirming ? 'Добавляю…' : 'Подтвердить и добавить'}</button></footer>
    </section></div>}
  </>
}
