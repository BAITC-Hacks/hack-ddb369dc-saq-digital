// Opt-in failing audit cases: set EKT_RUN_AUDIT=1, then run this file with Vitest.
// Existing tests remain unchanged; product fixes are deliberately deferred.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import configuration from '../config.json'

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
const emptyCart = { items: [], totalPriceKzt: 0, cartUrl: configuration.cartPath }
let transport: ReturnType<typeof vi.fn<typeof fetch>>

describe.runIf(process.env.EKT_RUN_AUDIT === '1')('audit regressions (expected failures on e373a32)', () => {
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

  it('AUD-15: an AI_UNAVAILABLE response must provide a visible retry action', async () => {
    const reply = { intent: 'conversation', answer: 'Не удалось получить ответ AI-помощника.', filters: null, exactMatch: null, alternatives: [], notice: 'AI_UNAVAILABLE' }
    transport.mockImplementation((input) => Promise.resolve(String(input).endsWith('/session')
      ? json({ sessionId: 'audit-session' }) : String(input).endsWith('/search') ? json(reply) : json(emptyCart)))
    const { default: App } = await import('./App')
    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Сообщение помощнику EKT' }), { target: { value: 'что по товарам есть' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    await screen.findByText(reply.answer)
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
  }, 15000)
})
