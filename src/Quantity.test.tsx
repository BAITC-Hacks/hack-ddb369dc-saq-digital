import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { addToCart, ApiError, getCart, searchCatalog } from './lib/api'
import type { ApiProduct, SearchResponse } from './types'

vi.mock('./lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./lib/api')>()
  return { ...original, getCart: vi.fn(), searchCatalog: vi.fn(), addToCart: vi.fn() }
})

const emptyCart = { items: [], totalPriceKzt: 0, cartUrl: '/cart' }
const product: ApiProduct = { sku: 'QTY-16', name: 'Автомат C16', stock: 12, priceKzt: 7900 }
const result = (item = product, quantity = 8): SearchResponse => ({
  intent: 'product', answer: 'Товар найден.', filters: { quantity },
  exactMatch: { product: item, canFulfill: item.stock >= quantity }, alternatives: [],
})

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  window.localStorage.clear()
  vi.mocked(getCart).mockResolvedValue(emptyCart)
  vi.mocked(searchCatalog).mockResolvedValue(result())
  vi.mocked(addToCart).mockResolvedValue(emptyCart)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
})

async function openConfirmation(buttonName = 'Выбрать') {
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Demo' }))
  fireEvent.click(await screen.findByRole('button', { name: buttonName }))
  return screen.getByRole('dialog', { name: 'Добавить товар в корзину?' })
}

describe('quantity selection before cart confirmation', () => {
  it('starts with the requested quantity, updates the total and submits only after explicit confirmation', async () => {
    const modal = await openConfirmation()
    const input = within(modal).getByRole('spinbutton', { name: 'Количество' })
    expect(input).toHaveValue(8)
    expect(modal).toHaveTextContent(/63\s*200/)
    fireEvent.change(input, { target: { value: '3' } })
    expect(modal).toHaveTextContent(/23\s*700/)
    expect(addToCart).not.toHaveBeenCalled()
    fireEvent.click(within(modal).getByRole('button', { name: 'Да, добавить' }))
    expect(addToCart).toHaveBeenCalledWith('QTY-16', 3, expect.any(String))
    await screen.findByRole('heading', { name: 'Корзина' })
  })

  it('rejects blank, nonpositive, fractional, unsafe and above-stock quantities without a request', async () => {
    const modal = await openConfirmation()
    const input = within(modal).getByRole('spinbutton', { name: 'Количество' })
    const submit = within(modal).getByRole('button', { name: 'Да, добавить' })
    for (const value of ['', '0', '-1', '1.5', '9007199254740992', '13']) {
      fireEvent.change(input, { target: { value } })
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(input).toHaveAccessibleDescription()
      expect(submit).toBeDisabled()
      fireEvent.click(submit)
    }
    expect(addToCart).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '12' } })
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
    expect(submit).toBeEnabled()
  })

  it('steps by the pack size and prevents stepping below the minimum or beyond stock', async () => {
    vi.mocked(searchCatalog).mockResolvedValue(result({ ...product, stock: 10, minimumOrderQuantity: 2 }))
    const modal = await openConfirmation()
    const input = within(modal).getByRole('spinbutton', { name: 'Количество' })
    const decrease = within(modal).getByRole('button', { name: 'Уменьшить количество' })
    const increase = within(modal).getByRole('button', { name: 'Увеличить количество' })
    expect(input).toHaveAttribute('min', '2')
    expect(input).toHaveAttribute('step', '2')
    expect(input).toHaveAttribute('max', '10')
    fireEvent.click(increase)
    expect(input).toHaveValue(10)
    expect(increase).toBeDisabled()
    fireEvent.click(decrease)
    expect(input).toHaveValue(8)
    fireEvent.change(input, { target: { value: '2' } })
    expect(decrease).toBeDisabled()
    fireEvent.change(input, { target: { value: '3' } })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(within(modal).getByRole('button', { name: 'Да, добавить' })).toBeDisabled()
    expect(addToCart).not.toHaveBeenCalled()
  })

  it('allows correcting a request that exceeds positive stock rather than hiding purchase controls', async () => {
    vi.mocked(searchCatalog).mockResolvedValue(result({ ...product, stock: 3 }))
    const modal = await openConfirmation('Изменить количество')
    const input = within(modal).getByRole('spinbutton', { name: 'Количество' })
    expect(input).toHaveValue(8)
    expect(within(modal).getByRole('button', { name: 'Да, добавить' })).toBeDisabled()
    expect(within(modal).getByRole('button', { name: 'Увеличить количество' })).toBeDisabled()
    fireEvent.change(input, { target: { value: '3' } })
    expect(within(modal).getByRole('button', { name: 'Да, добавить' })).toBeEnabled()
    expect(addToCart).not.toHaveBeenCalled()
  })

  it('allows correcting a requested quantity that is not a pack multiple', async () => {
    vi.mocked(searchCatalog).mockResolvedValue(result({ ...product, minimumOrderQuantity: 3 }))
    const modal = await openConfirmation('Изменить количество')
    const input = within(modal).getByRole('spinbutton', { name: 'Количество' })
    expect(input).toHaveValue(8)
    expect(within(modal).getByRole('button', { name: 'Да, добавить' })).toBeDisabled()
    fireEvent.change(input, { target: { value: '6' } })
    expect(within(modal).getByRole('button', { name: 'Да, добавить' })).toBeEnabled()
  })

  it('keeps zero-stock products unavailable', async () => {
    vi.mocked(searchCatalog).mockResolvedValue(result({ ...product, stock: 0 }))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Demo' }))
    const unavailable = await screen.findByRole('button', { name: 'Недоступно' })
    expect(unavailable).toBeDisabled()
    fireEvent.click(unavailable)
    expect(screen.queryByRole('dialog', { name: 'Добавить товар в корзину?' })).not.toBeInTheDocument()
    expect(addToCart).not.toHaveBeenCalled()
  })

  it('locks the submitted quantity during a pending request and timeout retry with the same confirmation ID', async () => {
    let rejectRequest!: (error: Error) => void
    vi.mocked(addToCart).mockImplementationOnce(() => new Promise((_, reject) => { rejectRequest = reject }))
    const modal = await openConfirmation()
    const input = within(modal).getByRole('spinbutton', { name: 'Количество' })
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.click(within(modal).getByRole('button', { name: 'Да, добавить' }))
    expect(input).toBeDisabled()
    expect(within(modal).getByRole('button', { name: 'Уменьшить количество' })).toBeDisabled()
    expect(within(modal).getByRole('button', { name: 'Увеличить количество' })).toBeDisabled()
    await act(async () => rejectRequest(new ApiError('Таймаут', 0, 'REQUEST_TIMEOUT')))
    expect(input).toBeDisabled()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить добавление' }))
    expect(screen.getByRole('spinbutton', { name: 'Количество' })).toHaveValue(5)
    expect(screen.getByRole('spinbutton', { name: 'Количество' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await screen.findByRole('heading', { name: 'Корзина' })
    expect(addToCart).toHaveBeenCalledTimes(2)
    expect(vi.mocked(addToCart).mock.calls[1]).toEqual(vi.mocked(addToCart).mock.calls[0])
    expect(vi.mocked(addToCart).mock.calls[0]).toEqual(['QTY-16', 5, expect.any(String)])
  })

  it('shows a server stock rejection and retains the immutable attempted quantity', async () => {
    vi.mocked(addToCart).mockRejectedValue(new ApiError('Осталось только 2 штуки.', 409, 'INSUFFICIENT_STOCK'))
    const modal = await openConfirmation()
    const input = within(modal).getByRole('spinbutton', { name: 'Количество' })
    fireEvent.change(input, { target: { value: '4' } })
    fireEvent.click(within(modal).getByRole('button', { name: 'Да, добавить' }))
    expect(await within(modal).findByRole('alert')).toHaveTextContent('Осталось только 2 штуки.')
    expect(input).toHaveValue(4)
    expect(input).toBeDisabled()
    expect(screen.queryByRole('heading', { name: 'Корзина' })).not.toBeInTheDocument()
    expect(addToCart).toHaveBeenCalledTimes(1)
  })

  it('keeps the quantity field reachable and modal focus contained for keyboard users', async () => {
    const modal = await openConfirmation()
    const input = within(modal).getByRole('spinbutton', { name: 'Количество' })
    input.focus()
    expect(input).toHaveFocus()
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(input).toHaveFocus() // jsdom does not execute native sequential focus movement.
    const close = within(modal).getByRole('button', { name: 'Закрыть подтверждение' })
    const confirm = within(modal).getByRole('button', { name: 'Да, добавить' })
    close.focus()
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(confirm).toHaveFocus()
    fireEvent.keyDown(confirm, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(modal).not.toBeInTheDocument()
    expect(addToCart).not.toHaveBeenCalled()
  })

  it('allows a fresh edited selection after a definite stock rejection, with a new confirmation ID', async () => {
    vi.mocked(addToCart).mockRejectedValueOnce(new ApiError('Недостаточный остаток.', 409, 'INSUFFICIENT_STOCK'))
    await openConfirmation()
    fireEvent.click(screen.getByRole('button', { name: 'Да, добавить' }))
    await screen.findByRole('alert')
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать' }))
    const input = screen.getByRole('spinbutton', { name: 'Количество' })
    expect(input).toBeEnabled()
    fireEvent.change(input, { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Да, добавить' }))
    await screen.findByRole('heading', { name: 'Корзина' })
    expect(addToCart).toHaveBeenLastCalledWith('QTY-16', 2, expect.any(String))
    expect(vi.mocked(addToCart).mock.calls[1][2]).not.toBe(vi.mocked(addToCart).mock.calls[0][2])
  })

  it('provides the editable quantity and confirmation action in Kazakh', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Қазақша' }))
    fireEvent.click(screen.getByRole('button', { name: 'Мысал' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Таңдау' }))
    const modal = screen.getByRole('dialog', { name: 'Тауарды себетке қосу керек пе?' })
    expect(modal).toHaveAttribute('lang', 'kk')
    const input = within(modal).getByRole('spinbutton', { name: 'Саны' })
    fireEvent.change(input, { target: { value: '3' } })
    expect(modal).toHaveTextContent(/23\s*700/)
    expect(within(modal).getByRole('button', { name: 'Иә, қосу' })).toBeEnabled()
    expect(addToCart).not.toHaveBeenCalled()
  })
})
