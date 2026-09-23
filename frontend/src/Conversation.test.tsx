import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { addToCart, ApiError, getCart, searchCatalog } from './lib/api'
import type { SearchResponse } from './types'

vi.mock('./lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./lib/api')>()
  return { ...original, getCart: vi.fn(), searchCatalog: vi.fn(), addToCart: vi.fn() }
})

const firstQuery = 'Нужен автомат C16, 8 штук'
const followUp = 'А есть 12 штук?'
const emptyCart = { items: [], totalPriceKzt: 0, cartUrl: '/cart' }
const result = (quantity: number): SearchResponse => ({
  intent: 'specifications', answer: `Найдены автоматы: ${quantity} шт.`, filters: { quantity },
  exactMatch: {
    product: { sku: 'C16', name: 'Автомат C16', stock: 20, priceKzt: 1000 }, canFulfill: true,
  },
  alternatives: [],
})

function send(message: string) {
  const input = screen.getByRole('textbox', { name: 'Сообщение помощнику EKT' })
  fireEvent.change(input, { target: { value: message } })
  fireEvent.submit(input.closest('form')!)
}

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  vi.mocked(getCart).mockResolvedValue(emptyCart)
  vi.mocked(searchCatalog).mockResolvedValue(result(8))
  vi.mocked(addToCart).mockResolvedValue(emptyCart)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
})

describe('conversation history', () => {
  it('shows a submitted follow-up immediately, retains the first answer, and guards duplicate submits', async () => {
    let finish!: (value: SearchResponse) => void
    vi.mocked(searchCatalog).mockResolvedValueOnce(result(8))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    render(<App />)
    send(firstQuery)
    await screen.findByText(result(8).answer)
    send(followUp)
    const input = screen.getByRole('textbox', { name: 'Сообщение помощнику EKT' })
    fireEvent.submit(input.closest('form')!)
    expect(searchCatalog).toHaveBeenCalledTimes(2)
    expect(searchCatalog).toHaveBeenLastCalledWith(followUp, expect.any(String))
    const log = screen.getByRole('log', { name: 'История переписки' })
    expect(within(log).getByText(firstQuery)).toBeInTheDocument()
    expect(within(log).getByText(result(8).answer)).toBeInTheDocument()
    expect(within(log).getByText(followUp)).toBeInTheDocument()
    expect(input).toHaveValue('')
    const historicalChoice = screen.getByRole('button', { name: 'Предыдущий результат' })
    expect(historicalChoice).toBeDisabled()
    fireEvent.click(historicalChoice)
    expect(screen.queryByRole('dialog', { name: 'Добавить товар в корзину?' })).not.toBeInTheDocument()
    await act(async () => finish(result(12)))
    expect(within(log).getByText(result(12).answer)).toBeInTheDocument()
    expect(within(log).getAllByRole('heading', { name: 'Автомат C16' })).toHaveLength(2)
  })

  it('keeps earlier cards inert and confirms only the latest turn quantity after an explicit click', async () => {
    vi.mocked(searchCatalog).mockResolvedValueOnce(result(8)).mockResolvedValueOnce(result(12))
    render(<App />)
    send(firstQuery)
    await screen.findByText(result(8).answer)
    send(followUp)
    await screen.findByText(result(12).answer)
    const historicalChoice = screen.getByRole('button', { name: 'Предыдущий результат' })
    expect(historicalChoice).toBeDisabled()
    expect(historicalChoice).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(historicalChoice)
    expect(screen.queryByRole('dialog', { name: 'Добавить товар в корзину?' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Выбрать/ }))
    expect(screen.getByRole('dialog', { name: 'Добавить товар в корзину?' })).toHaveTextContent('12')
    expect(addToCart).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Да, добавить' }))
    await screen.findByRole('heading', { name: 'Корзина' })
    expect(addToCart).toHaveBeenCalledWith('C16', 12, expect.any(String))
  })

  it('retains a failed turn and prior answers while invalid drafts do not create a turn', async () => {
    vi.mocked(searchCatalog).mockResolvedValueOnce(result(8))
      .mockRejectedValueOnce(new ApiError('Сбой каталога.', 500, 'CATALOG_ERROR'))
    render(<App />)
    send(firstQuery)
    await screen.findByText(result(8).answer)
    send(followUp)
    expect(await screen.findByRole('alert')).toHaveTextContent('Сбой каталога.')
    const log = screen.getByRole('log', { name: 'История переписки' })
    expect(within(log).getByText(firstQuery)).toBeInTheDocument()
    expect(within(log).getByText(result(8).answer)).toBeInTheDocument()
    expect(within(log).getByText(followUp)).toBeInTheDocument()
    expect(within(log).getByText('Сбой каталога.')).toBeInTheDocument()
    const historicalChoice = screen.getByRole('button', { name: 'Предыдущий результат' })
    expect(historicalChoice).toBeDisabled()
    fireEvent.click(historicalChoice)
    expect(screen.queryByRole('dialog', { name: 'Добавить товар в корзину?' })).not.toBeInTheDocument()
    send('   ')
    expect(within(log).queryAllByText('Вы')).toHaveLength(2)
    expect(searchCatalog).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('textbox', { name: 'Сообщение помощнику EKT' })).toHaveAttribute('aria-invalid', 'true')
  })

  it('retains history and original message language across reading mode, RU/KZ and close/reopen', async () => {
    render(<App />)
    send(firstQuery)
    await screen.findByText(result(8).answer)
    fireEvent.click(screen.getByRole('button', { name: 'Для слабовидящих' }))
    fireEvent.click(screen.getByRole('button', { name: 'Қазақша' }))
    fireEvent.click(screen.getByRole('button', { name: 'Чатты жабу' }))
    fireEvent.click(screen.getByRole('button', { name: 'EKT көмекшісімен чатты ашу' }))
    const log = screen.getByRole('log', { name: 'Хат алмасу тарихы' })
    expect(within(log).getByText(firstQuery)).toHaveAttribute('lang', 'ru')
    expect(within(log).getByText(result(8).answer)).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'EKT көмекшісі' })).toHaveClass('reading-mode')
    expect(searchCatalog).toHaveBeenCalledTimes(1)
  })

  it('restores the conversation after returning from the cart route', async () => {
    render(<App />)
    send(firstQuery)
    await screen.findByText(result(8).answer)
    fireEvent.click(screen.getByRole('button', { name: /Выбрать/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Да, добавить' }))
    await screen.findByRole('heading', { name: 'Корзина' })
    act(() => {
      window.history.replaceState({}, '', '/')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    const log = screen.getByRole('log', { name: 'История переписки' })
    expect(within(log).getByText(firstQuery)).toBeInTheDocument()
    expect(within(log).getByText(result(8).answer)).toBeInTheDocument()
    expect(searchCatalog).toHaveBeenCalledTimes(1)
  })

  it('preserves the transcript when following the cart return link without a separate latest-message control', async () => {
    vi.mocked(searchCatalog).mockResolvedValueOnce(result(8)).mockResolvedValueOnce(result(12))
    render(<App />)
    send(firstQuery)
    await screen.findByText(result(8).answer)
    send(followUp)
    await screen.findByText(result(12).answer)
    fireEvent.click(screen.getByRole('button', { name: /Выбрать/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Да, добавить' }))
    await screen.findByRole('heading', { name: 'Корзина' })
    fireEvent.click(screen.getByRole('link', { name: 'Вернуться в каталог' }))
    expect(window.location.pathname).toBe('/')
    expect(screen.getByRole('textbox', { name: 'Сообщение помощнику EKT' })).toHaveFocus()
    const log = screen.getByRole('log', { name: 'История переписки' })
    expect(within(log).getByText(firstQuery)).toBeInTheDocument()
    expect(within(log).getByText(result(8).answer)).toBeInTheDocument()
    expect(within(log).getByText(followUp)).toBeInTheDocument()
    expect(within(log).getByText(result(12).answer)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'К последнему сообщению' })).not.toBeInTheDocument()
    expect(searchCatalog).toHaveBeenCalledTimes(2)
  })

  it('keeps a user-opened chat available after returning from the cart on mobile', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    window.sessionStorage.clear()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Открыть чат с помощником EKT' }))
    send(firstQuery)
    await screen.findByText(result(8).answer)
    fireEvent.click(screen.getByRole('button', { name: /Выбрать/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Да, добавить' }))
    await screen.findByRole('heading', { name: 'Корзина' })
    fireEvent.click(screen.getByRole('link', { name: 'Вернуться в каталог' }))
    const log = screen.getByRole('log', { name: 'История переписки' })
    expect(within(log).getByText(firstQuery)).toBeInTheDocument()
    expect(searchCatalog).toHaveBeenCalledTimes(1)
  })
})
