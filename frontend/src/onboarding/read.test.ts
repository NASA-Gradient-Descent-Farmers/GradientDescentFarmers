import { describe, expect, it } from 'vitest'
import type { AreaUnit } from '../lib/farm.ts'
import { checkLand, monthsIn, readArea, readCrops, readMoney, readNumber, readUnit, readWhen } from './read.ts'

describe('readNumber', () => {
  it.each([
    ['2', 2], ['2.5', 2.5], ['2,5', 2.5], ['.5', 0.5], ['12.', 12], ['1,500', 1500], ['1 500', 1500], ['1,500,000', 1500000],
    ['1,500.75', 1500.75], ['1.500,75', 1500.75], ['1.500.000', 1500000], ['0,25', 0.25],
  ])('reads %s as %d', (text, value) => {
    expect(readNumber(text)).toBe(value)
  })

  it.each(['', ' ', '.', ',', 'abc', '2a', '1,2,3', '1.2.3', '-4', '1e3', '12,34.56,78'])('refuses %j', (text) => {
    expect(readNumber(text)).toBeNull()
  })
})

describe('readArea', () => {
  const ok = (text: string, fallback: AreaUnit = 'ha') => {
    const read = readArea(text, fallback)
    return read.ok ? read.land : read.problem
  }

  it('reads a number with the unit beside the field, or a unit written in the text', () => {
    expect(ok('2')).toEqual({ amount: 2, unit: 'ha' })
    expect(ok('2.5', 'ac')).toEqual({ amount: 2.5, unit: 'ac' })
    expect(ok('2,5 ha')).toEqual({ amount: 2.5, unit: 'ha' })
    expect(ok('5,000 m2')).toEqual({ amount: 5000, unit: 'm2' })
    expect(ok('5000m²')).toEqual({ amount: 5000, unit: 'm2' })
    expect(ok('1.5 acres')).toEqual({ amount: 1.5, unit: 'ac' })
    expect(ok('3 hectáreas', 'm2')).toEqual({ amount: 3, unit: 'ha' }) // the text wins over the selector
    expect(ok('120 metros cuadrados')).toEqual({ amount: 120, unit: 'm2' })
  })

  it('reads half a unit in both languages', () => {
    expect(ok('media hectárea')).toEqual({ amount: 0.5, unit: 'ha' })
    expect(ok('half an acre')).toEqual({ amount: 0.5, unit: 'ac' })
    expect(ok('half a hectare', 'm2')).toEqual({ amount: 0.5, unit: 'ha' })
    expect(ok('media')).toBe('unreadable')
  })

  it('says what is wrong instead of guessing', () => {
    expect(ok('')).toBe('empty')
    expect(ok('   ')).toBe('empty')
    expect(ok('mucha')).toBe('unreadable')
    expect(ok('2 fanegas')).toBe('unreadable') // a unit it does not know
    expect(ok('0')).toBe('notPositive')
    expect(ok('1,2,3')).toBe('unreadable')
  })

  it('knows its unit words', () => {
    expect(readUnit('Hectáreas')).toBe('ha')
    expect(readUnit('acre')).toBe('ac')
    expect(readUnit('m²')).toBe('m2')
    expect(readUnit('fanega')).toBeNull()
  })
})

describe('checkLand', () => {
  it('accepts plausible plots', () => {
    for (const land of [{ amount: 1, unit: 'ha' }, { amount: 0.5, unit: 'ha' }, { amount: 5000, unit: 'm2' }, { amount: 300, unit: 'ac' }] as const) {
      expect(checkLand(land)).toBe('ok')
    }
  })

  it('asks about the unit when the figure and the unit do not fit together', () => {
    expect(checkLand({ amount: 5000, unit: 'ha' })).toBe('unit') // 5,000 ha, or 5,000 m²?
    expect(checkLand({ amount: 500, unit: 'ha' })).toBe('unit')
    expect(checkLand({ amount: 20, unit: 'm2' })).toBe('unit') // 20 m², or 20 ha?
  })

  it('refuses what cannot be a field', () => {
    expect(checkLand({ amount: 0.001, unit: 'ha' })).toBe('tooSmall')
    expect(checkLand({ amount: 50000, unit: 'ha' })).toBe('tooLarge')
    expect(checkLand({ amount: 40000, unit: 'ac' })).toBe('tooLarge')
  })
})

describe('readWhen', () => {
  const planting = (text: string) => {
    const read = readWhen(text)
    return read.ok ? read.planting : read.problem
  }

  it('reads months in Spanish and English, with abbreviations and accents', () => {
    expect(planting('junio')).toEqual({ kind: 'month', month: 5, part: null })
    expect(planting('Mayo')).toEqual({ kind: 'month', month: 4, part: null })
    expect(planting('in June')).toEqual({ kind: 'month', month: 5, part: null })
    expect(planting('sep')).toEqual({ kind: 'month', month: 8, part: null })
    expect(planting('Septiembre')).toEqual({ kind: 'month', month: 8, part: null })
  })

  it('reads a third of the month when one is said', () => {
    expect(planting('a principios de junio')).toEqual({ kind: 'month', month: 5, part: 'early' })
    expect(planting('mediados de mayo')).toEqual({ kind: 'month', month: 4, part: 'mid' })
    expect(planting('a finales de julio')).toEqual({ kind: 'month', month: 6, part: 'late' })
    expect(planting('mid-June')).toEqual({ kind: 'month', month: 5, part: 'mid' })
    expect(planting('early May')).toEqual({ kind: 'month', month: 4, part: 'early' })
    expect(planting('end of August')).toEqual({ kind: 'month', month: 7, part: 'late' })
  })

  it('reads "when the rains start"', () => {
    expect(planting('cuando lleguen las primeras lluvias')).toEqual({ kind: 'rains' })
    expect(planting('con el temporal')).toEqual({ kind: 'rains' })
    expect(planting('when the rains start')).toEqual({ kind: 'rains' })
  })

  it('asks instead of choosing when it is unclear or names several months', () => {
    expect(planting('')).toBe('empty')
    expect(planting('pronto')).toBe('unclear')
    expect(planting('después de la cosecha')).toBe('unclear')
    expect(planting('junio o julio')).toBe('several')
    expect(readWhen('junio o julio')).toMatchObject({ months: [5, 6] })
  })

  it('finds the months named, in calendar order', () => {
    expect(monthsIn('julio, mayo')).toEqual([4, 6])
    expect(monthsIn('nada')).toEqual([])
  })
})

describe('readCrops', () => {
  it('separates the crops the models cover from the rest, keeping what was typed', () => {
    expect(readCrops('maíz, trigo y haba')).toEqual({ crops: ['maize', 'fababean'], unmodelled: ['trigo'] })
    expect(readCrops('Corn and barley')).toEqual({ crops: ['maize', 'barley'], unmodelled: [] })
    expect(readCrops('frijol; avena')).toEqual({ crops: [], unmodelled: ['frijol', 'avena'] })
    expect(readCrops('faba bean')).toEqual({ crops: ['fababean'], unmodelled: [] })
  })

  it('does not repeat a crop and ignores empty pieces', () => {
    expect(readCrops('maíz, maiz, Maize,, ')).toEqual({ crops: ['maize'], unmodelled: [] })
    expect(readCrops('')).toEqual({ crops: [], unmodelled: [] })
  })
})

describe('readMoney', () => {
  it.each([['20000', 20000], ['$20,000', 20000], ['20k', 20000], ['20 mil', 20000], ['20,000 pesos', 20000], ['1.5k', 1500], ['500 USD', 500], ['12 thousand', 12000]])(
    'reads %s as %d',
    (text, value) => expect(readMoney(text)).toBe(value),
  )

  it.each(['', 'mucho', '20 y algo', '-5', '$'])('refuses %j', (text) => expect(readMoney(text)).toBeNull())
})
