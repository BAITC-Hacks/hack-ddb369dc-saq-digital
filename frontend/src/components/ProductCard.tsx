import { ArrowRight, FileText } from '@phosphor-icons/react'
import { money } from '../lib/format'
import { safeLink } from '../lib/links'
import { translations } from '../i18n'
import type { UiText } from '../i18n'
import type { Product } from '../types'

export function ProductCard({ product, quantity, choose, t = translations.ru, busy = false }: {
  product: Product
  quantity: number
  choose: (product: Product, trigger: HTMLButtonElement) => void
  t?: UiText
  busy?: boolean
}) {
  const validMultiple = !product.minimumOrderQuantity || quantity % product.minimumOrderQuantity === 0
  const available = quantity > 0 && product.stock >= quantity && validMultiple
  const specifications = [product.poles, product.curve && product.amperage ? `${product.curve}${product.amperage}` : undefined, product.breakingCapacity].filter(Boolean)
  const properties = Object.entries(product.properties ?? {}).filter(([, value]) => typeof value === 'string' || typeof value === 'number').slice(0, 3)
  const certificates = product.certificates ?? (product.certificateUrl ? [{ name: t.certificate, url: product.certificateUrl }] : [])
  return <article className="suggestion">
    <div className="suggestion-top">
      <span className={product.isExactMatch ? 'tag tag-muted' : 'tag'}>{product.isExactMatch ? t.exactMatch : t.compatible}</span>
      <span className={available ? 'stock ok' : 'stock out'}><i />{available ? `${t.inStock}: ${product.stock} ${t.piece}` : product.stock > 0 ? `${t.remainingStock}: ${product.stock} ${t.piece}` : t.outOfStock}</span>
    </div>
    <p className="sku">{product.sku}</p>
    <h3 lang="ru">{product.name}</h3>
    <p className="specs">{specifications.join(' · ') || t.unspecified}</p>
    {properties.length > 0 && <dl className="property-list" lang="ru">{properties.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl>}
    {product.technicalIssue && <p className="reason" lang="ru">{product.technicalIssue}</p>}
    <p className="reason" lang="ru">{product.recommendation}</p>
    {!validMultiple && <p className="reason">{t.multipleOf} {product.minimumOrderQuantity} {t.piece}</p>}
    <div className="certificates">{certificates.map((certificate) => {
      const href = safeLink(certificate.url)
      return href && <a className="certificate" href={href} key={certificate.url} target="_blank" rel="noreferrer" lang="ru"><FileText size={14} aria-hidden="true" /> {certificate.name}</a>
    })}</div>
    <footer>
      <strong>{money.format(product.price)}</strong>
      <div className="card-actions">
        <button type="button" disabled={!available} aria-disabled={busy || !available} onClick={(event) => { if (!busy) choose(product, event.currentTarget) }}>{available ? t.choose : t.unavailable} <ArrowRight size={15} weight="bold" /></button>
      </div>
    </footer>
  </article>
}
