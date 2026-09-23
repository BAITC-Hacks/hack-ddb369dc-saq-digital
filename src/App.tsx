import { useState } from 'react'
import {
  ArrowRight,
  CheckCircle,
  CircleNotch,
  MagnifyingGlass,
  List,
  Package,
  ShieldCheck,
  ShoppingCart,
  Sparkle,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { searchDemoCatalog } from './lib/demoApi'
import type { Product, SearchResult } from './types'

const demoQuery = 'Нужен автомат 3P C16, 10 kA, 8 штук. Если нет — совместимый аналог.'

const priceFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'KZT',
  maximumFractionDigits: 0,
})

function ProductSkeleton() {
  return (
    <div className="result-list" aria-label="Идёт поиск товаров">
      {[1, 2, 3].map((item) => (
        <div className="product-skeleton" key={item}>
          <span className="skeleton skeleton-title" />
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-short" />
        </div>
      ))}
    </div>
  )
}

function ProductCard({ product, onChoose }: { product: Product; onChoose: (product: Product) => void }) {
  const enoughStock = product.stock >= 8

  return (
    <article className={`product-row ${product.isExactMatch ? 'product-row--exact' : ''}`}>
      <div className="product-row__topline">
        <span className={`match-label ${product.isExactMatch ? 'match-label--exact' : ''}`}>
          {product.isExactMatch ? 'Точное совпадение' : 'Рекомендуемый аналог'}
        </span>
        <span className={enoughStock ? 'stock stock--available' : 'stock stock--limited'}>
          <span /> В наличии: {product.stock} шт.
        </span>
      </div>
      <div className="product-row__body">
        <div>
          <p className="product-sku">{product.sku}</p>
          <h3>{product.name}</h3>
          <p className="product-specs">
            {product.poles} <b /> {product.curve}{product.amperage} <b /> {product.breakingCapacity}
          </p>
        </div>
        <p className="product-price">{priceFormatter.format(product.price)}</p>
      </div>
      <p className="product-reason">{product.recommendation}</p>
      <button className="secondary-button" type="button" onClick={() => onChoose(product)}>
        Выбрать позицию <ArrowRight size={18} weight="bold" aria-hidden="true" />
      </button>
    </article>
  )
}

function App() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<SearchResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [cartProduct, setCartProduct] = useState<Product | null>(null)

  const runSearch = async (submittedQuery = query) => {
    const trimmedQuery = submittedQuery.trim()
    if (trimmedQuery.length < 5) {
      setError('Опишите товар хотя бы несколькими словами, например: «автомат 3P C16».')
      return
    }

    setQuery(trimmedQuery)
    setError('')
    setResult(null)
    setIsLoading(true)
    try {
      setResult(await searchDemoCatalog(trimmedQuery))
    } catch {
      setError('Не удалось получить рекомендации. Проверьте соединение или повторите запрос.')
    } finally {
      setIsLoading(false)
    }
  }

  const addToCart = () => {
    if (!selectedProduct) return
    setCartProduct(selectedProduct)
    setSelectedProduct(null)
  }

  return (
    <main className="app-shell">
      <header className="site-header">
        <a className="brand" href="#search" aria-label="Электрокомплект — к каталогу">
          <span className="brand-mark"><Sparkle size={18} weight="fill" aria-hidden="true" /></span>
          <span>ЭЛЕКТРО<strong>КОМПЛЕКТ</strong></span>
        </a>
        <div className="site-actions">
          <span className="city-label">Астана</span>
          <button className="catalog-button" type="button"><List size={18} weight="bold" aria-hidden="true" /> Каталог</button>
          <label className="site-search" aria-label="Поиск по каталогу"><MagnifyingGlass size={18} aria-hidden="true" /><input placeholder="Поиск по каталогу" /></label>
          <a className="header-cart" href="#cart"><ShoppingCart size={19} weight="duotone" aria-hidden="true" /> Корзина <b>{cartProduct ? 1 : 0}</b></a>
        </div>
      </header>

      <section className="catalog-context" aria-labelledby="page-title">
        <p className="breadcrumbs">Каталог / Низковольтная аппаратура / Автоматические выключатели</p>
        <div className="catalog-context__content">
          <div><p className="eyebrow">Каталог EKT.kz</p><h1 id="page-title">Автоматические выключатели</h1><p className="intro-copy">Подберите позицию по характеристикам или спросите встроенного помощника EKT.</p></div>
          <div className="catalog-facts"><span>В наличии</span><strong>1 248 товаров</strong></div>
        </div>
      </section>

      <section className="workspace" id="search" aria-label="Подбор товара">
        <div className="search-panel">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">AI-помощник EKT</p>
              <h2>Помогу подобрать товар</h2>
            </div>
            <ShieldCheck size={27} weight="duotone" aria-label="Подтверждение требуется перед добавлением" />
          </div>

          <label htmlFor="product-query">Технический запрос</label>
          <div className={`query-field ${error ? 'query-field--error' : ''}`}>
            <MagnifyingGlass size={21} aria-hidden="true" />
            <textarea
              id="product-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Например, автомат 3P C16, 10 kA, 8 штук"
              rows={4}
            />
          </div>
          {error && <p className="form-error" role="alert"><WarningCircle size={17} weight="fill" /> {error}</p>}

          <div className="search-actions">
            <button className="text-button" type="button" onClick={() => void runSearch(demoQuery)}>
              Запустить demo-запрос
            </button>
            <button className="primary-button" type="button" onClick={() => void runSearch()} disabled={isLoading}>
              {isLoading ? <CircleNotch className="spin" size={19} aria-hidden="true" /> : <Sparkle size={19} weight="fill" aria-hidden="true" />}
              Найти позицию
            </button>
          </div>
          <p className="helper-text">Ассистент использует данные каталога EKT. Товар не попадёт в корзину без вашего явного подтверждения.</p>
        </div>

        <aside className="cart-panel" id="cart" aria-label="Корзина EKT.kz" aria-live="polite">
          <div className="cart-panel__heading">
            <div><p className="panel-kicker">EKT.kz</p><h2>Корзина</h2></div>
            <span className="cart-count">{cartProduct ? 1 : 0}</span>
          </div>
          {cartProduct ? (
            <div className="cart-item">
              <div className="cart-item__icon"><Package size={24} weight="duotone" aria-hidden="true" /></div>
              <div><p>Добавлено в корзину EKT.kz</p><strong>{cartProduct.name}</strong><span>8 шт. · {priceFormatter.format(cartProduct.price * 8)}</span></div>
            </div>
          ) : (
            <div className="cart-empty">
              <ShoppingCart size={29} weight="duotone" aria-hidden="true" />
              <p>Корзина пуста</p>
              <span>Выберите товар из рекомендаций.</span>
            </div>
          )}
        </aside>
      </section>

      <section className="results" aria-live="polite" aria-label="Рекомендации">
        {isLoading && <ProductSkeleton />}
        {!isLoading && result && (
          <>
            <div className="result-heading">
              <div><p className="eyebrow">Результат подбора</p><h2>Рекомендации по запросу</h2></div>
              <span className="query-chip">{result.interpretedQuery}</span>
            </div>
            <p className="result-message">{result.message}</p>
            {result.products.length > 0 ? (
              <div className="result-list">{result.products.map((product) => <ProductCard key={product.id} product={product} onChoose={setSelectedProduct} />)}</div>
            ) : (
              <div className="empty-results"><Package size={32} weight="duotone" aria-hidden="true" /><h3>Подходящих позиций не найдено</h3><p>Попробуйте уточнить номинал или свяжитесь с менеджером.</p></div>
            )}
          </>
        )}
      </section>

      {selectedProduct && (
        <div className="modal-backdrop" role="presentation">
          <section className="confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="confirmation-title">
            <button className="close-button" type="button" onClick={() => setSelectedProduct(null)} aria-label="Закрыть подтверждение"><X size={20} /></button>
            <div className="confirmation-icon"><CheckCircle size={29} weight="fill" aria-hidden="true" /></div>
            <p className="panel-kicker">Подтверждение действия</p>
            <h2 id="confirmation-title">Добавить товар в корзину?</h2>
            <p className="confirmation-product">{selectedProduct.sku}<br /><strong>{selectedProduct.name}</strong></p>
            <div className="confirmation-meta"><span>Количество <b>8 шт.</b></span><span>Итого <b>{priceFormatter.format(selectedProduct.price * 8)}</b></span></div>
            <div className="modal-actions">
              <button className="ghost-button" type="button" onClick={() => setSelectedProduct(null)}>Отмена</button>
              <button className="primary-button" type="button" onClick={addToCart}>Добавить в корзину EKT</button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
