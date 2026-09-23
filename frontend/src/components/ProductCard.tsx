import { ArrowRight, FileText } from '@phosphor-icons/react'
import { money } from '../lib/format'
import { safeLink } from '../lib/links'
import type { Product } from '../types'

export function ProductCard({ product, quantity, choose }: { product: Product; quantity: number; choose: (product: Product) => void }) {
  const validMultiple = !product.minimumOrderQuantity || quantity % product.minimumOrderQuantity === 0
  const available = quantity > 0 && product.stock >= quantity && validMultiple
  const specifications = [product.poles, product.curve && product.amperage ? `${product.curve}${product.amperage}` : undefined, product.breakingCapacity].filter(Boolean)
  const properties = Object.entries(product.properties ?? {}).filter(([, value]) => typeof value === 'string' || typeof value === 'number').slice(0, 3)
  const certificates = product.certificates ?? (product.certificateUrl ? [{ name: 'Сертификат', url: product.certificateUrl }] : [])
  return <article className="suggestion">
    <div className="suggestion-top">
      <span className={product.isExactMatch ? 'tag tag-muted' : 'tag'}>{product.isExactMatch ? 'Точное совпадение' : 'Кандидат в аналоги'}</span>
      <span className={available ? 'stock ok' : 'stock out'}><i />{available ? `В наличии: ${product.stock} шт.` : product.stock > 0 ? `Остаток: ${product.stock} шт.` : 'Нет в наличии'}</span>
    </div>
    <p className="sku">{product.sku}</p>
    <h3>{product.name}</h3>
    <p className="specs">{specifications.join(' · ') || 'Характеристики не указаны'}</p>
    {properties.length > 0 && <dl className="property-list">{properties.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl>}
    {product.technicalIssue && <p className="reason">{product.technicalIssue}</p>}
    <p className="reason">{product.recommendation}</p>
    {!validMultiple && <p className="reason">Количество должно быть кратно {product.minimumOrderQuantity} шт.</p>}
    <div className="certificates">{certificates.map((certificate) => {
      const href = safeLink(certificate.url)
      return href && <a className="certificate" href={href} key={certificate.url} target="_blank" rel="noreferrer"><FileText size={14} /> {certificate.name}</a>
    })}</div>
    <footer>
      <strong>{money.format(product.price)}</strong>
      <div className="card-actions">
        <button type="button" disabled={!available} onClick={() => choose(product)}>{available ? 'Выбрать' : 'Недоступно'} <ArrowRight size={15} weight="bold" /></button>
      </div>
    </footer>
  </article>
}
