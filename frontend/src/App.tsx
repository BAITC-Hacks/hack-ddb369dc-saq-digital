import { useCallback, useEffect, useRef, useState } from 'react'
import { Heart, List, MagnifyingGlass, MapPin, Phone, ShoppingCart, UserCircle } from '@phosphor-icons/react'
import configuration from '../config.json'
import { AssistantWidget } from './components/AssistantWidget'
import { CartPage } from './components/CartPage'
import { getCart } from './lib/api'
import type { Cart } from './types'

function App() {
  const [cart, setCart] = useState<Cart>({ items: [], totalPriceKzt: 0, cartUrl: configuration.cartPath })
  const [cartLoading, setCartLoading] = useState(true)
  const [cartError, setCartError] = useState('')
  const cartVersion = useRef(0)
  const refreshCart = useCallback(async () => {
    const version = ++cartVersion.current
    setCartLoading(true); setCartError('')
    try {
      const next = await getCart()
      if (cartVersion.current === version) setCart(next)
    } catch {
      if (cartVersion.current === version) setCartError('Не удалось загрузить корзину.')
    } finally {
      if (cartVersion.current === version) setCartLoading(false)
    }
  }, [])
  useEffect(() => { void refreshCart() }, [refreshCart])
  const updateCart = (next: Cart) => {
    cartVersion.current += 1
    setCart(next); setCartError(''); setCartLoading(false)
  }
  const cartUrl = cart.cartUrl ?? configuration.cartPath
  const cartPath = new URL(cartUrl, window.location.origin).pathname.replace(/\/$/, '')
  const isCartPage = window.location.pathname.replace(/\/$/, '') === cartPath

  return <main className="store">
    <div className="site-top">
      <div className="site-top__inner"><button type="button"><MapPin size={14} weight="fill" /> Алматы</button><div className="site-top__links"><a href="#account"><UserCircle size={14} /> Личный кабинет</a><a href="#b2b">B2B - EKT PRO</a><a href="#buyers">Покупателям</a><a href="#request">Оставить заявку</a><a href="#kz">ҚАЗ</a></div><a className="phones" href="tel:+77273468888"><Phone size={14} weight="fill" /> +7 (727) 346-88-88<br />+7 (778) 046-88-88</a></div>
    </div>
    <header className="store-header">
      <a className="brand" href="/" aria-label="Группа компаний Электрокомплект"><span>ГРУППА КОМПАНИЙ</span>ЭЛЕКТРОКОМПЛЕКТ</a>
      <a className="catalog-button" href="/#catalog">Каталог <List size={19} weight="bold" /></a>
      <label className="site-search"><MagnifyingGlass size={20} /><input placeholder="Поиск — через помощника EKT" readOnly aria-label="Для поиска откройте помощника EKT" /></label>
      <div className="header-actions"><a href="#compare">Сравнить</a><a href="#favorites"><Heart size={18} /> Избранное</a><a href={cartUrl}><ShoppingCart size={19} /> Корзина <b>{cart.items.length}</b></a></div>
    </header>
    {isCartPage ? <CartPage cart={cart} loading={cartLoading} error={cartError} retry={() => void refreshCart()} /> : <>
      {cartError && <p className="cart-load-error" role="alert">{cartError} <button type="button" onClick={() => void refreshCart()}>Повторить</button></p>}
      <section className="showcase" aria-label="Специальные предложения">
        <article className="showcase-main"><div className="promo-copy"><p className="promo-brand">Промрукав</p><h1>МОНТАЖНЫЕ <strong>РЕШЕНИЯ</strong></h1><span>ЖАНА / НОВИНКА!</span></div><div className="product-assembly" aria-hidden="true"><i className="assembly-box" /><i className="assembly-rail" /><i className="assembly-cover" /><i className="assembly-tube" /></div></article>
        <article className="showcase-side"><span>CHiNT</span><div className="breaker-pair" aria-hidden="true"><i /><i /></div><small>Низковольтная аппаратура</small></article>
      </section>
      <section className="catalog" id="catalog"><h2>Каталог продукции</h2><div className="category-bar"><a href="#cable">Кабель / Провод</a><a href="#light">Светильники / Лампы</a><a href="#low">Низковольтная аппаратура</a><a href="#tools">Монтаж и инструмент</a><a href="#cabinet">Шкафы / Щиты</a></div></section>
      <AssistantWidget cartUrl={cartUrl} updateCart={updateCart} />
    </>}
  </main>
}

export default App
