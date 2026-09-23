import { money } from '../lib/format'
import type { Cart } from '../types'

export function CartPage({ cart, loading, error, retry }: { cart: Cart; loading: boolean; error: string; retry: () => void }) {
  return <section className="cart-page" aria-labelledby="cart-title">
    <a href="/">← Вернуться к подбору</a>
    <h1 id="cart-title">Корзина</h1>
    {loading ? <p role="status">Загружаю корзину…</p> : error ? <p role="alert">{error} <button type="button" onClick={retry}>Повторить</button></p> : <>
      {cart.items.length === 0 ? <p>Корзина пока пуста. Выберите товар в помощнике и подтвердите добавление.</p> : <>
        <div className="cart-table-wrap"><table className="cart-table">
          <thead><tr><th scope="col">Товар</th><th scope="col">Количество</th><th scope="col">Цена</th><th scope="col">Сумма</th></tr></thead>
          <tbody>{cart.items.map((item) => <tr key={item.sku}><td><strong>{item.name}</strong><span className="sku">{item.sku}</span></td><td>{item.quantity} шт.</td><td>{money.format(item.unitPriceKzt)}</td><td>{money.format(item.lineTotalKzt)}</td></tr>)}</tbody>
        </table></div>
        <p className="cart-total">Итого: <strong>{money.format(cart.totalPriceKzt)}</strong></p>
      </>}
      <p className="cart-disclaimer">Демонстрационная корзина. Оплата и оформление заказа не выполняются.</p>
    </>}
  </section>
}
