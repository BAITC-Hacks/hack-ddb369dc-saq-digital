import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { addToCart, getCart, searchCatalog } from './lib/api'

vi.mock('./lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./lib/api')>()
  return { ...original, getCart: vi.fn(), searchCatalog: vi.fn(), addToCart: vi.fn() }
})

const emptyCart = { items: [], totalPriceKzt: 0, cartUrl: '/cart' }
const filledCart = {
  items: [{ sku: 'ALT-15', name: 'Автомат 3P C16 15 kA', quantity: 8, unitPriceKzt: 7900, lineTotalKzt: 63200 }],
  totalPriceKzt: 63200,
  cartUrl: '/cart',
}
const product = (sku: string, stock: number) => ({
  sku, name: 'Автомат 3P C16 15 kA', poles: 3, curve: 'C' as const,
  amps: 16, breakingCapacityKa: 15, stock, priceKzt: 7900,
})
const searchResult = {
  intent: 'specifications' as const,
  answer: 'Точного товара в нужном количестве нет. Найдены варианты.',
  filters: { quantity: 8 },
  exactMatch: { product: product('EXACT', 0), canFulfill: false },
  alternatives: [{ product: product('ALT-15', 12), reason: 'Параметры совпадают.' }],
}

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  vi.mocked(getCart).mockResolvedValue(emptyCart)
  vi.mocked(searchCatalog).mockResolvedValue(searchResult)
  vi.mocked(addToCart).mockResolvedValue(filledCart)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  window.history.replaceState({}, '', '/')
})

describe('EKT assistant integration', () => {
  it('keeps the launcher and chat operable with Escape and restores focus', () => {
    render(<App />)
    const chat = screen.getByRole('dialog', { name: 'Помощник EKT' })
    expect(chat).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    const launcher = screen.getByRole('button', { name: 'Открыть чат с помощником EKT' })
    expect(launcher).toHaveFocus()
    expect(chat).not.toBeInTheDocument()
    fireEvent.click(launcher)
    expect(screen.getByRole('dialog', { name: 'Помощник EKT' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Сообщение помощнику EKT' })).toHaveFocus()
  })

  it('keeps confirmation keyboard focus inside the modal and allows Escape before submitting', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Demo' }))
    const choose = await screen.findByRole('button', { name: /Выбрать/ })
    fireEvent.click(choose)
    const modal = screen.getByRole('dialog', { name: 'Добавить товар в корзину?' })
    expect(modal).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: 'Да, добавить' })).toHaveFocus()
    fireEvent.keyDown(modal, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Закрыть подтверждение' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(modal).not.toBeInTheDocument()
    expect(choose).toHaveFocus()
    expect(addToCart).not.toHaveBeenCalled()
  })

  it('loads the session cart and searches without modifying it', async () => {
    render(<App />)
    expect(await screen.findByRole('link', { name: /Корзина 0/ })).toHaveAttribute('href', '/cart')

    fireEvent.click(screen.getByRole('button', { name: 'Demo' }))
    expect(await screen.findByText('Параметры совпадают.')).toBeInTheDocument()
    expect(searchCatalog).toHaveBeenCalledWith(expect.stringContaining('3P C16'))
    expect(screen.getByRole('button', { name: /Недоступно/ })).toBeDisabled()
    expect(addToCart).not.toHaveBeenCalled()
  })

  it('adds only after confirmation and uses the API cartUrl', async () => {
    vi.mocked(addToCart).mockResolvedValue({ ...filledCart, cartUrl: '/checkout-cart' })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Demo' }))
    fireEvent.click(await screen.findByRole('button', { name: /Выбрать/ }))
    expect(addToCart).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Да, добавить' }))
    expect(await screen.findByRole('heading', { name: 'Корзина' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/checkout-cart')
    expect(screen.getByRole('link', { name: /Корзина 1/ })).toHaveAttribute('href', '/checkout-cart')
    expect(addToCart).toHaveBeenCalledWith('ALT-15', 8, expect.any(String))
  })

  it('reuses the confirmation ID if a cart request must be retried', async () => {
    vi.mocked(addToCart).mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce(filledCart)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Demo' }))
    fireEvent.click(await screen.findByRole('button', { name: /Выбрать/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Да, добавить' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Повторить' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByRole('heading', { name: 'Корзина' })).toBeInTheDocument()
    expect(vi.mocked(addToCart).mock.calls[1][2]).toBe(vi.mocked(addToCart).mock.calls[0][2])
  })

  it('allows leaving a failed confirmation without another cart request', async () => {
    vi.mocked(addToCart).mockRejectedValue(new Error('connection lost'))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Demo' }))
    const choose = await screen.findByRole('button', { name: /Выбрать/ })
    fireEvent.click(choose)
    fireEvent.click(screen.getByRole('button', { name: 'Да, добавить' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Повторить' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Добавить товар в корзину?' })).not.toBeInTheDocument()
    expect(choose).toHaveFocus()
    expect(addToCart).toHaveBeenCalledTimes(1)
  })

  it('renders the server cart at the route returned by cartUrl', async () => {
    window.history.replaceState({}, '', '/cart')
    vi.mocked(getCart).mockResolvedValue(filledCart)
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Корзина' })).toBeInTheDocument()
    expect(screen.getByText('ALT-15')).toBeInTheDocument()
    expect(screen.getAllByText(/63\s?200/)).toHaveLength(2)
  })

  it('does not overwrite a confirmed cart with an older GET response', async () => {
    let finishInitialCart!: (cart: typeof emptyCart) => void
    vi.mocked(getCart).mockReturnValue(new Promise((resolve) => { finishInitialCart = resolve }))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Demo' }))
    fireEvent.click(await screen.findByRole('button', { name: /Выбрать/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Да, добавить' }))
    expect(await screen.findByText('ALT-15')).toBeInTheDocument()

    await act(async () => { finishInitialCart(emptyCart) })
    expect(screen.getByText('ALT-15')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Корзина 1/ })).toBeInTheDocument()
  })

  it('shows purchase terms from the API and its source', async () => {
    vi.mocked(searchCatalog).mockResolvedValue({
      intent: 'purchase_terms', answer: 'Условия оплаты опубликованы на сайте.',
      sourceUrl: 'https://ekt.kz/about/information/', filters: null, exactMatch: null, alternatives: [],
    })
    render(<App />)
    fireEvent.change(screen.getByLabelText('Сообщение помощнику EKT'), { target: { value: 'Как оплатить заказ?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    expect(await screen.findByText('Условия оплаты опубликованы на сайте.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Источник условий' })).toHaveAttribute('href', 'https://ekt.kz/about/information/')
  })
})
