import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { addToCart, getCart } from './lib/api'
import { createUpload, createUploadSession, getUploadCapabilities } from './lib/uploads'
import type { UploadJob } from './uploadTypes'

vi.mock('./lib/api', async (original) => ({ ...await original<typeof import('./lib/api')>(), getCart: vi.fn(), addToCart: vi.fn() }))
vi.mock('./lib/uploads', async (original) => ({ ...await original<typeof import('./lib/uploads')>(), getUploadCapabilities: vi.fn(), createUploadSession: vi.fn(), createUpload: vi.fn() }))

const product = { sku: 'DEMO-MCB-003', name: 'Автомат для проверки', priceKzt: 1000, stock: 12 }
const job = (): UploadJob => ({
  uploadId: 'job-1', requestId: 'request-1', status: 'completed',
  file: { name: 'test-invoice.pdf', mimeType: 'application/pdf', sizeBytes: 12 },
  createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 900_000).toISOString(),
  warnings: [], truncated: false, error: null,
  items: ['1', '2'].map((lineId) => ({
    lineId, description: `Строка ${lineId}`, sourceText: `private-file-line-${lineId}`,
    article: product.sku, quantity: null, unit: null,
    specifications: { poles: null, curve: null, amps: null, breakingCapacityKa: null },
    matchStatus: 'matched', matchCount: 1, requiresReview: true, warnings: [],
    candidates: [{ product, reason: 'Совпадает артикул', canFulfill: null, canAddToCart: false }],
  })),
})
beforeEach(() => {
  window.history.replaceState({}, '', '/')
  window.localStorage.clear()
  vi.mocked(getCart).mockResolvedValue({ items: [], totalPriceKzt: 0, cartUrl: '/cart' })
  vi.mocked(getUploadCapabilities).mockResolvedValue({ enabled: true, maxFiles: 1, maxFileBytes: 921600, maxItems: 50, resultTtlSeconds: 900, pollIntervalMs: 1000, formats: [{ extensions: ['.pdf'], mimeType: 'application/pdf' }] })
  vi.mocked(createUploadSession).mockResolvedValue('upload-session')
  vi.mocked(createUpload).mockResolvedValue(job())
  vi.mocked(addToCart).mockResolvedValue({ items: [{ sku: product.sku, name: product.name, quantity: 2, unitPriceKzt: 1000, lineTotalKzt: 2000 }], totalPriceKzt: 2000, cartUrl: '/cart' })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); window.localStorage.clear() })

async function upload() {
  fireEvent.click(screen.getByText('Прикрепить файл'))
  const input = screen.getByLabelText('Файл спецификации или фото')
  await waitFor(() => expect(input).toBeEnabled())
  fireEvent.change(input, { target: { files: [new File(['%PDF-1.4'], 'test-invoice.pdf', { type: 'application/pdf' })] } })
  expect(createUpload).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Распознать файл' }))
  await screen.findByText('private-file-line-1')
}
function chooseLine(index: number) {
  const line = screen.getByRole('heading', { name: `Позиция ${index}` }).closest('article')!
  const scope = within(line)
  expect(scope.getByRole('spinbutton')).toHaveValue(null)
  expect(scope.getByRole('button', { name: 'Проверить и выбрать' })).toBeDisabled()
  fireEvent.change(scope.getByRole('spinbutton'), { target: { value: '2' } })
  fireEvent.click(scope.getByRole('checkbox'))
  fireEvent.click(scope.getByRole('button', { name: 'Проверить и выбрать' }))
}

it('requires cart confirmation, preserves remaining lines after cart return and gives each purchase a new ID', async () => {
  render(<App />)
  await upload()
  expect(addToCart).not.toHaveBeenCalled()
  chooseLine(1)
  expect(screen.getByRole('dialog', { name: 'Добавить товар в корзину?' })).toBeInTheDocument()
  expect(addToCart).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Да, добавить' }))
  await screen.findByRole('heading', { name: 'Корзина' })
  fireEvent.click(screen.getByRole('link', { name: 'Вернуться в каталог' }))
  fireEvent.click(screen.getByText('Прикрепить файл'))
  chooseLine(2)
  expect(addToCart).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Да, добавить' }))
  await screen.findByRole('heading', { name: 'Корзина' })
  expect(addToCart).toHaveBeenCalledTimes(2)
  expect(vi.mocked(addToCart).mock.calls[1][2]).not.toBe(vi.mocked(addToCart).mock.calls[0][2])
  expect(createUpload).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(window.localStorage)).not.toMatch(/private-file-line|test-invoice|upload-session/)
})

it('does not carry one chat’s extracted file into a different chat', async () => {
  render(<App />)
  await upload()
  fireEvent.click(screen.getByRole('button', { name: 'Новый чат' }))
  expect(screen.queryByText('private-file-line-1')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'История чатов' }))
  fireEvent.click(screen.getByRole('button', { name: 'test-invoice.pdf' }))
  fireEvent.click(screen.getByText('Прикрепить файл'))
  expect(screen.getByText('private-file-line-1')).toBeInTheDocument()
  expect(createUpload).toHaveBeenCalledTimes(1)
  expect(addToCart).not.toHaveBeenCalled()
})

it('blocks an unsubmitted confirmation when its source upload expires', async () => {
  const result = job()
  render(<App />)
  vi.mocked(createUpload).mockResolvedValue(result)
  await upload()
  chooseLine(1)
  vi.useFakeTimers()
  vi.setSystemTime(Date.parse(result.expiresAt) + 1)
  fireEvent.click(screen.getByRole('button', { name: 'Да, добавить' }))
  expect(addToCart).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Да, добавить' })).toBeDisabled()
  expect(within(screen.getByRole('dialog', { name: 'Добавить товар в корзину?' })).getByRole('alert')).toHaveTextContent('Результат устарел')
  await act(async () => {})
})
