import { describe, expect, it } from 'vitest'
import { IMPLAUSIBLE_SHARE, otherUnit, resolveBudget, resolveCrops, resolveLand, resolveWhen, type BudgetContext, type BudgetDraft } from './resolve.ts'

describe('resolveCrops', () => {
  const draft = (patch: Partial<Parameters<typeof resolveCrops>[0]> = {}) => ({ picked: [], help: false, other: '', ...patch })

  it('asks for something when nothing is ticked, typed or asked for', () => {
    expect(resolveCrops(draft(), false)).toEqual({ kind: 'empty' })
    expect(resolveCrops(draft({ other: '  ' }), false)).toEqual({ kind: 'empty' })
  })

  it('takes the crops ticked, in the models’ order, and the ones typed by name', () => {
    expect(resolveCrops(draft({ picked: ['fababean', 'maize'] }), false)).toEqual({ kind: 'done', answer: { help: false, crops: ['maize', 'fababean'], unmodelled: [] } })
    expect(resolveCrops(draft({ picked: ['maize'], other: 'cebada' }), false)).toEqual({ kind: 'done', answer: { help: false, crops: ['maize', 'barley'], unmodelled: [] } })
  })

  it('"help me choose" wins over ticks and keeps what was typed that no model covers', () => {
    expect(resolveCrops(draft({ help: true, picked: ['maize'], other: 'trigo' }), false)).toEqual({ kind: 'done', answer: { help: true, crops: [], unmodelled: ['trigo'] } })
  })

  it('shows once what no model covers, and Continue again accepts what is left', () => {
    const typed = draft({ picked: ['maize'], other: 'trigo' })
    expect(resolveCrops(typed, false)).toEqual({ kind: 'followUp', crops: ['maize'], unmodelled: ['trigo'] })
    expect(resolveCrops(typed, true)).toEqual({ kind: 'done', answer: { help: false, crops: ['maize'], unmodelled: ['trigo'] } })
  })

  it('never accepts a crop answer that is only a crop no model covers', () => {
    const only = draft({ other: 'frijol, avena' })
    for (const acknowledged of [false, true]) expect(resolveCrops(only, acknowledged)).toEqual({ kind: 'followUp', crops: [], unmodelled: ['frijol', 'avena'] })
  })
})

describe('resolveLand', () => {
  it('accepts a plausible area, with the unit beside the field or in the text', () => {
    expect(resolveLand('2', 'ha')).toEqual({ kind: 'done', land: { amount: 2, unit: 'ha' } })
    expect(resolveLand('5', 'ac')).toEqual({ kind: 'done', land: { amount: 5, unit: 'ac' } })
    expect(resolveLand('5,000 m2', 'ha')).toEqual({ kind: 'done', land: { amount: 5000, unit: 'm2' } })
    expect(resolveLand('media hectárea', 'm2')).toEqual({ kind: 'done', land: { amount: 0.5, unit: 'ha' } })
  })

  it('says what is wrong: nothing, not a number, not more than zero, too small, too large', () => {
    expect(resolveLand('', 'ha')).toEqual({ kind: 'problem', problem: 'empty' })
    expect(resolveLand('mucha', 'ha')).toEqual({ kind: 'problem', problem: 'unreadable' })
    expect(resolveLand('0', 'ha')).toEqual({ kind: 'problem', problem: 'notPositive' })
    expect(resolveLand('0.001', 'ha')).toEqual({ kind: 'problem', problem: 'tooSmall' })
    expect(resolveLand('50000', 'ha')).toEqual({ kind: 'problem', problem: 'tooLarge' })
  })

  it('asks which unit was meant when the figure and the unit do not fit, and offers the other one', () => {
    const big = resolveLand('600', 'ha')
    expect(big).toEqual({ kind: 'ask', land: { amount: 600, unit: 'ha' } })
    expect(otherUnit({ amount: 600, unit: 'ha' })).toEqual({ amount: 600, unit: 'm2' })
    expect(resolveLand('20', 'm2')).toEqual({ kind: 'ask', land: { amount: 20, unit: 'm2' } })
    expect(otherUnit({ amount: 20, unit: 'm2' })).toEqual({ amount: 20, unit: 'ha' })
  })
})

describe('resolveWhen', () => {
  it('takes the picked month or "when the rains start"', () => {
    expect(resolveWhen({ pick: { kind: 'month', month: 5, part: 'mid' }, text: '' })).toEqual({ kind: 'done', planting: { kind: 'month', month: 5, part: 'mid' } })
    expect(resolveWhen({ pick: { kind: 'rains' }, text: '' })).toEqual({ kind: 'done', planting: { kind: 'rains' } })
  })

  it('reads typed words, which win over a pick', () => {
    expect(resolveWhen({ pick: { kind: 'rains' }, text: 'a finales de julio' })).toEqual({ kind: 'done', planting: { kind: 'month', month: 6, part: 'late' } })
  })

  it('asks for something when nothing was given', () => {
    expect(resolveWhen({ pick: null, text: '' })).toEqual({ kind: 'problem', problem: 'empty', months: [], text: '' })
  })

  it('does not choose between months, nor guess at words it cannot place, and gives back what was typed', () => {
    expect(resolveWhen({ pick: null, text: 'junio o julio' })).toEqual({ kind: 'problem', problem: 'several', months: [5, 6], text: 'junio o julio' })
    expect(resolveWhen({ pick: null, text: ' pronto ' })).toEqual({ kind: 'problem', problem: 'unclear', months: [], text: 'pronto' })
  })
})

describe('resolveBudget', () => {
  const draft = (patch: Partial<BudgetDraft> = {}): BudgetDraft => ({ currency: 'MXN', rate: '18', pick: null, text: '', ...patch })
  const context = (patch: Partial<BudgetContext> = {}): BudgetContext => ({
    areaHa: 2,
    ranges: [{ low: 0, high: 28000 }, { low: 28000, high: 32000 }, { low: 32000, high: null }],
    cheapestPerHa: 11333,
    ...patch,
  })

  it('takes a range as it was offered, in the currency of the draft, as a total when the area is known', () => {
    expect(resolveBudget(draft({ pick: 1 }), context())).toEqual({ kind: 'done', budget: { currency: 'MXN', rate: null, low: 28000, high: 32000, basis: 'total' } })
    expect(resolveBudget(draft({ pick: 2 }), context())).toEqual({ kind: 'done', budget: { currency: 'MXN', rate: null, low: 32000, high: null, basis: 'total' } })
    expect(resolveBudget(draft({ currency: 'USD', pick: 0 }), context())).toEqual({ kind: 'done', budget: { currency: 'USD', rate: 18, low: 0, high: 28000, basis: 'total' } })
  })

  it('with no area, amounts are per hectare', () => {
    expect(resolveBudget(draft({ pick: 0 }), context({ areaHa: null }))).toMatchObject({ kind: 'done', budget: { basis: 'perHa' } })
  })

  it('reads a typed amount ("25k", "$25,000 pesos") as both ends of the budget', () => {
    expect(resolveBudget(draft({ text: '25k' }), context())).toEqual({ kind: 'done', budget: { currency: 'MXN', rate: null, low: 25000, high: 25000, basis: 'total' } })
    expect(resolveBudget(draft({ text: '$25,000 pesos' }), context())).toMatchObject({ kind: 'done', budget: { low: 25000, high: 25000 } })
  })

  it('a typed amount wins over a range that was picked earlier', () => {
    expect(resolveBudget(draft({ text: '30000', pick: 0 }), context())).toMatchObject({ kind: 'done', budget: { low: 30000, high: 30000 } })
  })

  it('asks whether a total is for the whole land when it could not pay for a hectare, but not at the boundary', () => {
    expect(resolveBudget(draft({ text: '5k' }), context())).toMatchObject({ kind: 'ask', budget: { low: 5000, high: 5000, basis: 'total' } })
    const floor = 11333 * IMPLAUSIBLE_SHARE * 2 // 2 ha
    expect(resolveBudget(draft({ text: String(floor) }), context())).toMatchObject({ kind: 'done' })
    expect(resolveBudget(draft({ text: String(floor - 1) }), context())).toMatchObject({ kind: 'ask' })
  })

  it('does not ask when the amount is per hectare already, or the area is not known', () => {
    expect(resolveBudget(draft({ text: '5k' }), context({ areaHa: null }))).toMatchObject({ kind: 'done', budget: { basis: 'perHa', high: 5000 } })
  })

  it('compares dollars in pesos', () => {
    expect(resolveBudget(draft({ currency: 'USD', text: '100' }), context())).toMatchObject({ kind: 'ask' }) // 1,800 pesos for 2 ha
    expect(resolveBudget(draft({ currency: 'USD', text: '1500' }), context())).toMatchObject({ kind: 'done', budget: { currency: 'USD', rate: 18 } })
  })

  it('needs a usable rate for dollars, and none for pesos', () => {
    for (const rate of ['', 'abc', '0', '-3']) expect(resolveBudget(draft({ currency: 'USD', rate, text: '1500' }), context())).toEqual({ kind: 'problem', problem: 'rate' })
    expect(resolveBudget(draft({ currency: 'MXN', rate: 'abc', text: '25000' }), context())).toMatchObject({ kind: 'done' })
  })

  it('says what is wrong with an empty, unreadable or zero amount', () => {
    expect(resolveBudget(draft(), context())).toEqual({ kind: 'problem', problem: 'empty' })
    expect(resolveBudget(draft({ text: 'mucho' }), context())).toEqual({ kind: 'problem', problem: 'unreadable' })
    expect(resolveBudget(draft({ text: '0' }), context())).toEqual({ kind: 'problem', problem: 'notPositive' })
    expect(resolveBudget(draft({ pick: 7 }), context())).toEqual({ kind: 'problem', problem: 'empty' }) // a range that is not on offer
  })
})
