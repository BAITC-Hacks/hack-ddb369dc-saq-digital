import { FileText } from '@phosphor-icons/react'
import type { ApiProduct } from './types'
import type { UiText } from './i18n'
import { safeLink } from './lib/links'

function propertyText(value: unknown, t: UiText): string {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? t.propertyYes : t.propertyNo
  if (value !== null && value !== undefined && typeof value === 'object') return t.unsupportedProperty
  return t.notProvided
}

export function ProductEvidence({ product, alternative, alternativeReason, t }: {
  product: ApiProduct; alternative: boolean; alternativeReason?: string; t: UiText
}) {
  const normalized = [
    [t.productBrand, product.brand],
    [t.productPoles, product.poles == null ? undefined : `${product.poles}P`],
    [t.productCurve, product.curve],
    [t.productCurrent, product.amps == null ? undefined : `${product.amps} A`],
    [t.productCapacity, product.breakingCapacityKa == null ? undefined : `${product.breakingCapacityKa} kA`],
    [t.productPack, product.minimumOrderQuantity == null ? undefined : String(product.minimumOrderQuantity)],
  ].filter((entry) => entry[1] !== undefined && entry[1] !== null && entry[1] !== '')
  const properties = Object.entries(product.properties ?? {})
  const certificates = (product.certificates ?? []).map((certificate) => ({ ...certificate, href: safeLink(certificate.url) }))
  const validCertificates = certificates.filter((certificate) => certificate.href)

  return <div className="product-evidence">
    {product.technicalIssue && <div className="evidence-warning"><strong>{t.technicalWarning}</strong><p lang="ru">{product.technicalIssue}</p></div>}
    {alternative && <section className="alternative-evidence">
      <h4>{t.whyAlternative}</h4>
      {alternativeReason?.trim() ? <p lang="ru">{alternativeReason}</p> : <p>{t.missingReason}</p>}
      <p className="evidence-note">{t.compatibilityCaution}</p>
    </section>}
    <details className="evidence-details">
      <summary>{t.productEvidence}</summary>
      <p className="evidence-note">{t.catalogEvidenceSource}</p>
      {normalized.length > 0 && <dl className="property-list">{normalized.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
      {properties.length > 0 && <><h4>{t.catalogProperties}</h4><dl className="property-list">{properties.map(([key, value]) => <div key={key}><dt lang="ru">{key}</dt><dd lang={typeof value === 'string' ? 'ru' : undefined}>{propertyText(value, t)}</dd></div>)}</dl></>}
      {normalized.length === 0 && properties.length === 0 && <p className="evidence-note">{t.noSpecifications}</p>}
      <h4>{t.warehouseStock}</h4>
      {product.stores?.length ? <dl className="property-list">{product.stores.map((store, index) => <div key={`${store.id}-${index}`}><dt lang={store.name.trim() ? 'ru' : undefined}>{store.name.trim() || t.unnamedWarehouse}</dt><dd>{store.quantity} {t.piece}</dd></div>)}</dl> : <p className="evidence-note">{t.noWarehouseStock}</p>}
    </details>
    <section className="certificate-evidence">
      <h4>{t.productCertificates}{validCertificates.length > 0 ? ` (${validCertificates.length})` : ''}</h4>
      {validCertificates.length > 0 ? <ul className="certificates">{validCertificates.map((certificate, index) => <li key={`${certificate.href}-${index}`}><a className="certificate" href={certificate.href} target="_blank" rel="noopener noreferrer"><FileText size={16} aria-hidden="true" /><span lang={certificate.name.trim() ? 'ru' : undefined}>{certificate.name.trim() || t.unnamedCertificate}</span><span className="evidence-note"> · {t.opensNewTab}</span></a></li>)}</ul> : <p className="evidence-note">{t.noCertificates}</p>}
      {certificates.length !== validCertificates.length && <p className="evidence-note">{t.invalidCertificates}</p>}
    </section>
  </div>
}
