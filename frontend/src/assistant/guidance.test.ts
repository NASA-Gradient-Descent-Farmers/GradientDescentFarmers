import { describe, expect, it } from 'vitest'
import { DICTIONARIES, translate } from '../i18n/translate.ts'
import { PRIORITIES, PRESETS, presetFor, type Preset } from '../lib/farm.ts'
import { makeFormat, type Lang } from '../lib/format.ts'
import type { Say } from './compose.ts'
import { guide, describePlanting, list } from './guidance.ts'
import { interpret } from './interpret.ts'
import { DRY_SCENARIOS, SCENARIOS } from './models.ts'
import { runModels } from './run.ts'
import { data, defaults } from './testdata.ts'
import type { FarmInputs, PlannerResult } from './types.ts'

const say = (lang: Lang): Say => ({ t: (path, vars) => translate(DICTIONARIES[lang], path, vars), fmt: makeFormat(lang) })
const QUESTION = '¿Qué sembrar y cuánto abonar?'

const farm = (patch: Partial<FarmInputs> = {}): FarmInputs => ({
  wanted: [], unmodelled: [], rotations: data.meta.rotation_order, areaHa: null, budget: null, planting: null, water: null, priority: null, ...patch,
})

async function plan(inputs: FarmInputs | undefined, preset: Preset = 'sustainability', world: 'calibrated' | 'default' = 'calibrated') {
  const interpretation = interpret(QUESTION, { ...defaults, preset, world }, { farm: inputs })
  const outcomes = await runModels({ data, pin: null, interpretation })
  const planner = outcomes.find((o) => o.model === 'planner')
  if (!planner?.ok || planner.model !== 'planner') throw new Error('the planner did not answer')
  return { interpretation, result: planner.result as PlannerResult }
}

describe('the planner with no answers from the farmer', () => {
  it('behaves exactly as before: the document’s pick, and no limits recorded', async () => {
    const { result } = await plan(undefined)
    expect(result.limits).toBeNull()
    expect(result.strategy.rotation).toBe('maize-fababean')
    expect(result.strategy.retention).toBeCloseTo(0.9, 12)
    expect(result.strategy.values.net_mxn_ha).toBeCloseTo(11456.67, 1)
    expect(result.scored).toBe(4 * 51 * 21)
  })

  it('picks the same with every rotation allowed and no budget', async () => {
    const without = (await plan(undefined)).result
    const { result } = await plan(farm({ wanted: [] }))
    expect(result.limits).toMatchObject({ rotations: data.meta.rotation_order, capPerHa: null, feasible: true, withoutBudget: null })
    expect(result.strategy).toEqual(without.strategy)
    expect(result.frontSize).toBe(without.frontSize)
  })
})

describe('the crops asked for narrow the rotations', () => {
  it('compares only the rotations that include them, and scores only those', async () => {
    const { result } = await plan(farm({ wanted: ['barley'], rotations: ['maize-barley', 'maize-barley-fababean'] }))
    expect(['maize-barley', 'maize-barley-fababean']).toContain(result.strategy.rotation)
    expect(result.scored).toBe(2 * 51 * 21)
    expect(result.limits?.rotations).toEqual(['maize-barley', 'maize-barley-fababean'])
    for (const pick of Object.values(result.picks)) expect(['maize-barley', 'maize-barley-fababean']).toContain(pick.rotation)
  })

  it('uses the one rotation that holds every crop when there is only one', async () => {
    const { result } = await plan(farm({ wanted: ['barley', 'fababean'], rotations: ['maize-barley-fababean'] }))
    expect(result.strategy.rotation).toBe('maize-barley-fababean')
  })
})

describe('the budget limits the plan', () => {
  const perHa = (high: number | null, currency: 'MXN' | 'USD' = 'MXN', rate: number | null = null) => ({ currency, rate, low: 0, high, basis: 'perHa' as const })

  it('picks a plan that fits, and says which plan the budget replaced', async () => {
    const open = (await plan(farm(), 'profit')).result
    const { result } = await plan(farm({ budget: perHa(12000) }), 'profit')
    expect(open.strategy.rotation).toBe('maize') // the profit pick costs 14,000 per hectare
    expect(open.strategy.cost).toBe(14000)
    expect(result.limits).toMatchObject({ capPerHa: 12000, feasible: true })
    expect(result.strategy.cost).toBeLessThanOrEqual(12000)
    expect(result.strategy.rotation).toBe('maize-barley')
    expect(result.limits?.withoutBudget).toMatchObject({ rotation: 'maize', cost: 14000 })
  })

  it('a budget above every cost changes nothing', async () => {
    const { result } = await plan(farm({ budget: perHa(100000) }), 'profit')
    expect(result.limits?.withoutBudget).toBeNull()
    expect(result.strategy).toEqual((await plan(farm(), 'profit')).result.strategy)
  })

  it('one below the cheapest plan shows the cheapest ones and says so', async () => {
    const { result } = await plan(farm({ budget: perHa(5000) }))
    expect(result.limits?.feasible).toBe(false)
    expect(result.strategy.cost).toBeCloseTo(result.limits!.cheapest, 6)
    expect(result.limits!.cheapest).toBeCloseTo(34000 / 3, 6)
  })

  it('splits a total by the area and converts dollars', async () => {
    const total = { currency: 'MXN' as const, rate: null, low: 0, high: 24000, basis: 'total' as const }
    expect((await plan(farm({ budget: total, areaHa: 2 }))).result.limits?.capPerHa).toBe(12000)
    expect((await plan(farm({ budget: perHa(600, 'USD', 20) }))).result.limits?.capPerHa).toBe(12000)
  })

  it('cannot use a total without the area: no ceiling, and the guidance says why', async () => {
    const total = { currency: 'MXN' as const, rate: null, low: 0, high: 24000, basis: 'total' as const }
    const { result } = await plan(farm({ budget: total, areaHa: null }))
    expect(result.limits?.capPerHa).toBeNull()
    const items = guide(farm({ budget: total, areaHa: null }), result, data.meta, say('en'))
    expect(items.find((i) => i.topic === 'budget')?.text).toMatch(/do not know how much land/)
  })
})

describe('the priority changes the pick', () => {
  it('every priority gives a strategy of the grid, and they do not all agree', async () => {
    for (const world of ['calibrated', 'default'] as const) {
      const picks = new Set<string>()
      for (const preset of PRESETS) {
        const { result } = await plan(undefined, preset, world)
        expect(Number.isFinite(result.strategy.cost)).toBe(true)
        expect(result.preset).toBe(preset)
        picks.add(`${result.strategy.rotation}|${result.strategy.nScale}|${result.strategy.retention}`)
      }
      expect(picks.size).toBeGreaterThan(2)
    }
  })

  it('"spend less" costs no more than any other pick that keeps 90% of the best net income', async () => {
    for (const world of ['calibrated', 'default'] as const) {
      const cheap = (await plan(undefined, 'costs', world)).result.strategy
      const profit = (await plan(undefined, 'profit', world)).result.strategy
      expect(cheap.cost).toBeLessThanOrEqual(profit.cost + 1e-9)
    }
  })

  it('"save water" asks for steadier income and the risk model with the low-rain scenarios', () => {
    expect(presetFor('water')).toBe('steady')
    const interpretation = interpret(QUESTION, { ...defaults, preset: 'steady' }, { farm: farm({ priority: 'water' }) })
    expect(interpretation.models).toEqual(['planner', 'risk'])
    expect(interpretation.added).toEqual([{ model: 'risk', reason: 'water' }])
    expect(interpretation.scenarios).toEqual(DRY_SCENARIOS)
  })

  it('does not add the risk model when the farmer chose the models, when it is already asked for, or for other priorities', () => {
    const manual = interpret(QUESTION, defaults, { farm: farm({ priority: 'water' }), manual: ['planner'] })
    expect(manual.models).toEqual(['planner'])
    const asked = interpret('¿Qué sembrar si llueve poco?', defaults, { farm: farm({ priority: 'water' }) })
    expect(asked.added).toEqual([])
    expect(asked.models).toEqual(['planner', 'risk'])
    expect(interpret(QUESTION, defaults, { farm: farm({ priority: 'income' }) }).models).toEqual(['planner'])
    expect(DRY_SCENARIOS.every((s) => SCENARIOS.includes(s))).toBe(true)
  })

  it('carries the answers on the interpretation, and none when there are none', () => {
    const inputs = farm({ areaHa: 2, priority: 'yield' })
    expect(interpret(QUESTION, defaults, { farm: inputs }).farm).toBe(inputs)
    expect('farm' in interpret(QUESTION, defaults)).toBe(false)
    expect('farm' in interpret(QUESTION, defaults, { farm: null })).toBe(false)
  })
})

describe('the guidance, answer by answer', () => {
  const inputs = farm({
    wanted: ['maize', 'fababean'],
    unmodelled: ['trigo'],
    rotations: ['maize-fababean', 'maize-barley-fababean'],
    areaHa: 2,
    budget: { currency: 'MXN', rate: null, low: 0, high: 30000, basis: 'total' },
    planting: { kind: 'month', month: 5, part: 'early' },
    water: 'some',
    priority: 'water',
  })

  it('has one statement for each answer, each saying what kind of statement it is', async () => {
    const { result } = await plan(inputs, 'steady')
    const items = guide(inputs, result, data.meta, say('en'))
    expect(new Set(items.map((i) => i.topic))).toEqual(new Set(['crops', 'priority', 'budget', 'land', 'planting', 'water']))
    const by = (topic: string) => items.filter((i) => i.topic === topic)
    expect(by('crops').map((i) => i.basis)).toEqual(['plan', 'limit']) // the comparison, and the crop no model covers
    expect(by('crops')[1].text).toContain('trigo')
    expect(by('priority')[0]).toMatchObject({ basis: 'limit', tone: 'warn' }) // saving water is not measured
    expect(by('budget')[0]).toMatchObject({ basis: 'check', tone: 'good' })
    expect(by('water')[0]).toMatchObject({ basis: 'limit', tone: 'warn' })
    expect(by('planting')[0]).toMatchObject({ basis: 'check', tone: 'good' })
  })

  it('multiplies the per-hectare numbers by the area, to the hundred', async () => {
    const { result } = await plan(inputs, 'steady')
    const land = guide(inputs, result, data.meta, say('en')).find((i) => i.topic === 'land')!.text
    const round = (v: number) => Math.round(v / 100) * 100
    expect(land).toContain(`${makeFormat('en').number(round(result.strategy.cost * 2))} pesos`)
    expect(land).toContain(`${makeFormat('en').number(round(result.strategy.values.net_mxn_ha * 2))} pesos`)
    expect(land).toContain('For your 2 ha')
  })

  it('compares the planting time with the model’s sowing window for the crop it fits', async () => {
    const { result } = await plan(inputs, 'steady')
    const at = (planting: FarmInputs['planting'], lang: Lang = 'en') => guide({ ...inputs, planting }, result, data.meta, say(lang)).find((i) => i.topic === 'planting')
    const june = at({ kind: 'month', month: 5, part: 'early' })!
    expect(june).toMatchObject({ tone: 'good' })
    expect(june.text).toContain('in early June')
    expect(june.text).toContain('maize: May 15 to June 29') // the first crop whose window holds the date
    expect(at({ kind: 'month', month: 5, part: 'early' }, 'es')!.text).toContain('maíz: del 15 de mayo al 29 de junio')
    // Late June is only partly inside maize's window and fully inside faba bean's: the better fit is the one reported.
    expect(at({ kind: 'month', month: 5, part: 'late' })!.text).toContain('sows faba bean: June 15 to July 30')
    expect(at({ kind: 'month', month: 1, part: null })).toMatchObject({ tone: 'warn' }) // February: before any window
    expect(at({ kind: 'month', month: 1, part: null })!.text).toMatch(/before the model’s window/)
    expect(at({ kind: 'month', month: 9, part: 'late' })!.text).toMatch(/after the model’s window/)
    expect(at({ kind: 'rains' })!.text).toMatch(/at least 20 mm of rain in 5 days/)
  })

  it('names the budget cases: no ceiling, too low, and what the budget replaced', async () => {
    const budget = (high: number | null) => ({ currency: 'MXN' as const, rate: null, low: 0, high, basis: 'perHa' as const })
    const text = async (b: ReturnType<typeof budget>, preset: Preset = 'profit') => {
      const f = farm({ budget: b })
      const { result } = await plan(f, preset)
      return guide(f, result, data.meta, say('en')).filter((i) => i.topic === 'budget').map((i) => i.text)
    }
    expect((await text(budget(null)))[0]).toMatch(/sets no ceiling/)
    expect((await text(budget(5000)))[0]).toMatch(/does not cover even the model’s cheapest plan/)
    const replaced = await text(budget(12000))
    expect(replaced[0]).toMatch(/fits your budget/)
    expect(replaced[1]).toMatch(/Without your budget the plan would be different: maize every year/)
  })

  it('warns when the rotation adds a crop that was not named, and speaks of a single rotation when there is one', async () => {
    const maizeOnly = farm({ wanted: ['maize'] })
    const { result } = await plan(maizeOnly) // the sustainability pick is maize – faba bean
    const items = guide(maizeOnly, result, data.meta, say('en')).filter((i) => i.topic === 'crops')
    expect(items.map((i) => i.tone)).toEqual(['note', 'warn'])
    expect(items[1].text).toContain('adds faba bean')
    const one = farm({ wanted: ['barley', 'fababean'], rotations: ['maize-barley-fababean'] })
    const all = guide(one, (await plan(one)).result, data.meta, say('en'))
    expect(all.find((i) => i.topic === 'crops')!.text).toMatch(/single rotation that includes them all/)
  })

  it('helps to choose when asked to', async () => {
    const help = farm()
    const { result } = await plan(help)
    expect(guide(help, result, data.meta, say('en'))[0].text).toMatch(/You asked for help choosing: I compared the model’s 4 rotations/)
  })

  it('leaves out what was not answered', async () => {
    const { result } = await plan(farm())
    expect(guide(farm(), result, data.meta, say('en')).map((i) => i.topic)).toEqual(['crops'])
  })
})

describe('every combination of answers reads cleanly in both languages', () => {
  const LEAK = /assistant\.|onboarding\.|\{\w+\}|NaN|undefined|Infinity/

  it('has no missing translation, unfilled placeholder or broken number', async () => {
    const budgets: FarmInputs['budget'][] = [
      null,
      { currency: 'MXN', rate: null, low: 0, high: 12000, basis: 'perHa' },
      { currency: 'MXN', rate: null, low: 0, high: 5000, basis: 'perHa' },
      { currency: 'USD', rate: 18, low: 1000, high: 1500, basis: 'total' },
      { currency: 'MXN', rate: null, low: 30000, high: null, basis: 'total' },
    ]
    const plantings: FarmInputs['planting'][] = [null, { kind: 'rains' }, { kind: 'month', month: 3, part: null }, { kind: 'month', month: 5, part: 'mid' }, { kind: 'month', month: 8, part: 'late' }]
    const crops: FarmInputs['wanted'][] = [[], ['maize'], ['barley'], ['maize', 'fababean'], ['maize', 'barley', 'fababean']]
    let checked = 0
    for (const priority of [...PRIORITIES, null]) {
      for (const [i, wanted] of crops.entries()) {
        const f = farm({
          wanted,
          unmodelled: i % 2 ? ['frijol'] : [],
          rotations: data.meta.rotation_order.filter((r) => wanted.every((c) => data.meta.rotations[r].includes(c))),
          areaHa: i === 0 ? null : 0.4 * (i + 1),
          budget: budgets[i],
          planting: plantings[i],
          water: (['rain', 'some', 'regular', null, 'rain'] as const)[i],
          priority,
        })
        const { result } = await plan(f, priority ? presetFor(priority) : 'sustainability')
        for (const lang of ['es', 'en'] as const) {
          for (const item of guide(f, result, data.meta, say(lang))) {
            expect(item.text, `${priority} ${wanted.join('+')} ${lang}`).not.toMatch(LEAK)
            checked++
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100)
  })
})

describe('helpers for sentences', () => {
  it('lists with "and" in each language', () => {
    expect(list(say('en'), ['maize'])).toBe('maize')
    expect(list(say('en'), ['maize', 'barley'])).toBe('maize and barley')
    expect(list(say('es'), ['maíz', 'cebada', 'haba'])).toBe('maíz, cebada y haba')
  })

  it('says a planting time the way people do', () => {
    expect(describePlanting({ kind: 'month', month: 5, part: 'early' }, say('es'))).toBe('a principios de junio')
    expect(describePlanting({ kind: 'month', month: 4, part: null }, say('es'))).toBe('en mayo')
    expect(describePlanting({ kind: 'month', month: 5, part: 'mid' }, say('en'))).toBe('in mid-June')
    expect(describePlanting({ kind: 'rains' }, say('en'))).toBe('when the first rains arrive')
  })
})
