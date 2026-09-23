import { useState } from 'react'
import { ArrowRight, CheckCircle, CircleNotch, FileText, Heart, List, MagnifyingGlass, MapPin, Package, Paperclip, Phone, ShoppingCart, Sparkle, UserCircle, WarningCircle, X } from '@phosphor-icons/react'
import { searchDemoCatalog } from './lib/demoApi'
import type { Product, SearchResult } from './types'

const demoQuery = 'Нужен автомат 3P C16, 10 kA, 8 штук. Если нет — совместимый аналог.'
const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 })

function Suggestion({ product, quantity, choose }: { product: Product; quantity: number; choose: (product: Product) => void }) {
  const available = product.stock >= quantity
  return <article className="suggestion">
    <div className="suggestion-top"><span className={product.isExactMatch ? 'tag tag-muted' : 'tag'}>{product.isExactMatch ? 'Точное совпадение' : 'Совместимый аналог'}</span><span className={available ? 'stock ok' : 'stock out'}><i />{available ? `В наличии: ${product.stock} шт.` : 'Нет в наличии'}</span></div>
    <p className="sku">{product.sku}</p><h3>{product.name}</h3><p className="specs">{product.poles} <b /> {product.curve}{product.amperage} <b /> {product.breakingCapacity}</p><p className="reason">{product.recommendation}</p>
    <footer><strong>{money.format(product.price)}</strong><div className="card-actions">{product.certificateUrl ? <a className="certificate" href={product.certificateUrl} target="_blank" rel="noreferrer"><FileText size={14} /> Сертификат</a> : null}<button type="button" disabled={!available} onClick={() => choose(product)}>{available ? 'Выбрать' : 'Недоступно'} <ArrowRight size={15} weight="bold" /></button></div></footer>
  </article>
}

function Widget({ cartCount, add }: { cartCount: number; add: (product: Product, quantity: number) => void }) {
  const [open, setOpen] = useState(true)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [attachment, setAttachment] = useState('')
  const [selected, setSelected] = useState<Product | null>(null)
  const submit = async (value = query) => {
    const message = value.trim()
    if (message.length < 5) { setError('Укажите артикул, название товара или вопрос об условиях покупки.'); return }
    setQuery(message); setError(''); setResult(null); setLoading(true)
    try { setResult(await searchDemoCatalog(message)) } catch { setError('Не удалось получить данные каталога. Повторите запрос.') } finally { setLoading(false) }
  }
  const confirm = () => { if (selected && result) { add(selected, result.quantity); setSelected(null) } }
  return <>
    {open && <aside className="widget" aria-label="Чат с помощником EKT" role="dialog" aria-modal="false">
      <header><div className="agent"><span><Sparkle size={17} weight="fill" /></span><div><strong>Помощник EKT</strong><small>Онлайн · каталог и условия покупки</small></div></div><button className="icon" type="button" aria-label="Свернуть чат" onClick={() => setOpen(false)}><X size={19} /></button></header>
      <section className="messages" aria-live="polite">
        <div className="message assistant"><small>Помощник EKT</small><p>Здравствуйте! Подберу товар по артикулу или характеристикам, проверю остатки и объясню аналоги. Могу ответить про доставку и оплату.</p></div>
        {result && <><div className="message customer"><small>Вы</small><p>{query}</p></div><div className="message assistant"><small>Помощник EKT</small><p>{result.message}</p></div>
          {result.products.length > 0 && <div className="suggestions">{result.products.map((product) => <Suggestion key={product.id} product={product} quantity={result.quantity} choose={setSelected} />)}</div>}
          {result.answerKind === 'purchase-terms' && <div className="terms"><Package size={21} weight="duotone" /> Точные условия появятся при оформлении заказа — после выбора товаров и города доставки.</div>}
          {result.products.length === 0 && result.answerKind !== 'purchase-terms' && <div className="empty-result"><Package size={26} weight="duotone" /> Не нашёл подходящую позицию. Уточните артикул или номинал.</div>}
          {cartCount > 0 && <div className="cart-note"><CheckCircle size={19} weight="fill" /> Товар добавлен в корзину. <a href="https://ekt.kz/personal/cart/">Перейти к оформлению</a></div>}
        </>}
        {loading && <div className="loading"><CircleNotch className="spin" size={17} /> Ищу по каталогу</div>}
      </section>
      <form className="composer" onSubmit={(event) => { event.preventDefault(); void submit() }}>
        {attachment && <p className="attached">Прикреплено: {attachment}</p>}
        <textarea aria-label="Сообщение помощнику EKT" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Например: есть ли EKT-AV-3P-C16-10K?" rows={2} />
        {error && <p className="error" role="alert"><WarningCircle size={15} weight="fill" /> {error}</p>}
        <div><label className="attach" htmlFor="attachment"><Paperclip size={17} /> Файл</label><input id="attachment" className="hidden" type="file" accept=".xlsx,.xls,.doc,.docx,.pdf,.jpg,.jpeg" onChange={(event) => setAttachment(event.target.files?.[0]?.name ?? '')} /><button className="demo" type="button" onClick={() => void submit(demoQuery)}>Demo</button><button className="send" type="submit" disabled={loading}>{loading ? <CircleNotch className="spin" size={17} /> : 'Отправить'}</button></div>
      </form>
    </aside>}
    {!open && <button className="fab" type="button" onClick={() => setOpen(true)}><Sparkle size={19} weight="fill" /> Спросить помощника</button>}
    {selected && result && <div className="shade" role="presentation"><section className="confirm" role="dialog" aria-modal="true" aria-label="Добавить товар в корзину?"><button className="icon close" type="button" aria-label="Закрыть подтверждение" onClick={() => setSelected(null)}><X size={19} /></button><span className="confirm-icon"><CheckCircle size={28} weight="fill" /></span><p className="eyebrow">Явное подтверждение</p><h2>Добавить товар в корзину?</h2><p>{selected.name}<br /><small>{selected.sku}</small></p><div className="total"><span>Количество <b>{result.quantity} шт.</b></span><span>Итого <b>{money.format(selected.price * result.quantity)}</b></span></div><footer><button className="cancel" type="button" onClick={() => setSelected(null)}>Отмена</button><button className="yes" type="button" onClick={confirm}>Да, добавить</button></footer></section></div>}
  </>
}

function App() {
  const [cart, setCart] = useState<{ product: Product; quantity: number } | null>(null)
  return <main className="store">
    <div className="site-top">
      <div className="site-top__inner"><button type="button"><MapPin size={14} weight="fill" /> Алматы</button><div className="site-top__links"><a href="#account"><UserCircle size={14} /> Личный кабинет</a><a href="#b2b">B2B - EKT PRO</a><a href="#buyers">Покупателям</a><a href="#request">Оставить заявку</a><a href="#kz">ҚАЗ</a></div><a className="phones" href="tel:+77273468888"><Phone size={14} weight="fill" /> +7 (727) 346-88-88<br />+7 (778) 046-88-88</a></div>
    </div>
    <header className="store-header">
      <a className="brand" href="#catalog" aria-label="Группа компаний Электрокомплект"><span>ГРУППА КОМПАНИЙ</span>ЭЛЕКТРОКОМПЛЕКТ</a>
      <button className="catalog-button" type="button">Каталог <List size={19} weight="bold" /></button>
      <label className="site-search"><MagnifyingGlass size={20} /><input placeholder="Поиск" /></label>
      <div className="header-actions"><a href="#compare">Сравнить</a><a href="#favorites"><Heart size={18} /> Избранное</a><a href="https://ekt.kz/personal/cart/"><ShoppingCart size={19} /> Корзина <b>{cart ? 1 : 0}</b></a></div>
    </header>
    <div className="category-bar"><a href="#catalog">Каталог продукции</a><a href="#cable">Кабель / Провод</a><a href="#light">Светильники / Лампы</a><a href="#low">Низковольтная аппаратура</a><a href="#tools">Монтаж и инструмент</a></div>
    <section className="catalog" id="catalog"><p className="crumbs">Главная / Каталог продукции / Низковольтная аппаратура</p><h1>Автоматические выключатели</h1><div className="catalog-body"><aside><strong>Фильтры</strong><p>Производитель</p><label><input type="checkbox" /> EKT</label><label><input type="checkbox" /> IEK</label><p>Номинальный ток</p><label><input type="checkbox" /> 16 A</label><label><input type="checkbox" /> 32 A</label></aside><div className="products"><article><div><Package size={42} weight="thin" /></div><p>Автоматический выключатель</p><strong>3P C16, 10 kA</strong><span>12 490 ₸</span><button type="button">В корзину</button></article><article><div><Package size={42} weight="thin" /></div><p>Автоматический выключатель</p><strong>3P C25, 10 kA</strong><span>13 100 ₸</span><button type="button">В корзину</button></article></div></div></section><Widget cartCount={cart ? 1 : 0} add={(product, quantity) => setCart({ product, quantity })} />
  </main>
}

export default App
