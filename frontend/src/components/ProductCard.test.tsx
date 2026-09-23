import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ProductCard } from './ProductCard'
import { safeLink } from '../lib/links'
import type { Product } from '../types'

afterEach(cleanup)

const product: Product = {
  id: 'partner-fixture', sku: 'PARTNER-ITEM', name: 'Товар партнёра', stock: 12, price: 500,
  isExactMatch: true, recommendation: 'Из каталога.', minimumOrderQuantity: 3,
  properties: { 'Материал': 'Пластик', 'Масса': 200, 'Служебное': { hidden: true } },
  technicalIssue: 'Характеристики требуют проверки.',
  certificates: [{ name: 'Паспорт', url: 'https://example.org/passport.pdf' }, { name: 'Опасная ссылка', url: 'javascript:alert(1)' }],
}

it('shows supplied properties, certificates and technical issues, and respects order multiples', () => {
  const choose = vi.fn()
  const view = render(<ProductCard product={product} quantity={2} choose={choose} />)
  expect(screen.getByText('Пластик')).toBeInTheDocument()
  expect(screen.getByText('200')).toBeInTheDocument()
  expect(screen.queryByText('Служебное')).not.toBeInTheDocument()
  expect(screen.getByText('Характеристики требуют проверки.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Паспорт' })).toHaveAttribute('href', 'https://example.org/passport.pdf')
  expect(screen.queryByRole('link', { name: 'Опасная ссылка' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Недоступно/ })).toBeDisabled()
  expect(choose).not.toHaveBeenCalled()
  view.rerender(<ProductCard product={product} quantity={3} choose={choose} />)
  fireEvent.click(screen.getByRole('button', { name: /Выбрать/ }))
  expect(choose).toHaveBeenCalledWith(product, screen.getByRole('button', { name: /Выбрать/ }))
})

it('accepts only HTTP certificate and source links', () => {
  expect(safeLink('https://example.org/source')).toBe('https://example.org/source')
  expect(safeLink('http://example.org/source')).toBe('http://example.org/source')
  for (const link of [undefined, 'not-a-url', 'javascript:alert(1)', 'data:text/html,test']) expect(safeLink(link)).toBeUndefined()
})
