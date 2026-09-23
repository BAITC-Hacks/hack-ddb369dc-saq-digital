import { describe, expect, it } from 'vitest'
import { backendSearchQuery } from './i18n'

describe('backendSearchQuery', () => {
  it('preserves Russian queries and unrelated Kazakh text', () => {
    expect(backendSearchQuery('Нужен автомат, 8 штук', 'ru')).toBe('Нужен автомат, 8 штук')
    expect(backendSearchQuery('3P C16', 'kk')).toBe('3P C16')
    expect(backendSearchQuery('8 данадан', 'kk')).toBe('8 данадан')
  })

  it('maps Kazakh starter keywords to the current backend parser', () => {
    expect(backendSearchQuery('3P C16, 8 дана керек', 'kk')).toBe('3P C16, 8 шт. керек')
    expect(backendSearchQuery('Төлем шарттары қандай?', 'kk')).toBe('оплата шарттары қандай?')
  })
})
