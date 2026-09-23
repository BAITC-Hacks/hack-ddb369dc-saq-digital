import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { translations } from './i18n'
import { addToCart, ApiError, getCart, searchCatalog } from './lib/api'

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

function submitSampleQuery(language: 'ru' | 'kk' = 'ru') {
  const t = translations[language]
  fireEvent.change(screen.getByRole('textbox', { name: t.messageLabel }), { target: { value: t.demoQuery } })
  fireEvent.click(screen.getByRole('button', { name: t.send }))
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
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  window.history.replaceState({}, '', '/')
})

describe('EKT assistant integration', () => {
  it.each(['ru', 'kk'] as const)('has no Demo shortcut and sends messages with the regular composer in %s', async (language) => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: language === 'ru' ? 'Русский' : 'Қазақша' }))
    expect(screen.queryByRole('button', { name: 'Demo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Мысал' })).not.toBeInTheDocument()
    const t = translations[language]
    fireEvent.change(screen.getByRole('textbox', { name: t.messageLabel }), { target: { value: t.demoQuery } })
    fireEvent.click(screen.getByRole('button', { name: t.send }))
    expect(await screen.findByText(searchResult.answer)).toBeInTheDocument()
    expect(searchCatalog).toHaveBeenCalledOnce()
    expect(addToCart).not.toHaveBeenCalled()
  })

  it.each([null, 'false', 'invalid'])('starts with reading mode disabled for stored value %s', (storedValue) => {
    if (storedValue !== null) window.localStorage.setItem('ekt-reading-mode', storedValue)
    render(<App />)
    expect(screen.getByRole('button', { name: 'Для слабовидящих' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('dialog', { name: 'Помощник EKT' })).not.toHaveClass('reading-mode')
  })

  it('preserves the draft, results, language choice and reading preference without issuing requests', async () => {
    render(<App />)
    submitSampleQuery()
    await screen.findByText(searchResult.answer)
    fireEvent.change(screen.getByRole('textbox', { name: 'Сообщение помощнику EKT' }), { target: { value: 'Мой следующий вопрос' } })
    const requestCount = vi.mocked(getCart).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Для слабовидящих' }))
    expect(screen.getByRole('button', { name: 'Для слабовидящих' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('dialog', { name: 'Помощник EKT' })).toHaveClass('reading-mode')
    expect(document.querySelector('main.store')).not.toHaveClass('reading-mode')
    expect(window.localStorage.getItem('ekt-reading-mode')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Қазақша' }))
    expect(screen.getByRole('button', { name: 'Нашар көретіндерге' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('textbox', { name: 'EKT көмекшісіне хабарлама' })).toHaveValue('Мой следующий вопрос')
    expect(screen.getByText(searchResult.answer)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Чатты жабу' }))
    const launcher = screen.getByRole('button', { name: 'EKT көмекшісімен чатты ашу' })
    expect(launcher).toHaveClass('reading-mode')
    fireEvent.click(launcher)
    expect(screen.getByRole('dialog', { name: 'EKT көмекшісі' })).toHaveClass('reading-mode')
    expect(screen.getByRole('textbox', { name: 'EKT көмекшісіне хабарлама' })).toHaveValue('Мой следующий вопрос')
    expect(searchCatalog).toHaveBeenCalledTimes(1)
    expect(getCart).toHaveBeenCalledTimes(requestCount)
    expect(addToCart).not.toHaveBeenCalled()

    cleanup()
    render(<App />)
    expect(screen.getByRole('button', { name: 'Нашар көретіндерге' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('dialog', { name: 'EKT көмекшісі' })).toHaveClass('reading-mode')
    fireEvent.click(screen.getByRole('button', { name: 'Нашар көретіндерге' }))
    expect(window.localStorage.getItem('ekt-reading-mode')).toBe('false')
    expect(screen.getByRole('dialog', { name: 'EKT көмекшісі' })).not.toHaveClass('reading-mode')
  })

  it('keeps reading mode usable when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked') })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Открыть чат с помощником EKT' }))
    const toggle = screen.getByRole('button', { name: 'Для слабовидящих' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('dialog', { name: 'Помощник EKT' })).toHaveClass('reading-mode')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('carries reading mode through explicit cart confirmation and lets users disable it on the cart screen', async () => {
    window.localStorage.setItem('ekt-reading-mode', 'true')
    render(<App />)
    submitSampleQuery()
    fireEvent.click(await screen.findByRole('button', { name: /Выбрать/ }))
    expect(screen.getByRole('dialog', { name: 'Добавить товар в корзину?' })).toHaveClass('reading-mode')
    expect(addToCart).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Да, добавить' }))
    const heading = await screen.findByRole('heading', { name: 'Корзина' })
    expect(heading.closest('section')).toHaveClass('reading-mode')
    expect(heading).toHaveFocus()
    expect(addToCart).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Для слабовидящих' }))
    expect(heading.closest('section')).not.toHaveClass('reading-mode')
    expect(window.localStorage.getItem('ekt-reading-mode')).toBe('false')
    expect(addToCart).toHaveBeenCalledTimes(1)
  })

  it('associates validation errors with the input and translates them when language changes', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    const input = screen.getByRole('textbox', { name: 'Сообщение помощнику EKT' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(expect.stringContaining('Введите вопрос'))
    fireEvent.click(screen.getByRole('button', { name: 'Қазақша' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Сайт туралы сұрақты')
    fireEvent.change(input, { target: { value: 'Артикул' } })
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('accepts short conversational replies with Enter and reserves Shift+Enter for a newline', async () => {
    vi.mocked(searchCatalog).mockResolvedValue({ intent: 'conversation', answer: 'Уточните, какой товар нужен.', quantity: 0, filters: null, exactMatch: null, alternatives: [], notice: 'AI_OFFLINE' })
    render(<App />)
    const input = screen.getByRole('textbox', { name: 'Сообщение помощнику EKT' })
    expect(input).toHaveAttribute('maxlength', '4000')
    fireEvent.change(input, { target: { value: 'да' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(searchCatalog).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByText('Уточните, какой товар нужен.')
    expect(searchCatalog).toHaveBeenCalledWith('да', expect.any(String))
    expect(screen.queryByText('Уточните артикул или характеристики товара.')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() => expect(window.localStorage.getItem('ekt-assistant-chat-history')).toContain('AI_OFFLINE'))
  })

  it('uses the top-level requested quantity ahead of legacy filters', async () => {
    vi.mocked(searchCatalog).mockResolvedValue({ ...searchResult, quantity: 3 })
    render(<App />)
    submitSampleQuery()
    fireEvent.click(await screen.findByRole('button', { name: /Выбрать/ }))
    expect(screen.getByRole('spinbutton', { name: 'Количество' })).toHaveValue(3)
  })

  it('rejects oversized restored or programmatic drafts without sending a request', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Сообщение помощнику EKT' }), { target: { value: 'я'.repeat(4001) } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    expect(screen.getByRole('alert')).toHaveTextContent('не более 4000')
    expect(searchCatalog).not.toHaveBeenCalled()
  })

  it('localizes API errors and marks untranslated server details with their language', async () => {
    vi.mocked(searchCatalog).mockRejectedValue(new ApiError('Товар недоступен.', 409, 'OUT_OF_STOCK'))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Қазақша' }))
    submitSampleQuery('kk')
    expect(await screen.findByRole('alert')).toHaveTextContent('Сұрауды орындау мүмкін болмады')
    expect(screen.getByText('Товар недоступен.')).toHaveAttribute('lang', 'ru')
  })

  it('lets users dismiss a pending cart request and retry it with the same confirmation', async () => {
    let rejectCart!: (error: Error) => void
    vi.mocked(addToCart).mockImplementationOnce(() => new Promise((_, reject) => { rejectCart = reject }))
    render(<App />)
    submitSampleQuery()
    const choose = await screen.findByRole('button', { name: /Выбрать/ })
    fireEvent.click(choose)
    fireEvent.click(screen.getByRole('button', { name: 'Да, добавить' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Добавить товар в корзину?' })).not.toBeInTheDocument()
    expect(choose).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Проверить добавление' })).toBeInTheDocument()
    fireEvent.click(choose)
    expect(addToCart).toHaveBeenCalledTimes(1)
    await act(async () => rejectCart(new ApiError('Таймаут', 0, 'REQUEST_TIMEOUT')))
    fireEvent.click(screen.getByRole('button', { name: 'Проверить добавление' }))
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    const heading = await screen.findByRole('heading', { name: 'Корзина' })
    await waitFor(() => {
      expect(heading).toHaveFocus()
      expect(document.title).toBe('Корзина — EKT')
    })
    expect(vi.mocked(addToCart).mock.calls[1][2]).toBe(vi.mocked(addToCart).mock.calls[0][2])
  })

  it('opens the returned cart and focuses its heading when a dismissed request succeeds', async () => {
    let resolveCart!: (cart: typeof filledCart) => void
    vi.mocked(addToCart).mockImplementationOnce(() => new Promise((resolve) => { resolveCart = resolve }))
    render(<App />)
    submitSampleQuery()
    fireEvent.click(await screen.findByRole('button', { name: /Выбрать/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Да, добавить' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Добавить товар в корзину?' })).not.toBeInTheDocument()
    await act(async () => resolveCart({ ...filledCart, cartUrl: '/confirmed-cart' }))
    expect(screen.getByRole('heading', { name: 'Корзина' })).toHaveFocus()
    expect(window.location.pathname).toBe('/confirmed-cart')
    expect(addToCart).toHaveBeenCalledTimes(1)
  })

  it('keeps submitted message language after switching the interface language', async () => {
    render(<App />)
    submitSampleQuery()
    await screen.findByText('Параметры совпадают.')
    fireEvent.click(screen.getByRole('button', { name: 'Қазақша' }))
    expect(screen.getByText(/Нужен автомат/, { selector: '.message.customer p' })).toHaveAttribute('lang', 'ru')
    expect(screen.getByText(searchResult.answer)).toHaveAttribute('lang', 'ru')
  })

  it('offers editable starter questions only after choosing a language', () => {
    render(<App />)
    expect(screen.queryByRole('button', { name: 'Подобрать автомат' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Русский' }))
    fireEvent.click(screen.getByRole('button', { name: 'Подобрать автомат' }))
    expect((screen.getByRole('textbox', { name: 'Сообщение помощнику EKT' }) as HTMLTextAreaElement).value).toContain('3P C16')
    expect(screen.getByRole('textbox', { name: 'Сообщение помощнику EKT' })).toHaveFocus()
    expect(searchCatalog).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    expect(searchCatalog).toHaveBeenCalledWith(expect.stringContaining('8 штук'), expect.any(String))
  })

  it('fills a Kazakh purchase-terms suggestion without submitting it', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Қазақша' }))
    fireEvent.click(screen.getByRole('button', { name: 'Төлем шарттары' }))
    expect(screen.getByRole('textbox', { name: 'EKT көмекшісіне хабарлама' })).toHaveValue('Төлем шарттары қандай?')
    expect(searchCatalog).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Жіберу' }))
    expect(searchCatalog).toHaveBeenCalledWith('оплата шарттары қандай?', expect.any(String))
  })

  it('offers language choices in the first assistant message and persists the chat choice', () => {
    render(<App />)
    expect(screen.getByText(/Выберите язык для общения/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Русский' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Қазақша' }))

    expect(window.localStorage.getItem('ekt-ui-language')).toBe('kk')
    expect(screen.getByRole('button', { name: 'Каталог' })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'EKT көмекшісі' })).toHaveAttribute('lang', 'kk')
    expect(screen.getByRole('textbox', { name: 'EKT көмекшісіне хабарлама' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Қазақша' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Чатты жабу' }))
    fireEvent.click(screen.getByRole('button', { name: 'EKT көмекшісімен чатты ашу' }))
    expect(screen.getByRole('textbox', { name: 'EKT көмекшісіне хабарлама' })).toHaveFocus()

    cleanup()
    render(<App />)
    expect(screen.getByRole('dialog', { name: 'EKT көмекшісі' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Русский' }))
    expect(window.localStorage.getItem('ekt-ui-language')).toBe('ru')
    expect(screen.getByRole('dialog', { name: 'Помощник EKT' })).toBeInTheDocument()
  })

  it('keeps explicit cart confirmation working in Kazakh', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Қазақша' }))
    submitSampleQuery('kk')
    fireEvent.click(await screen.findByRole('button', { name: /Таңдау/ }))
    expect(searchCatalog).toHaveBeenCalledWith(expect.stringContaining('8 шт.'), expect.any(String))
    expect(screen.getByText(/8 дана керек/, { selector: '.message.customer p' })).toBeInTheDocument()
    expect(addToCart).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Иә, қосу' }))
    expect(await screen.findByRole('heading', { name: 'Себет' })).toBeInTheDocument()
    expect(addToCart).toHaveBeenCalledTimes(1)
  })

  it('keeps the launcher and chat operable with Escape and restores focus', () => {
    render(<App />)
    const chat = screen.getByRole('dialog', { name: 'Помощник EKT' })
    expect(chat).toBeInTheDocument()
    act(() => screen.getByRole('button', { name: 'Каталог' }).focus())
    expect(chat).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Каталог' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть чат с помощником EKT' }))
    screen.getByRole('textbox', { name: 'Сообщение помощнику EKT' }).focus()
    fireEvent.keyDown(window, { key: 'Escape' })
    const launcher = screen.getByRole('button', { name: 'Открыть чат с помощником EKT' })
    expect(launcher).toHaveFocus()
    expect(screen.queryByRole('dialog', { name: 'Помощник EKT' })).not.toBeInTheDocument()
    fireEvent.click(launcher)
    expect(screen.getByRole('dialog', { name: 'Помощник EKT' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Русский' })).toHaveFocus()
  })

  it('starts collapsed on a fresh desktop visit without removing the launcher', () => {
    window.sessionStorage.clear()
    render(<App />)
    expect(screen.queryByRole('dialog', { name: 'Помощник EKT' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть чат с помощником EKT' }))
    expect(screen.getByRole('dialog', { name: 'Помощник EKT' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Русский' })).toHaveFocus()
  })

  it('does not show a cart loading error as an unsolicited chat message', async () => {
    vi.mocked(getCart).mockRejectedValue(new Error('cart unavailable'))
    render(<App />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('dialog', { name: 'Помощник EKT' })).not.toHaveTextContent('cart unavailable')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('still shows a cart loading error on the cart screen', async () => {
    window.history.replaceState({}, '', '/cart')
    vi.mocked(getCart).mockRejectedValue(new Error('cart unavailable'))
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось выполнить запрос')
  })

  it('keeps confirmation keyboard focus inside the modal and allows Escape before submitting', async () => {
    render(<App />)
    submitSampleQuery()
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

    submitSampleQuery()
    expect(await screen.findByText('Параметры совпадают.')).toBeInTheDocument()
    expect(searchCatalog).toHaveBeenCalledWith(expect.stringContaining('3P C16'), expect.any(String))
    expect(screen.getByRole('button', { name: /Недоступно/ })).toBeDisabled()
    expect(addToCart).not.toHaveBeenCalled()
  })

  it('adds only after confirmation and uses the API cartUrl', async () => {
    vi.mocked(addToCart).mockResolvedValue({ ...filledCart, cartUrl: '/checkout-cart' })
    render(<App />)
    submitSampleQuery()
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
    submitSampleQuery()
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
    submitSampleQuery()
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
    submitSampleQuery()
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
