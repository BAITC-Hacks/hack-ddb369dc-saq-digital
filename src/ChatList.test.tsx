import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { addToCart, ApiError, getCart, searchCatalog } from './lib/api'
import type { SearchResponse } from './types'
import { HISTORY_KEY } from './lib/chatHistory'

vi.mock('./lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./lib/api')>()
  return { ...original, getCart: vi.fn(), searchCatalog: vi.fn(), addToCart: vi.fn() }
})

const firstQuestion = 'Нужен автомат C16, 8 штук'
const secondQuestion = 'Какие условия доставки?'
const emptyCart = { items: [], totalPriceKzt: 0, cartUrl: '/cart' }
const result: SearchResponse = {
  intent: 'specifications', answer: 'Автомат C16 есть в наличии.', filters: { quantity: 8 },
  exactMatch: { product: { sku: 'C16', name: 'Автомат C16', stock: 20, priceKzt: 1000 }, canFulfill: true },
  alternatives: [],
}
const otherResult: SearchResponse = {
  intent: 'specifications', answer: 'Автомат C20 есть в наличии.', filters: { quantity: 2 },
  exactMatch: { product: { sku: 'C20', name: 'Автомат C20', stock: 10, priceKzt: 1500 }, canFulfill: true },
  alternatives: [],
}

const input = () => screen.getByRole('textbox', { name: 'Сообщение помощнику EKT' })
const historyButton = () => screen.getByRole('button', { name: 'История чатов' })
const newChatButton = () => screen.getByRole('button', { name: 'Новый чат' })
function send(question: string) {
  fireEvent.change(input(), { target: { value: question } })
  fireEvent.submit(input().closest('form')!)
}
function selectChat(title: string) {
  fireEvent.click(historyButton())
  fireEvent.click(within(screen.getByRole('list', { name: 'Диалоги' })).getByRole('button', { name: title }))
}

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  vi.mocked(getCart).mockResolvedValue(emptyCart)
  vi.mocked(searchCatalog).mockResolvedValue(result)
  vi.mocked(addToCart).mockResolvedValue(emptyCart)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
})

describe('separate chat list', () => {
  it('opens a blank chat without a request and restores each transcript and draft when switching', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Русский' }))
    send(firstQuestion)
    await screen.findByText(result.answer)
    fireEvent.change(input(), { target: { value: 'А есть 12 штук?' } })
    const cartReads = vi.mocked(getCart).mock.calls.length
    fireEvent.click(newChatButton())
    expect(input()).toHaveFocus()
    expect(input()).toHaveValue('')
    expect(screen.queryByText(firstQuestion)).not.toBeInTheDocument()
    expect(searchCatalog).toHaveBeenCalledTimes(1)
    expect(getCart).toHaveBeenCalledTimes(cartReads)
    fireEvent.change(input(), { target: { value: 'Черновик второго диалога' } })
    selectChat(firstQuestion)
    expect(input()).toHaveFocus()
    expect(input()).toHaveValue('А есть 12 штук?')
    expect(screen.getByText(firstQuestion)).toBeInTheDocument()
    expect(screen.getByText(result.answer)).toBeInTheDocument()
    selectChat('Черновик второго диалога')
    expect(input()).toHaveValue('Черновик второго диалога')
    expect(screen.queryByText(firstQuestion)).not.toBeInTheDocument()
    expect(searchCatalog).toHaveBeenCalledTimes(1)
    expect(addToCart).not.toHaveBeenCalled()
  })

  it('uses distinct conversation IDs for separate chats and restores the original ID on return', async () => {
    render(<App />)
    send(firstQuestion)
    await screen.findByText(result.answer)
    fireEvent.click(newChatButton())
    send(secondQuestion)
    await screen.findByText(result.answer)
    selectChat(firstQuestion)
    send('А есть 12 штук?')
    await screen.findAllByText(result.answer)
    const calls = vi.mocked(searchCatalog).mock.calls
    expect(calls).toHaveLength(3)
    expect(calls[0][1]).toEqual(expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i))
    expect(calls[1][1]).not.toBe(calls[0][1])
    expect(calls[2][1]).toBe(calls[0][1])
    expect(screen.queryByText(secondQuestion)).not.toBeInTheDocument()
    expect(addToCart).not.toHaveBeenCalled()
  })

  it('labels the active chat and restores keyboard focus when leaving history', async () => {
    render(<App />)
    send(firstQuestion)
    await screen.findByText(result.answer)
    fireEvent.click(historyButton())
    expect(screen.getByRole('heading', { name: 'История чатов' })).toHaveFocus()
    const list = screen.getByRole('list', { name: 'Диалоги' })
    expect(within(list).getByRole('button', { name: firstQuestion })).toHaveAttribute('aria-current', 'true')
    expect(screen.queryByRole('textbox', { name: 'Сообщение помощнику EKT' })).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(historyButton()).toHaveFocus()
    expect(input()).toBeInTheDocument()
    fireEvent.click(historyButton())
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться к чату' }))
    expect(historyButton()).toHaveFocus()
    expect(screen.queryByRole('heading', { name: 'История чатов' })).not.toBeInTheDocument()
  })

  it('reuses an empty new chat and focuses language selection before the user chooses a language', () => {
    render(<App />)
    fireEvent.click(newChatButton())
    expect(screen.getByRole('button', { name: 'Русский' })).toHaveFocus()
    fireEvent.click(newChatButton())
    fireEvent.click(historyButton())
    const list = screen.getByRole('list', { name: 'Диалоги' })
    expect(within(list).getAllByRole('button', { name: 'Новый диалог' })).toHaveLength(1)
    expect(searchCatalog).not.toHaveBeenCalled()
  })

  it('distinguishes draft-only chats by their trimmed draft titles', () => {
    render(<App />)
    fireEvent.change(input(), { target: { value: '  Автоматы для дома  ' } })
    fireEvent.click(newChatButton())
    fireEvent.change(input(), { target: { value: 'Доставка в Астану' } })
    fireEvent.click(historyButton())
    const list = screen.getByRole('list', { name: 'Диалоги' })
    expect(within(list).getByRole('button', { name: 'Автоматы для дома' })).toBeInTheDocument()
    expect(within(list).getByRole('button', { name: 'Доставка в Астану' })).toHaveAttribute('aria-current', 'true')
    fireEvent.click(within(list).getByRole('button', { name: 'Автоматы для дома' }))
    expect(input()).toHaveValue('  Автоматы для дома  ')
    expect(searchCatalog).not.toHaveBeenCalled()
  })

  it('restores selected chat, draft, and read-only product history after a fresh mount without replaying requests', async () => {
    render(<App />)
    send(firstQuestion)
    await screen.findByText(result.answer)
    fireEvent.change(input(), { target: { value: 'Черновик первого' } })
    fireEvent.click(newChatButton())
    fireEvent.change(input(), { target: { value: 'Черновик второго' } })
    selectChat(firstQuestion)
    cleanup()
    render(<App />)
    expect(input()).toHaveValue('Черновик первого')
    expect(screen.getByText(result.answer)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Предыдущий результат/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Выбрать/ })).not.toBeInTheDocument()
    fireEvent.click(historyButton())
    const list = screen.getByRole('list', { name: 'Диалоги' })
    expect(within(list).getByRole('button', { name: firstQuestion })).toHaveAttribute('aria-current', 'true')
    expect(within(list).getByRole('button', { name: 'Черновик второго' })).toBeInTheDocument()
    expect(searchCatalog).toHaveBeenCalledTimes(1)
    expect(addToCart).not.toHaveBeenCalled()
    fireEvent.click(within(list).getByRole('button', { name: firstQuestion }))
    send(firstQuestion)
    await screen.findByRole('button', { name: /Выбрать/ })
    expect(screen.getByRole('button', { name: /Предыдущий результат/ })).toBeDisabled()
    expect(searchCatalog).toHaveBeenCalledTimes(2)
    expect(addToCart).not.toHaveBeenCalled()
  })

  it('confirms deleting the selected chat, supports Escape cancellation, and preserves other chats after reload', async () => {
    render(<App />)
    send(firstQuestion)
    await screen.findByText(result.answer)
    fireEvent.click(newChatButton())
    fireEvent.change(input(), { target: { value: 'Оставить этот черновик' } })
    selectChat(firstQuestion)
    fireEvent.click(historyButton())
    fireEvent.click(screen.getByRole('button', { name: `Удалить чат: ${firstQuestion}` }))
    expect(screen.getByRole('button', { name: 'Отмена' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Удалить чат: ${firstQuestion}` })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: `Удалить чат: ${firstQuestion}` }))
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(screen.getByRole('heading', { name: 'История чатов' })).toHaveFocus()
    expect(screen.queryByRole('button', { name: firstQuestion })).not.toBeInTheDocument()
    cleanup()
    render(<App />)
    expect(input()).toHaveValue('Оставить этот черновик')
    expect(addToCart).not.toHaveBeenCalled()
  })

  it('clears only chat history after confirmation and leaves preferences and cart untouched', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Русский' }))
    send(firstQuestion)
    await screen.findByText(result.answer)
    fireEvent.click(historyButton())
    fireEvent.click(screen.getByRole('button', { name: 'Очистить историю' }))
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(screen.getByRole('button', { name: firstQuestion })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Очистить историю' }))
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(within(screen.getByRole('list', { name: 'Диалоги' })).getAllByRole('listitem')).toHaveLength(1)
    cleanup()
    render(<App />)
    expect(input()).toHaveValue('')
    expect(screen.queryByText(result.answer)).not.toBeInTheDocument()
    expect(window.localStorage.getItem('ekt-ui-language')).toBe('ru')
    expect(searchCatalog).toHaveBeenCalledTimes(1)
    expect(addToCart).not.toHaveBeenCalled()
  })

  it('keeps chatting when saving is blocked and shows a visible warning', () => {
    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError') })
    render(<App />)
    fireEvent.change(input(), { target: { value: 'Несохранённый черновик' } })
    expect(input()).toHaveValue('Несохранённый черновик')
    expect(screen.getByRole('status')).toHaveTextContent('Не удалось сохранить историю')
    blocked.mockRestore()
  })

  it('does not resurrect history cleared in another tab when an old tab edits its draft', () => {
    render(<App />)
    fireEvent.change(input(), { target: { value: 'Старый черновик' } })
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: HISTORY_KEY, newValue: null })))
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    fireEvent.change(input(), { target: { value: 'Изменение в старой вкладке' } })
    expect(writes).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('обновилась в другой вкладке')
    expect(screen.getByRole('button', { name: 'Обновить историю' })).toHaveAccessibleDescription('Обновление удалит текущий несохранённый черновик.')
    writes.mockRestore()
  })

  it('does not claim a deletion succeeded when storage refuses the write', async () => {
    render(<App />)
    send(firstQuestion)
    await screen.findByText(result.answer)
    fireEvent.click(historyButton())
    fireEvent.click(screen.getByRole('button', { name: 'Очистить историю' }))
    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(screen.getByRole('button', { name: firstQuestion })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('удаление не подтверждено')
    blocked.mockRestore()
  })

  it('prevents switching while a search is pending and re-enables it after a failed request', async () => {
    let rejectSearch!: (error: Error) => void
    vi.mocked(searchCatalog).mockImplementationOnce(() => new Promise((_, reject) => { rejectSearch = reject }))
    render(<App />)
    send(firstQuestion)
    expect(historyButton()).toBeDisabled()
    expect(newChatButton()).toBeDisabled()
    fireEvent.click(newChatButton())
    expect(screen.getByText(firstQuestion)).toBeInTheDocument()
    expect(searchCatalog).toHaveBeenCalledTimes(1)
    await act(async () => rejectSearch(new ApiError('Каталог недоступен.', 500, 'CATALOG_ERROR')))
    expect(historyButton()).toBeEnabled()
    expect(newChatButton()).toBeEnabled()
    fireEvent.click(newChatButton())
    selectChat(firstQuestion)
    expect(screen.getByRole('alert')).toHaveTextContent('Каталог недоступен.')
    expect(searchCatalog).toHaveBeenCalledTimes(1)
  })

  it('prevents switching during cart submission and retains the failed confirmation for review across chats', async () => {
    let rejectCart!: (error: Error) => void
    vi.mocked(addToCart).mockImplementationOnce(() => new Promise((_, reject) => { rejectCart = reject }))
    render(<App />)
    send(firstQuestion)
    await screen.findByText(result.answer)
    fireEvent.click(screen.getByRole('button', { name: /Выбрать/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Да, добавить' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(historyButton()).toBeDisabled()
    expect(newChatButton()).toBeDisabled()
    await act(async () => rejectCart(new ApiError('Таймаут.', 0, 'REQUEST_TIMEOUT')))
    expect(historyButton()).toBeEnabled()
    expect(newChatButton()).toBeEnabled()
    fireEvent.click(newChatButton())
    fireEvent.click(screen.getByRole('button', { name: 'Проверить добавление' }))
    const confirmation = screen.getByRole('dialog', { name: 'Добавить товар в корзину?' })
    expect(confirmation).toHaveTextContent('Автомат C16')
    expect(confirmation).toHaveTextContent('8')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await screen.findByRole('heading', { name: 'Корзина' })
    expect(addToCart).toHaveBeenCalledTimes(2)
    expect(vi.mocked(addToCart).mock.calls[1]).toEqual(vi.mocked(addToCart).mock.calls[0])
  })

  it.each([
    new ApiError('Таймаут.', 0, 'REQUEST_TIMEOUT'),
    new ApiError('Соединение потеряно.', 0, 'NETWORK_ERROR'),
    new ApiError('Сервер недоступен.', 503, 'SERVER_ERROR'),
    new Error('Unexpected response'),
  ])('preserves an ambiguous cart request instead of replacing it with another product: %s', async (error) => {
    vi.mocked(addToCart).mockRejectedValueOnce(error)
    vi.mocked(searchCatalog).mockResolvedValueOnce(result).mockResolvedValueOnce(otherResult)
    render(<App />)
    send(firstQuestion)
    await screen.findByText(result.answer)
    fireEvent.click(screen.getByRole('button', { name: /Выбрать/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Да, добавить' }))
    await screen.findByRole('button', { name: 'Повторить' })
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(newChatButton())
    send('Нужен автомат C20, 2 штуки')
    await screen.findByText(otherResult.answer)
    const freshChoice = screen.getByRole('button', { name: /Выбрать/ })
    expect(freshChoice).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(freshChoice)
    expect(screen.queryByRole('dialog', { name: 'Добавить товар в корзину?' })).not.toBeInTheDocument()
    expect(addToCart).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Проверить добавление' }))
    const confirmation = screen.getByRole('dialog', { name: 'Добавить товар в корзину?' })
    expect(confirmation).toHaveTextContent('Автомат C16')
    expect(confirmation).toHaveTextContent('8')
    expect(confirmation).not.toHaveTextContent('Автомат C20')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await screen.findByRole('heading', { name: 'Корзина' })
    expect(addToCart).toHaveBeenCalledTimes(2)
    expect(vi.mocked(addToCart).mock.calls[1]).toEqual(vi.mocked(addToCart).mock.calls[0])
  })

  it('allows choosing another product after a definitive rejected cart request', async () => {
    vi.mocked(addToCart).mockRejectedValueOnce(new ApiError('Недостаточный остаток.', 409, 'INSUFFICIENT_STOCK'))
    vi.mocked(searchCatalog).mockResolvedValueOnce(result).mockResolvedValueOnce(otherResult)
    render(<App />)
    send(firstQuestion)
    await screen.findByText(result.answer)
    fireEvent.click(screen.getByRole('button', { name: /Выбрать/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Да, добавить' }))
    await screen.findByRole('button', { name: 'Повторить' })
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(newChatButton())
    send('Нужен автомат C20, 2 штуки')
    await screen.findByText(otherResult.answer)
    const freshChoice = screen.getByRole('button', { name: /Выбрать/ })
    expect(freshChoice).not.toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(freshChoice)
    expect(screen.getByRole('dialog', { name: 'Добавить товар в корзину?' })).toHaveTextContent('Автомат C20')
    expect(addToCart).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Да, добавить' }))
    await screen.findByRole('heading', { name: 'Корзина' })
    expect(addToCart).toHaveBeenLastCalledWith('C20', 2, expect.any(String))
    expect(vi.mocked(addToCart).mock.calls[1][2]).not.toBe(vi.mocked(addToCart).mock.calls[0][2])
  })
})
