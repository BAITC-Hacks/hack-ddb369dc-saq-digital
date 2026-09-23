import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ProductEvidence } from './ProductEvidence'
import { translations } from './i18n'
import type { ApiProduct } from './types'

afterEach(cleanup)
const product: ApiProduct = { sku: 'P1', name: 'Автомат', stock: 5, priceKzt: 1000 }
describe('catalog evidence', () => {
  it('shows every property rather than truncating to three, including false and zero', () => {
    render(<ProductEvidence product={{ ...product, brand: 'Brand', poles: 3, curve: 'C', amps: 16, breakingCapacityKa: 10, properties: { Первый: 'Один', Второй: 'Два', Третий: 'Три', Четвёртый: 'Четыре', Нулевой: 0, Флаг: false } }} alternative={false} t={translations.ru} />)
    expect(screen.getByText('Четыре')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('Нет')).toBeInTheDocument()
    expect(screen.getByText('16 A')).toBeInTheDocument()
    expect(screen.getByText('Характеристики и наличие').closest('details')).not.toHaveAttribute('open')
  })
  it('labels unknown fields and missing evidence without inventing certificates or stock locations', () => {
    render(<ProductEvidence product={{ ...product, properties: { Неизвестно: null, Вложенное: { internal: 'do not print' } } }} alternative t={translations.ru} />)
    expect(screen.getAllByText('Не указано').length).toBeGreaterThan(0)
    expect(screen.getByText('Разбивка по складам не предоставлена.')).toBeInTheDocument()
    expect(screen.getByText('Сертификаты не предоставлены в ответе каталога.')).toBeInTheDocument()
    expect(screen.getByText('Обоснование аналога не предоставлено. Уточните совместимость.')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText(/do not print|\[object Object\]/)).not.toBeInTheDocument()
  })
  it('renders API analogy evidence and conflicts prominently without asserting guaranteed compatibility', () => {
    render(<ProductEvidence product={{ ...product, technicalIssue: 'Рейтинги расходятся.' }} alternative alternativeReason="Совпадают 3P C16; 15 kA ≥ 10 kA." t={translations.ru} />)
    expect(screen.getByText('Почему предложен аналог')).toBeInTheDocument()
    expect(screen.getByText('Совпадают 3P C16; 15 kA ≥ 10 kA.')).toHaveAttribute('lang', 'ru')
    expect(screen.getByText('Рейтинги расходятся.')).toBeInTheDocument()
    expect(screen.getByText('Требуется проверка характеристик')).toBeInTheDocument()
  })
  it('shows valid certificate links with new-tab indication and marks unsafe links unavailable', () => {
    render(<ProductEvidence product={{ ...product, certificates: [{ name: 'Паспорт', url: 'https://example.org/p.pdf' }, { name: 'Bad', url: 'javascript:alert(1)' }] }} alternative={false} t={translations.ru} />)
    const link = screen.getByRole('link', { name: /Паспорт/ })
    expect(link).toHaveAttribute('href', 'https://example.org/p.pdf')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAccessibleName(/новой вкладке/)
    expect(screen.getByText('Часть ссылок недоступна или некорректна.')).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })
  it('renders metadata as text and translates UI labels into Kazakh', () => {
    render(<ProductEvidence product={{ ...product, properties: { Название: '<img src=x onerror=alert(1)>' } }} alternative={false} t={translations.kk} />)
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText('Сипаттамалар мен қалдық')).toBeInTheDocument()
    expect(screen.getByText('Сертификаттар')).toBeInTheDocument()
  })
  it('shows warehouse quantities including zero without inferring locations from the total', () => {
    render(<ProductEvidence product={{ ...product, stores: [{ id: 1, name: 'Алматы', quantity: 5 }, { id: 2, name: '', quantity: 0 }] }} alternative={false} t={translations.ru} />)
    expect(screen.getByText('Алматы')).toBeInTheDocument()
    expect(screen.getByText('Склад без названия')).toBeInTheDocument()
    expect(screen.getByText('0 шт.')).toBeInTheDocument()
    expect(screen.queryByText('Разбивка по складам не предоставлена.')).not.toBeInTheDocument()
  })
  it('distinguishes an empty warehouse breakdown from zero stock and rejects credential-bearing certificate links', () => {
    render(<ProductEvidence product={{ ...product, stores: [], certificates: [{ name: 'Private', url: 'https://user:password@example.org/doc.pdf' }] }} alternative={false} t={translations.ru} />)
    expect(screen.getByText('Разбивка по складам не предоставлена.')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('Часть ссылок недоступна или некорректна.')).toBeInTheDocument()
  })
})
