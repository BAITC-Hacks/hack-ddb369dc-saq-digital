import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import { addToCart, ApiError, getCart, searchCatalog } from './lib/api'
import { translations } from './i18n'
import type { SearchResponse } from './types'

vi.mock('./lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/api')>(),
  getCart: vi.fn(), searchCatalog: vi.fn(), addToCart: vi.fn(),
}))

const answer: SearchResponse = { intent: 'purchase_terms', answer: 'Условия оплаты', filters: null, exactMatch: null, alternatives: [] }
const question = 'Нужен DEMO-MCB-003'
const timeout = () => new ApiError('timeout', 0, 'REQUEST_TIMEOUT')
const input = () => screen.getByRole('textbox', { name: /Сообщение помощнику EKT|EKT көмекшісіне хабарлама/ })
function send(value: string) {
  fireEvent.change(input(), { target: { value } })
  fireEvent.submit(input().closest('form')!)
}

beforeEach(() => {
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
  vi.mocked(getCart).mockResolvedValue({ items: [], totalPriceKzt: 0, cartUrl: '/cart' })
  vi.mocked(searchCatalog).mockRejectedValue(timeout())
})
afterEach(() => { cleanup(); vi.resetAllMocks(); window.localStorage.clear() })

it('retries the original question in its session, keeps the draft and prevents concurrent sends', async () => {
  let finish!: (result: SearchResponse) => void
  vi.mocked(searchCatalog).mockRejectedValueOnce(timeout()).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  render(<App />)
  send(question)
  const retry = await screen.findByRole('button', { name: 'Повторить вопрос' })
  const originalCall = vi.mocked(searchCatalog).mock.calls[0]
  fireEvent.change(input(), { target: { value: 'Мой следующий вопрос' } })
  act(() => retry.focus())
  fireEvent.click(retry)
  fireEvent.click(retry)
  fireEvent.submit(input().closest('form')!)
  expect(searchCatalog).toHaveBeenCalledTimes(2)
  expect(vi.mocked(searchCatalog).mock.calls[1]).toEqual(originalCall)
  expect(input()).toHaveValue('Мой следующий вопрос')
  expect(input()).toHaveFocus()
  expect(screen.getByRole('button', { name: 'Новый чат' })).toBeDisabled()
  await act(async () => finish(answer))
  expect(screen.getByText(answer.answer)).toBeInTheDocument()
  expect(within(screen.getByRole('log')).getAllByText(question)).toHaveLength(2)
  expect(screen.queryByRole('button', { name: 'Повторить вопрос' })).not.toBeInTheDocument()
  expect(addToCart).not.toHaveBeenCalled()
})

it('uses search-specific timeout guidance without a misleading cart warning', async () => {
  render(<App />)
  send(question)
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Ответ не получен вовремя. Вопрос сохранён в переписке. Попробуйте ещё раз.')
  expect(alert).not.toHaveTextContent('корзину')
})

it('retains the original Kazakh query mapping after switching the interface to Russian', async () => {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Қазақша' }))
  send(translations.kk.termsQuery)
  await screen.findByRole('button', { name: 'Сұрақты қайталау' })
  fireEvent.click(screen.getByRole('button', { name: 'Русский' }))
  fireEvent.click(screen.getByRole('button', { name: 'Повторить вопрос' }))
  await screen.findByRole('button', { name: 'Повторить вопрос' })
  expect(vi.mocked(searchCatalog).mock.calls[1]).toEqual(vi.mocked(searchCatalog).mock.calls[0])
  expect(vi.mocked(searchCatalog).mock.calls[1][0]).toBe('оплата шарттары қандай?')
  for (const message of screen.getAllByText(translations.kk.termsQuery)) expect(message).toHaveAttribute('lang', 'kk')
})

it('does not offer retries for rejected client input or older failures', async () => {
  vi.mocked(searchCatalog).mockRejectedValueOnce(new ApiError('Проверьте запрос', 400, 'INVALID_QUERY'))
  render(<App />)
  send(question)
  await screen.findByRole('alert')
  expect(screen.queryByRole('button', { name: 'Повторить вопрос' })).not.toBeInTheDocument()
  send('Другой вопрос')
  await screen.findByRole('button', { name: 'Повторить вопрос' })
  vi.mocked(searchCatalog).mockResolvedValueOnce(answer)
  send('Условия покупки')
  await screen.findByText(answer.answer)
  expect(screen.queryByRole('button', { name: 'Повторить вопрос' })).not.toBeInTheDocument()
})

it('does not replay a restored failure with lost server context', async () => {
  const view = render(<App />)
  send(question)
  await screen.findByRole('button', { name: 'Повторить вопрос' })
  view.unmount()
  render(<App />)
  expect(screen.getByText(question)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Повторить вопрос' })).not.toBeInTheDocument()
  expect(searchCatalog).toHaveBeenCalledTimes(1)
})
