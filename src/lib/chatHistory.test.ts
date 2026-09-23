import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createChat, HISTORY_KEY, loadChatHistory, saveChatHistory, type Chat } from './chatHistory'

const chats = (): Chat[] => [{
  id: 'chat-a', draft: 'А сертификат есть?', turns: [{
    id: 'turn-a', query: 'Автомат C16', language: 'ru', status: 'complete', response: {
      intent: 'product', answer: 'Есть в наличии', filters: { quantity: 2 },
      exactMatch: { canFulfill: true, product: {
        sku: 'A-16', name: 'Автомат', stock: 12, priceKzt: 1250,
        brand: 'Demo', poles: 1, curve: 'C', amps: 16, breakingCapacityKa: 6,
        properties: { Цвет: 'Белый', Вес: 120 },
        certificates: [{ name: 'Сертификат', url: 'https://example.com/certificate.pdf' }],
        minimumOrderQuantity: 1,
      } }, alternatives: [], sourceUrl: 'https://example.com/product',
    },
  }],
}, { id: 'chat-b', draft: 'Кабель', turns: [] }]

const store = (value: unknown) => localStorage.setItem(HISTORY_KEY, JSON.stringify(value))

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('chat history storage', () => {
  it.each(['certificate', 'source'])('rejects embedded credentials in a %s URL on save and restore', (kind) => {
    const original = chats()[0]
    const turn = original.turns[0]
    const response = turn.response!
    const url = 'https://user:secret@example.org/document.pdf'
    const changedResponse = kind === 'source' ? { ...response, sourceUrl: url } : {
      ...response, exactMatch: { ...response.exactMatch!, product: { ...response.exactMatch!.product, certificates: [{ name: 'Document', url }] } },
    }
    const changed = [{ ...original, turns: [{ ...turn, response: changedResponse }] }]
    expect(saveChatHistory(changed, original.id)).toBe(false)
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull()
    store({ version: 1, chats: changed, selectedChatId: original.id })
    expect(loadChatHistory().storageError).toBe(true)
  })
  it('starts with a fresh empty chat when no history exists', () => {
    expect(loadChatHistory()).toEqual({ chats: [{ id: expect.any(String), draft: '', turns: [] }], selectedChatId: null, storageError: false })
    expect(createChat().id).not.toBe(createChat().id)
  })

  it('roundtrips selected chat, drafts and product details as read-only restored turns', () => {
    const original = chats()
    expect(saveChatHistory(original, 'chat-b')).toBe(true)
    expect(JSON.parse(localStorage.getItem(HISTORY_KEY)!)).toMatchObject({ version: 1, selectedChatId: 'chat-b' })
    const loaded = loadChatHistory()
    expect(loaded).toEqual({ chats: [{ ...original[0], turns: [{ ...original[0].turns[0], restored: true }] }, original[1]], selectedChatId: 'chat-b', storageError: false })
    expect(original[0].turns[0].restored).toBeUndefined()
  })

  it('recovers interrupted requests as errors without replaying them', () => {
    const pending: Chat[] = [{ id: 'pending', draft: '', turns: [{ id: 'turn', query: 'Кабель', language: 'kk', status: 'loading' }] }]
    expect(saveChatHistory(pending, 'pending')).toBe(true)
    expect(loadChatHistory().chats[0].turns[0]).toEqual({ id: 'turn', query: 'Кабель', language: 'kk', status: 'error', error: { key: 'requestFailed' }, restored: true })
  })

  it('roundtrips warehouse availability and strips unknown warehouse fields', () => {
    const original = chats()
    const result = original[0].turns[0].response!
    const stores = [{ id: 1, name: 'Астана', quantity: 12, internal: 'private-warehouse' }, { id: -1, name: '', quantity: 0 }]
    const product = { ...result.exactMatch!.product, stores }
    const value = [{ ...original[0], turns: [{ ...original[0].turns[0], response: { ...result, exactMatch: { ...result.exactMatch!, product }, alternatives: [{ product, reason: 'Совпадают характеристики' }] } }] }]
    expect(saveChatHistory(value, 'chat-a')).toBe(true)
    const expected = [{ id: 1, name: 'Астана', quantity: 12 }, { id: -1, name: '', quantity: 0 }]
    expect(loadChatHistory().chats[0].turns[0].response).toMatchObject({ exactMatch: { product: { stores: expected } }, alternatives: [{ product: { stores: expected } }] })
    expect(localStorage.getItem(HISTORY_KEY)).not.toContain('private-warehouse')
    expect(stores[0].internal).toBe('private-warehouse')
  })

  it('preserves missing versus explicitly empty warehouse data in legacy histories', () => {
    const original = chats()
    const result = original[0].turns[0].response!
    const value = [{ ...original[0], turns: [{ ...original[0].turns[0], response: { ...result, alternatives: [{ product: { ...result.exactMatch!.product, stores: [] }, reason: 'Аналог' }] } }] }]
    expect(saveChatHistory(value, 'chat-a')).toBe(true)
    const loaded = loadChatHistory().chats[0].turns[0].response!
    expect(loaded.exactMatch!.product).not.toHaveProperty('stores')
    expect(loaded.alternatives[0].product).toHaveProperty('stores', [])
  })

  it.each([
    null, {}, [null], [{ id: '1', name: 'Астана', quantity: 1 }],
    [{ id: 1.5, name: 'Астана', quantity: 1 }], [{ id: Number.MAX_SAFE_INTEGER + 1, name: 'Астана', quantity: 1 }],
    [{ id: 1, name: null, quantity: 1 }], [{ id: 1, name: 'x'.repeat(1001), quantity: 1 }],
    [{ id: 1, name: 'Астана', quantity: -1 }], [{ id: 1, name: 'Астана', quantity: 0.5 }],
    [{ id: 1, name: 'Астана', quantity: '1' }],
    Array.from({ length: 101 }, (_, id) => ({ id, name: 'Астана', quantity: 0 })),
  ])('rejects malformed or oversized warehouses without replacing valid history', (stores) => {
    const original = chats()
    expect(saveChatHistory(original, 'chat-a')).toBe(true)
    const saved = localStorage.getItem(HISTORY_KEY)
    const result = original[0].turns[0].response!
    const value = [{ ...original[0], turns: [{ ...original[0].turns[0], response: { ...result, exactMatch: { ...result.exactMatch!, product: { ...result.exactMatch!.product, stores } } } }] }] as unknown as Chat[]
    expect(saveChatHistory(value, 'chat-a')).toBe(false)
    expect(localStorage.getItem(HISTORY_KEY)).toBe(saved)
    store({ version: 1, chats: value, selectedChatId: 'chat-a' })
    expect(loadChatHistory().storageError).toBe(true)
  })

  it.each([null, [], {}, { version: 2, chats: chats(), selectedChatId: 'chat-a' }, { version: 1, chats: [], selectedChatId: null }, { version: 1, chats: chats(), selectedChatId: 'missing' }])('rejects malformed or unsupported root %j', (value) => {
    store(value)
    expect(loadChatHistory()).toMatchObject({ chats: [{ draft: '', turns: [] }], storageError: true })
  })

  it('rejects malformed JSON', () => {
    localStorage.setItem(HISTORY_KEY, '{invalid')
    expect(loadChatHistory().storageError).toBe(true)
  })

  it.each([
    (value: any) => { value[0].turns[0].response.exactMatch.product.stock = -1 },
    (value: any) => { value[0].turns[0].response.exactMatch.product.certificates[0].url = 'javascript:alert(1)' },
    (value: any) => { value[0].turns[0].response.exactMatch.product.properties = { nested: {} } },
    (value: any) => { value[0].turns[0].response.alternatives = [{ reason: 'x', product: {} }] },
    (value: any) => { value[0].turns[0].language = 'en' },
    (value: any) => { value[0].turns[0].response.filters.quantity = 0 },
    (value: any) => { value[0].turns[0].response.exactMatch.canFulfill = 'yes' },
    (value: any) => { value[0].turns[0].response.intent = 'other' },
    (value: any) => { value[0].turns[0].status = 'error'; value[0].turns[0].error = { key: 'invalid' } },
    (value: any) => { value[1].id = value[0].id },
    (value: any) => { value[0].turns.push(value[0].turns[0]) },
  ])('rejects invalid nested data instead of partially trusting a history', (mutate) => {
    const value = chats()
    mutate(value)
    store({ version: 1, chats: value, selectedChatId: 'chat-a' })
    expect(loadChatHistory().storageError).toBe(true)
  })

  it('whitelists data on save and load, excluding session IDs and confirmations', () => {
    const value = chats() as any
    value[0].sessionId = 'private-session'
    value[0].confirmation = { confirmationId: 'private-confirmation' }
    value[0].turns[0].response.unrecognizedMetadata = 'response-secret'
    value[0].turns[0].response.exactMatch.product.internal = 'product-secret'
    expect(saveChatHistory(value, 'chat-a')).toBe(true)
    expect(localStorage.getItem(HISTORY_KEY)).not.toMatch(/private-|secret/)
    store({ version: 1, chats: value, selectedChatId: 'chat-a', sessionId: 'private-session' })
    expect(JSON.stringify(loadChatHistory())).not.toMatch(/private-|secret/)
  })

  it('handles blocked storage and quota errors without throwing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(loadChatHistory().storageError).toBe(true)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(saveChatHistory(chats(), 'chat-a')).toBe(false)
  })

  it('rejects oversized payloads and excessive text without replacing prior saved data', () => {
    expect(saveChatHistory(chats(), 'chat-a')).toBe(true)
    const saved = localStorage.getItem(HISTORY_KEY)
    expect(saveChatHistory([{ id: 'big', draft: 'x'.repeat(2_100_000), turns: [] }], 'big')).toBe(false)
    expect(localStorage.getItem(HISTORY_KEY)).toBe(saved)
    localStorage.setItem(HISTORY_KEY, ' '.repeat(2_100_000))
    expect(loadChatHistory().storageError).toBe(true)
  })

  it('saves error turns and rejects invalid in-memory payloads gracefully', () => {
    const value: Chat[] = [{ id: 'error', draft: '', turns: [{ id: 'turn', query: 'Кабель', language: 'ru', status: 'error', error: { key: 'requestTimeout', detail: 'Попробуйте позже' } }] }]
    expect(saveChatHistory(value, 'error')).toBe(true)
    expect(loadChatHistory().chats[0].turns[0].error).toEqual(value[0].turns[0].error)
    expect(saveChatHistory(value, 'missing')).toBe(false)
  })

  it('roundtrips nullable specifications, alternatives, and safe primitive properties', () => {
    const value = chats()
    const result = value[0].turns[0].response!
    const alternate = { ...result.exactMatch!.product, poles: null, curve: null, amps: null, breakingCapacityKa: null, technicalIssue: 'Уточните совместимость', properties: { value: null, enabled: true, offset: -2 } }
    value[0].turns[0].response = { ...result, intent: 'specifications', filters: null, exactMatch: null, alternatives: [{ product: alternate, reason: 'Совпадают характеристики' }] }
    expect(saveChatHistory(value, 'chat-a')).toBe(true)
    expect(loadChatHistory().chats[0].turns[0].response).toEqual(value[0].turns[0].response)
  })

  it('roundtrips a minimal product and purchase-terms response', () => {
    const value = chats()
    value[0].turns[0].response = { intent: 'purchase_terms', answer: '', filters: null, exactMatch: { canFulfill: false, product: { sku: 'minimal', name: 'Товар', stock: 0, priceKzt: 0 } }, alternatives: [] }
    expect(saveChatHistory(value, 'chat-a')).toBe(true)
    expect(loadChatHistory().chats[0].turns[0].response).toEqual(value[0].turns[0].response)
  })

  it('rejects excess counts and invalid optional fields rather than truncating them', () => {
    const value = chats()
    expect(saveChatHistory(Array.from({ length: 101 }, (_, index) => ({ id: `chat-${index}`, draft: '', turns: [] })), 'chat-0')).toBe(false)
    expect(saveChatHistory([{ ...value[0], turns: Array.from({ length: 501 }, (_, index) => ({ ...value[0].turns[0], id: `turn-${index}` })) }], 'chat-a')).toBe(false)
    const invalidOptional = [
      { curve: 'Z' }, { poles: 1.5 }, { amps: -1 }, { priceKzt: Infinity },
      { minimumOrderQuantity: 0 }, { properties: Object.fromEntries([['__proto__', 'unsafe']]) },
      { properties: { unsupported: undefined } },
      { certificates: Array.from({ length: 101 }, () => ({ name: 'Cert', url: 'https://example.com' })) },
    ]
    for (const extra of invalidOptional) {
      const original = chats()
      const result = original[0].turns[0].response!
      const invalidChats = [{ ...original[0], turns: [{ ...original[0].turns[0], response: { ...result, exactMatch: { ...result.exactMatch!, product: { ...result.exactMatch!.product, ...extra } } } }] }]
      expect(saveChatHistory(invalidChats as Chat[], 'chat-a')).toBe(false)
    }
  })

  it('rejects valid individual messages when the complete serialized history exceeds its budget', () => {
    const value = chats()
    const large = [{ ...value[0], turns: Array.from({ length: 12 }, (_, index) => ({ ...value[0].turns[0], id: `turn-${index}`, response: { ...value[0].turns[0].response!, answer: 'x'.repeat(100_000) } })) }]
    expect(saveChatHistory(large, 'chat-a')).toBe(false)
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull()
  })
})
