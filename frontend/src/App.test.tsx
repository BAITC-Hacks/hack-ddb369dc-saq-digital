import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { startBackend } from './test/backend'

const nativeFetch = globalThis.fetch
let backend: Awaited<ReturnType<typeof startBackend>>
let transport: ReturnType<typeof vi.fn<typeof fetch>>

beforeEach(async () => {
  backend = await startBackend()
  window.history.replaceState({}, '', '/')
  window.sessionStorage.clear()
  transport = vi.fn<typeof fetch>((input, options) => nativeFetch(new URL(String(input), backend.url), options))
  vi.stubGlobal('fetch', transport)
})

afterEach(async () => {
  cleanup()
  vi.unstubAllGlobals()
  await backend?.close()
})

const cartWrites = () => transport.mock.calls.filter(([url, options]) => String(url).endsWith('/cart') && options?.method === 'POST')

async function search(query?: string) {
  if (query) {
    fireEvent.change(screen.getByLabelText('Сообщение помощнику EKT'), { target: { value: query } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
  } else fireEvent.click(screen.getByRole('button', { name: 'Demo' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Отправить' })).toBeEnabled())
}

describe('integrated EKT assistant', () => {
  it('loads the storefront and a backend session without writing to the cart', async () => {
    render(<App />)
    expect(screen.getByRole('dialog', { name: 'Чат с помощником EKT' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Каталог продукции' })).toBeInTheDocument()
    await waitFor(() => expect(transport.mock.calls.some(([url]) => String(url).endsWith('/cart'))).toBe(true))
    expect(cartWrites()).toHaveLength(0)
  })

  it('uses team data and only writes after confirmation, then restores the cart page', async () => {
    const view = render(<App />)
    await search()
    expect(await screen.findByText('DEMO-MCB-001')).toBeInTheDocument()
    expect(screen.getByText('DEMO-MCB-003')).toBeInTheDocument()
    expect(screen.getByText('DEMO-MCB-004')).toBeInTheDocument()
    expect(screen.queryByText('DEMO-MCB-005')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Недоступно/ })).toBeDisabled()
    fireEvent.click(screen.getAllByRole('button', { name: /Выбрать/ })[0])
    expect(cartWrites()).toHaveLength(0)
    expect(screen.getByRole('link', { name: /Корзина 0/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(cartWrites()).toHaveLength(0)
    fireEvent.click(screen.getAllByRole('button', { name: /Выбрать/ })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить и добавить' }))
    expect(await screen.findByText('Товар добавлен в корзину.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Перейти в корзину' })).toHaveAttribute('href', '/cart')
    expect(cartWrites()).toHaveLength(1)
    view.unmount()
    window.history.replaceState({}, '', '/cart')
    render(<App />)
    expect(await screen.findByText('DEMO-MCB-003')).toBeInTheDocument()
    expect(screen.getByText('8 шт.')).toBeInTheDocument()
    expect(screen.getAllByText(/63\s*200/)).toHaveLength(2)
    expect(screen.getByRole('heading', { name: 'Корзина' })).toBeInTheDocument()
  })

  it('reuses the confirmation ID after a lost response and does not add twice', async () => {
    render(<App />)
    await search()
    await screen.findByText('DEMO-MCB-003')
    let lost = false
    transport.mockImplementation(async (input, options) => {
      const response = await nativeFetch(new URL(String(input), backend.url), options)
      if (String(input).endsWith('/cart') && options?.method === 'POST' && !lost) {
        lost = true
        throw new TypeError('Response lost after server accepted confirmation')
      }
      return response
    })
    fireEvent.click(screen.getAllByRole('button', { name: /Выбрать/ })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить и добавить' }))
    expect(await screen.findByText(/Не удалось получить подтверждение/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Корзина 0/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить и добавить' }))
    expect(await screen.findByText('Товар добавлен в корзину.')).toBeInTheDocument()
    const writes = cartWrites().map(([, options]) => JSON.parse(String(options?.body)))
    expect(writes).toHaveLength(2)
    expect(writes[1]).toEqual(writes[0])
    const cartRequest = cartWrites()[1][1]
    const snapshot = await nativeFetch(`${backend.url}/api/cart`, { headers: cartRequest?.headers }).then((response) => response.json())
    expect(snapshot.items[0].quantity).toBe(8)
    expect(snapshot.totalPriceKzt).toBe(63200)
  })

  it('keeps the existing cart and shows stock errors on another confirmation', async () => {
    render(<App />)
    await search()
    await screen.findByText('DEMO-MCB-003')
    fireEvent.click(screen.getAllByRole('button', { name: /Выбрать/ })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить и добавить' }))
    await screen.findByText('Товар добавлен в корзину.')
    fireEvent.click(screen.getAllByRole('button', { name: /Выбрать/ })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить и добавить' }))
    const dialog = screen.getByRole('dialog', { name: 'Добавить товар в корзину?' })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('превышает доступный остаток')
    expect(screen.getByRole('link', { name: /Корзина 1/ })).toBeInTheDocument()
  })

  it('answers purchase terms with a source and handles empty or incomplete searches', async () => {
    render(<App />)
    await search('Какие условия доставки и оплаты?')
    expect(await screen.findByRole('link', { name: 'Источник условий' })).toHaveAttribute('href', 'https://ekt.kz/about/information/')
    expect(screen.getByText(/Физические лица могут оплатить/)).toBeInTheDocument()
    await search('4P D63, 15 kA, 1 штука')
    expect(await screen.findByText(/Нет подходящих позиций/)).toBeInTheDocument()
    await search('автомат')
    expect(await screen.findByText(/Сейчас включён локальный режим/)).toHaveTextContent('Укажите полюса')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(cartWrites()).toHaveLength(0)
  })

  it('does not overwrite a confirmed cart with a delayed initial GET', async () => {
    let finishInitial: (() => void) | undefined
    transport.mockImplementation(async (input, options) => {
      const response = await nativeFetch(new URL(String(input), backend.url), options)
      if (response.ok && String(input).endsWith('/cart') && options?.method === 'GET' && !finishInitial) {
        await new Promise<void>((resolve) => { finishInitial = resolve })
      }
      return response
    })
    render(<App />)
    await waitFor(() => expect(finishInitial).toBeTypeOf('function'))
    await search()
    await screen.findByText('DEMO-MCB-003')
    fireEvent.click(screen.getAllByRole('button', { name: /Выбрать/ })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить и добавить' }))
    await screen.findByText('Товар добавлен в корзину.')
    await act(async () => { finishInitial?.() })
    expect(screen.getByRole('link', { name: /Корзина 1/ })).toBeInTheDocument()
  })

  it('serves the cart screen at the custom local route returned by the API', async () => {
    transport.mockImplementation(async (input, options) => {
      const response = await nativeFetch(new URL(String(input), backend.url), options)
      if (!response.ok || !String(input).endsWith('/cart')) return response
      return new Response(JSON.stringify({ ...await response.json(), cartUrl: '/checkout-cart' }), { headers: { 'Content-Type': 'application/json' } })
    })
    const view = render(<App />)
    await search()
    await screen.findByText('DEMO-MCB-003')
    fireEvent.click(screen.getAllByRole('button', { name: /Выбрать/ })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить и добавить' }))
    expect(await screen.findByRole('link', { name: 'Перейти в корзину' })).toHaveAttribute('href', '/checkout-cart')
    view.unmount()
    window.history.replaceState({}, '', '/checkout-cart')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Корзина' })).toBeInTheDocument()
    expect(screen.getByText('8 шт.')).toBeInTheDocument()
  })

  it('answers free-form questions in the chat, preserves history, and accepts Enter', async () => {
    await backend.close()
    const reply = vi.fn(async () => ({
      kind: 'answer', answer: 'В каталоге представлены автоматические выключатели.',
      filters: { poles: null, curve: null, amps: null, breakingCapacityKa: null, quantity: null },
    }))
    backend = await startBackend({ queryParser: { reply } })
    render(<App />)
    await search('что по товарам есть')
    expect(await screen.findByText('В каталоге представлены автоматические выключатели.')).toBeInTheDocument()
    expect(screen.queryByText(/Нет подходящих позиций/)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    const input = screen.getByLabelText('Сообщение помощнику EKT')
    expect(input).toHaveValue('')
    fireEvent.change(input, { target: { value: 'Какие условия доставки?' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    expect(await screen.findByRole('link', { name: 'Источник условий' })).toBeInTheDocument()
    expect(screen.getByText('что по товарам есть')).toBeInTheDocument()
    expect(screen.getByText('В каталоге представлены автоматические выключатели.')).toBeInTheDocument()
    expect(reply).toHaveBeenCalledTimes(1)
    expect(cartWrites()).toHaveLength(0)
  })

  it('keeps a failed question visible and retries without duplicating it', async () => {
    render(<App />)
    await waitFor(() => expect(transport.mock.calls.some(([url]) => String(url).endsWith('/cart'))).toBe(true))
    let unavailable = true
    transport.mockImplementation((input, options) => String(input).endsWith('/search') && unavailable
      ? Promise.resolve(new Response(JSON.stringify({ error: { code: 'BACKEND_UNAVAILABLE', message: 'Сервер временно недоступен. Повторите запрос.' } }), { status: 503, headers: { 'Content-Type': 'application/json' } }))
      : nativeFetch(new URL(String(input), backend.url), options))
    await search('что по товарам есть')
    expect(await screen.findByRole('alert')).toHaveTextContent('Сервер временно недоступен')
    expect(screen.getByText('что по товарам есть')).toBeInTheDocument()
    unavailable = false
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText(/Сейчас включён локальный режим/)).toBeInTheDocument()
    expect(screen.getAllByText('что по товарам есть')).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(cartWrites()).toHaveLength(0)
  })
})
