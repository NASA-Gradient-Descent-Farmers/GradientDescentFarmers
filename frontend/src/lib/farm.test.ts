import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseData } from './data.ts'
import {
  ASSUMED_MXN_PER_USD, COST_KEEP, PRESETS, PRIORITIES, budgetEdges, capPerHa, checkPlanting, costBand, focusWeights, niceRound, pickStrategy,
  plantingDays, presetFor, rotationsFor, sowingWindow, toHectares, weightsFor, type Budget,
} from './farm.ts'
import { Planner } from './planner.ts'
import { exactFront, limitedFront } from './scenario.ts'
import type { GridFile, Meta, Strategy } from './types.ts'
import { OBJECTIVES } from './types.ts'

const read = <T>(path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T
const { meta, grids, maximize } = parseData(read<Meta>('../../public/data/meta.json'), read<GridFile>('../../public/data/grid.json'), read<unknown>('../../public/data/models.json'))
const world = grids.calibrated

describe('areas', () => {
  it('converts to hectares', () => {
    expect(toHectares({ amount: 2, unit: 'ha' })).toBe(2)
    expect(toHectares({ amount: 5000, unit: 'm2' })).toBeCloseTo(0.5, 12)
    expect(toHectares({ amount: 1, unit: 'ac' })).toBeCloseTo(0.404686, 6) // 4,046.8564224 m²
  })
})

describe('priorities', () => {
  it('map to a preset, and saving water to the steadiness of income in bad years', () => {
    expect(Object.fromEntries(PRIORITIES.map((p) => [p, presetFor(p)]))).toEqual({
      income: 'profit', yield: 'yield', costs: 'costs', soil: 'sustainability', steady: 'steady', water: 'steady',
    })
  })

  it('weights give the focus half and split the rest evenly, summing to one', () => {
    for (const key of OBJECTIVES) {
      const weights = focusWeights(key)
      expect(weights[key]).toBe(0.5)
      expect(OBJECTIVES.reduce((sum, k) => sum + weights[k], 0)).toBeCloseTo(1, 12)
      for (const other of OBJECTIVES.filter((k) => k !== key)) expect(weights[other]).toBe(0.125)
    }
    expect(weightsFor('sustainability', meta)).toBe(meta.weights.sustainability_first)
    expect(weightsFor('profit', meta)).toBe(meta.weights.profit_first)
    expect(weightsFor('yield', meta).yield_t_ha).toBe(0.5)
    expect(weightsFor('steady', meta).cvar_net_mxn_ha).toBe(0.5)
  })

  it('every preset picks a strategy of the front, and the picks are not all the same', () => {
    for (const w of ['calibrated', 'default'] as const) {
      const limited = limitedFront(grids[w], meta.economics, meta.lattice, maximize)
      const picks = PRESETS.map((preset) => pickStrategy(preset, limited.front, meta, maximize, limited.cost))
      for (const pick of picks) expect(limited.front).toContain(pick)
      expect(new Set(picks).size).toBeGreaterThan(2)
    }
  })

  it('"costs" is the cheapest strategy that keeps COST_KEEP of the best net income', () => {
    for (const w of ['calibrated', 'default'] as const) {
      const { front, cost } = limitedFront(grids[w], meta.economics, meta.lattice, maximize)
      const pick = pickStrategy('costs', front, meta, maximize, cost)
      const best = Math.max(...front.map((s) => s.values.net_mxn_ha))
      const eligible = front.filter((s) => s.values.net_mxn_ha >= best - (1 - COST_KEEP) * best)
      expect(eligible).toContain(pick)
      for (const other of eligible) expect(cost(pick)).toBeLessThanOrEqual(cost(other) + 1e-9)
    }
  })
})

describe('rotationsFor', () => {
  it('lists every rotation that includes all the crops asked for, and all of them when asked to help', () => {
    expect(rotationsFor(null, meta)).toEqual(meta.rotation_order)
    expect(rotationsFor([], meta)).toEqual(meta.rotation_order)
    expect(rotationsFor(['maize'], meta)).toEqual(meta.rotation_order)
    expect(rotationsFor(['barley'], meta)).toEqual(['maize-barley', 'maize-barley-fababean'])
    expect(rotationsFor(['maize', 'fababean'], meta)).toEqual(['maize-fababean', 'maize-barley-fababean'])
    expect(rotationsFor(['barley', 'fababean'], meta)).toEqual(['maize-barley-fababean'])
  })
})

describe('capPerHa', () => {
  const budget = (b: Partial<Budget>): Budget => ({ currency: 'MXN', rate: null, low: 0, high: 30000, basis: 'total', ...b })

  it('splits a total by the area, keeps a per-hectare figure, converts dollars and has no cap for "more than"', () => {
    expect(capPerHa(budget({}), 2)).toBe(15000)
    expect(capPerHa(budget({ basis: 'perHa' }), null)).toBe(30000)
    expect(capPerHa(budget({ currency: 'USD', rate: ASSUMED_MXN_PER_USD, high: 1000 }), 1)).toBe(18000)
    expect(capPerHa(budget({ high: null }), 2)).toBeNull()
  })

  it('cannot split a total without an area, nor convert dollars without a rate', () => {
    expect(capPerHa(budget({}), null)).toBeNull()
    expect(capPerHa(budget({ currency: 'USD', rate: null }), 1)).toBeNull()
  })
})

describe('planting against the crop model sowing rule', () => {
  const { sowing } = meta
  const name = (d: { month: number; day: number }) => `${d.month + 1}/${d.day}`

  it('uses the earliest dates the model exports: maize may 15 - june 29, faba bean june 15 - july 30, barley july 1 - august 15', () => {
    const windows = Object.fromEntries(['maize', 'fababean', 'barley'].map((crop) => {
      const check = checkPlanting({ kind: 'month', month: 5, part: null }, [crop], sowing)!
      return [crop, `${name(check.from)}-${name(check.to)}`]
    }))
    expect(windows).toEqual({ maize: '5/15-6/29', fababean: '6/15-7/30', barley: '7/1-8/15' })
    expect(sowingWindow('oats', sowing)).toBeNull()
  })

  it('a third of a month is ten days and the last third runs to the end of the month', () => {
    expect(plantingDays({ kind: 'month', month: 5, part: 'early' })).toEqual([152, 161])
    expect(plantingDays({ kind: 'month', month: 5, part: 'late' })).toEqual([172, 181])
    expect(plantingDays({ kind: 'month', month: 0, part: null })).toEqual([1, 31])
  })

  it('says whether a time is inside, partly inside, before or after the window', () => {
    const fit = (month: number, part: 'early' | 'mid' | 'late' | null, crops = ['maize']) => checkPlanting({ kind: 'month', month, part }, crops, sowing)?.fit
    expect(fit(5, 'early')).toBe('inside') // early June
    expect(fit(4, null)).toBe('partly') // all of May: starts before May 15
    expect(fit(2, null)).toBe('before') // March
    expect(fit(6, 'late')).toBe('after') // late July is after maize's June 29
  })

  it('compares with the crop it fits best, in the order given when several fit', () => {
    const early = { kind: 'month' as const, month: 6, part: 'early' as const } // 1-10 July
    expect(checkPlanting(early, ['maize'], sowing)?.fit).toBe('after')
    expect(checkPlanting(early, ['maize', 'barley', 'fababean'], sowing)).toMatchObject({ crop: 'barley', fit: 'inside' })
    expect(checkPlanting(early, ['maize', 'fababean', 'barley'], sowing)).toMatchObject({ crop: 'fababean', fit: 'inside' })
  })

  it('prefers a window that holds the whole time over one that holds part of it, whatever the order', () => {
    const late = { kind: 'month' as const, month: 5, part: 'late' as const } // 21-30 June: maize's window ends June 29
    expect(checkPlanting(late, ['maize'], sowing)?.fit).toBe('partly')
    expect(checkPlanting(late, ['maize', 'fababean'], sowing)).toMatchObject({ crop: 'fababean', fit: 'inside' })
    expect(checkPlanting(late, ['fababean', 'maize'], sowing)).toMatchObject({ crop: 'fababean', fit: 'inside' })
  })
})

describe('budget bands', () => {
  it('niceRound says figures the way people do', () => {
    expect(niceRound(13889)).toBe(14000)
    expect(niceRound(950)).toBe(1000)
    expect(niceRound(7849)).toBe(7800)
  })

  it('come from the planner costs: 11,333 for three crops without fertilizer up to 19,000 for maize at the top dose', () => {
    const band = costBand(world, meta, meta.rotation_order)
    expect(band.min).toBeCloseTo((14000 + 9000 + 11000) / 3, 6)
    expect(band.max).toBeCloseTo(14000 + meta.economics.n_price * 200, 6) // 160 kg N x 1.25
    expect(budgetEdges(band)).toEqual([14000, 16000])
  })
})

describe('Planner.meanCost', () => {
  const planner = new Planner(world, meta.economics)

  it('is the other costs of the crops plus the nitrogen bought', () => {
    expect(planner.meanCost('maize', 0)).toBe(14000)
    expect(planner.meanCost('maize-barley', 0)).toBe((14000 + 9000) / 2)
    for (const [rotation, scale] of [['maize', 1], ['maize-fababean', 0.6], ['maize-barley-fababean', 1.25]] as const) {
      const annual = planner.annual(rotation, scale, 0.5)
      const doses = annual.dose_kg_ha.reduce((a, b) => a + b, 0) / annual.dose_kg_ha.length
      const others = meta.rotations[rotation].reduce((sum, crop) => sum + meta.economics.other_costs[crop], 0) / meta.rotations[rotation].length
      expect(planner.meanCost(rotation, scale)).toBeCloseTo(others + meta.economics.n_price * doses, 6)
    }
  })

  it('refuses an unknown rotation', () => {
    expect(() => planner.meanCost('oats', 0)).toThrow(/Unknown rotation/)
  })
})

describe('limitedFront', () => {
  const run = (limits = {}) => limitedFront(world, meta.economics, meta.lattice, maximize, limits)
  const dominates = (a: Strategy, b: Strategy) => {
    let strictly = false
    for (const key of OBJECTIVES) {
      const [x, y] = maximize[key] ? [a.values[key], b.values[key]] : [-a.values[key], -b.values[key]]
      if (x < y - 1e-9) return false
      if (x > y + 1e-9) strictly = true
    }
    return strictly
  }

  it('without limits is the exact front', () => {
    expect(run().front).toBe(exactFront(world, meta.economics, meta.lattice, maximize))
    expect(run({ rotations: meta.rotation_order, maxCostPerHa: null }).front).toBe(run().front)
    expect(run().cheapest).toBeCloseTo(34000 / 3, 6)
  })

  it('only holds the rotations asked for, and its front is built from them alone', () => {
    const limited = run({ rotations: ['maize-barley', 'maize-barley-fababean'] })
    expect(new Set(limited.front.map((s) => s.rotation))).toEqual(new Set(['maize-barley', 'maize-barley-fababean']))
    const all = new Planner(world, meta.economics).bruteForce(meta.lattice.n_scale_steps, meta.lattice.retention_steps)
    const pool = all.filter((s) => s.rotation !== 'maize' && s.rotation !== 'maize-fababean')
    // Nothing in the pool beats a member of the front, and every pool member off the front is beaten by one.
    for (const s of limited.front) expect(pool.some((o) => dominates(o, s))).toBe(false)
    const onFront = new Set(limited.front.map((s) => `${s.rotation}|${s.nScale}|${s.retention}`))
    const off = pool.filter((s) => !onFront.has(`${s.rotation}|${s.nScale}|${s.retention}`))
    expect(off.length).toBeGreaterThan(0)
    for (const s of off.slice(0, 200)) expect(limited.front.some((f) => dominates(f, s) || OBJECTIVES.every((k) => Math.abs(f.values[k] - s.values[k]) < 1e-6))).toBe(true)
  })

  it('keeps to a cost ceiling and takes the front of what is left, not the cheap part of the old front', () => {
    const limited = run({ maxCostPerHa: 12000 })
    expect(limited.feasible).toBe(true)
    for (const s of limited.front) expect(limited.cost(s)).toBeLessThanOrEqual(12000 + 1e-9)
    const unlimited = run()
    const cheapOnOldFront = unlimited.front.filter((s) => unlimited.cost(s) <= 12000)
    expect(limited.front.length).toBeGreaterThan(cheapOnOldFront.length) // strategies the full front had dropped come back
  })

  it('a ceiling above every cost changes nothing, and one below the cheapest plan falls back to the cheapest', () => {
    const generous = run({ maxCostPerHa: 100000 })
    expect(generous.feasible).toBe(true)
    expect(generous.front.length).toBe(run().front.length)
    const tight = run({ maxCostPerHa: 5000 })
    expect(tight.feasible).toBe(false)
    expect(tight.front.length).toBeGreaterThan(0)
    for (const s of tight.front) expect(tight.cost(s)).toBeCloseTo(tight.cheapest, 6)
  })

  it('is cached for the same limits', () => {
    expect(run({ maxCostPerHa: 13000 })).toBe(run({ maxCostPerHa: 13000 }))
    expect(run({ maxCostPerHa: 13000 })).not.toBe(run({ maxCostPerHa: 13500 }))
  })

  it('refuses rotations that are not in the grid', () => {
    expect(() => run({ rotations: ['oats'] })).toThrow(/None of the rotations/)
  })
})
