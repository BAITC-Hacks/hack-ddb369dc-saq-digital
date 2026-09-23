// Production regressions discovered in the adversarial audit.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import configuration from '../config.json'
import App from './App'

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
const emptyCart = { items: [], totalPriceKzt: 0, cartUrl: configuration.cartPath }
let transport: ReturnType<typeof vi.fn<typeof fetch>>

describe('audit regressions', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear(); sessionStorage.clear()
    window.history.replaceState({}, '', '/')
    transport = vi.fn<typeof fetch>((input) => Promise.resolve(String(input).endsWith('/session')
      ? json({ sessionId: 'audit-session' }) : json(emptyCart)))
    vi.stubGlobal('fetch', transport)
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('AUD-13: malformed successful cart JSON must be rejected before rendering', async () => {
    transport.mockImplementation((input) => Promise.resolve(String(input).endsWith('/session')
      ? json({ sessionId: 'audit-session' }) : json({ items: null, totalPriceKzt: 0, cartUrl: configuration.cartPath })))
    const api = await import('./lib/api')
    await expect(api.getCart()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('AUD-14: blocked sessionStorage must allow an in-memory session', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Storage disabled', 'SecurityError') })
    const api = await import('./lib/api')
    await expect(api.getCart()).resolves.toMatchObject({ items: [] })
  })

  it.each(['AI_UNAVAILABLE', 'AI_CALL_LIMIT', 'AI_RATE_LIMIT'])('AUD-15: %s provides a retry without duplicate history or cart writes', async (notice) => {
    const reply = { intent: 'conversation', answer: 'Не удалось получить ответ AI-помощника.', filters: null, exactMatch: null, alternatives: [], notice }
    transport.mockImplementation((input) => Promise.resolve(String(input).endsWith('/session')
      ? json({ sessionId: 'audit-session' }) : String(input).endsWith('/search') ? json(reply) : json(emptyCart)))
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Сообщение помощнику EKT' }), { target: { value: 'что по товарам есть' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    await screen.findByText(reply.answer)
    const retry = screen.getByRole('button', { name: 'Повторить' })
    transport.mockImplementation((input) => Promise.resolve(String(input).endsWith('/search')
      ? json({ ...reply, answer: 'В каталоге есть автоматические выключатели.', notice: undefined }) : json(emptyCart)))
    fireEvent.click(retry)
    await screen.findByText('В каталоге есть автоматические выключатели.')
    expect(screen.getAllByText('что по товарам есть')).toHaveLength(1)
    expect(screen.queryByText(reply.answer)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(transport.mock.calls.filter(([input, options]) => String(input).endsWith('/cart') && options?.method === 'POST')).toHaveLength(0)
  }, 15000)
})
