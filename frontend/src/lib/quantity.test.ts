import { describe, expect, it } from 'vitest'
import { quantityError, stepQuantity } from './quantity'

const product = { stock: 11, minimumOrderQuantity: 2 }
describe('quantity validation', () => {
  it.each(['', '0', '-2', '1.5', '1e2', 'Infinity', '9007199254740992'])('rejects invalid integer %s', (value) => {
    expect(quantityError(value, product)).toBe('invalidQuantity')
  })
  it('validates stock and order multiples without clamping typed values', () => {
    expect(quantityError('12', product)).toBe('quantityStock')
    expect(quantityError('3', product)).toBe('quantityMultiple')
    expect(quantityError('10', product)).toBeNull()
    expect(quantityError('1', { stock: 3 })).toBeNull()
  })
  it('steps between valid multiples and never exceeds stock', () => {
    expect(stepQuantity('8', product, 1)).toBe(10)
    expect(stepQuantity('10', product, 1)).toBe(10)
    expect(stepQuantity('2', product, -1)).toBe(2)
    expect(stepQuantity('7', product, -1)).toBe(6)
    expect(stepQuantity('7', product, 1)).toBe(8)
    expect(stepQuantity('', product, 1)).toBe(2)
    expect(stepQuantity('99', product, -1)).toBe(10)
  })
  it('fails closed when no valid pack is available or limits are invalid', () => {
    expect(stepQuantity('1', { stock: 1, minimumOrderQuantity: 2 }, 1)).toBeNull()
    expect(quantityError('1', { stock: NaN })).not.toBeNull()
    expect(quantityError('1', { stock: 2, minimumOrderQuantity: 0 })).not.toBeNull()
  })
  it('allows whole units from a fractional stock balance', () => {
    expect(quantityError('2', { stock: 2.5 })).toBeNull()
    expect(quantityError('3', { stock: 2.5 })).toBe('quantityStock')
    expect(stepQuantity('2', { stock: 2.5 }, 1)).toBe(2)
  })
})
