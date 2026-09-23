import { useEffect, useRef } from 'react'
import { money } from '../lib/format'
import { translations } from '../i18n'
import type { Language } from '../i18n'
import type { Cart } from '../types'
import { ErrorText } from './ErrorText'
import type { UiError } from './ErrorText'

export function CartPage({ cart, loading, error, retry, language }: { cart: Cart; loading: boolean; error: UiError | null; retry: () => void; language: Language | null }) {
  const t = translations[language ?? 'ru']
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { headingRef.current?.focus() }, [])
  useEffect(() => {
    const previousTitle = document.title
    document.title = `${t.cart} — EKT`
    return () => { document.title = previousTitle }
  }, [t.cart])
  return <section className="cart-page" aria-labelledby="cart-title" lang={language ?? 'ru'}>
    <a href="/">← {t.backCatalog}</a>
    <h1 id="cart-title" ref={headingRef} tabIndex={-1}>{t.cart}</h1>
    {loading ? <p role="status">{t.loadingCart}</p> : error ? <p role="alert"><ErrorText error={error} t={t} /> <button type="button" onClick={retry}>{t.retry}</button></p> : <>
      {cart.items.length === 0 ? <p>{t.emptyCart}</p> : <>
        <div className="cart-table-wrap"><table className="cart-table">
          <thead><tr><th scope="col">{t.product}</th><th scope="col">{t.quantity}</th><th scope="col">{t.price}</th><th scope="col">{t.lineTotal}</th></tr></thead>
          <tbody>{cart.items.map((item) => <tr key={item.sku}><td><strong lang="ru">{item.name}</strong><span className="sku">{item.sku}</span></td><td>{item.quantity} {t.piece}</td><td>{money.format(item.unitPriceKzt)}</td><td>{money.format(item.lineTotalKzt)}</td></tr>)}</tbody>
        </table></div>
        <p className="cart-total">{t.total}: <strong>{money.format(cart.totalPriceKzt)}</strong></p>
      </>}
      <p className="cart-disclaimer">{t.cartDisclaimer}</p>
    </>}
  </section>
}
