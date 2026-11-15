import { afterEach, describe, expect, it, vi } from 'vitest'
import { interpret } from './interpret.ts'
import { runModel, runModels, type RunContext } from './run.ts'
import { data, defaults, powerAnswer, site } from './testdata.ts'
import type { ModelId, Progress } from './types.ts'

const context = (question: string, pin: RunContext['pin'] = null, manual?: ModelId[]): RunContext => ({
  data,
  pin,
  interpretation: interpret(question, defaults, { manual }),
})

describe('planner', () => {
  it('suggests what the NSGA results write-up reports for the calibrated model at the original prices', async () => {
    const outcome = await runModel('planner', context('¿Qué sembrar y cuánto abonar?'))
    if (!outcome.ok || outcome.model !== 'planner') throw new Error('planner failed')
    const { result } = outcome
    expect(result.strategy.rotation).toBe('maize-fababean')
    expect(result.strategy.retention).toBeCloseTo(0.9, 6)
    expect(result.strategy.nScale).toBe(0)
    expect(Math.round(result.strategy.values.net_mxn_ha)).toBe(11457)
    expect(result.scored).toBe(4284)
    expect(result.frontSize).toBe(483)
    expect(result.economicsEdited).toBe(false)
    expect(result.atOriginalPrices).toBeNull()
    expect(result.picks.profit.rotation).toBe('maize') // the profit-first pick in the same document
  })

  it('re-prices from the question and says what the original prices would have suggested', async () => {
    const outcome = await runModel('planner', context('¿Qué pasa si el haba baja a un cuarto de precio?'))
    if (!outcome.ok || outcome.model !== 'planner') throw new Error('planner failed')
    const { result } = outcome
    expect(result.economicsEdited).toBe(true)
    expect(result.economics.prices.fababean).toBeCloseTo(data.meta.economics.prices.fababean / 4, 6)
    expect(result.strategy.rotation).toBe('maize') // NSGA results write-up: faba bean at 0.25x flips the pick to maize
    expect(result.strategy.retention).toBeCloseTo(0.55, 6)
    expect(result.atOriginalPrices?.rotation).toBe('maize-fababean')
  })

  it('uses the crop model and priority asked for', async () => {
    const outcome = await runModel('planner', context('¿Cuánto voy a ganar con el modelo estándar?'))
    if (!outcome.ok || outcome.model !== 'planner') throw new Error('planner failed')
    expect(outcome.result.world).toBe('default')
    expect(outcome.result.preset).toBe('profit')
    expect(outcome.result.strategy.rotation).toBe('maize-fababean')
    expect(outcome.result.strategy.nScale).toBeCloseTo(0.975, 6) // the default-world profit-first pick
    expect(outcome.result.strategy.doses.maize).toBeCloseTo(0.975 * 160, 6)
  })
})

describe('climate', () => {
  afterEach(() => vi.unstubAllGlobals())
  const answer = (rain: number) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(powerAnswer(() => rain, () => 15, (i) => 5 - i)) })

  it('compares the pin with the modeled site and gives the verdict', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => answer(url.includes('latitude=25.7') ? 1 : 2)))
    const pin = { lat: 25.7, lon: -100.3 }
    const outcome = await runModel('climate', context('¿Cómo es mi clima?', pin))
    if (!outcome.ok || outcome.model !== 'climate') throw new Error('climate failed')
    expect(outcome.result.comparison.rainDiffShare).toBeCloseTo(-0.5, 6)
    expect(outcome.result.distanceKm).toBeGreaterThan(600)
    expect(outcome.result.verdict).toEqual({ status: 'outside', reason: 'distance' })
  })

  it('fails with "needs-pin" without a pin, and says so without calling NASA', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const outcome = await runModel('climate', context('¿Cómo es mi clima?', null))
    expect(outcome).toMatchObject({ model: 'climate', ok: false, code: 'needs-pin' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('tells "no connection" from "NASA did not answer"', async () => {
    const pin = { lat: 28.1, lon: -101.1 } // not asked yet, so nothing is cached
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    expect(await runModel('climate', context('clima', pin))).toMatchObject({ ok: false, code: 'offline' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) }))
    expect(await runModel('climate', context('clima', pin))).toMatchObject({ ok: false, code: 'failed' })
  })

  it('is inside the zone at the modeled site itself', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => answer(2)))
    const outcome = await runModel('climate', context('clima', site))
    expect(outcome.ok && outcome.model === 'climate' && outcome.result.verdict).toEqual({ status: 'inside', reason: null })
  })
})

describe('stored models', () => {
  it('risk keeps the asked scenarios plus the baseline, for every rotation', async () => {
    const outcome = await runModel('risk', context('¿Y si hay helada?'))
    if (!outcome.ok || outcome.model !== 'risk') throw new Error('risk failed')
    expect([...new Set(outcome.result.rows.map((r) => r.scenario))].sort()).toEqual(['baseline', 'frost_minus2'])
    expect(outcome.result.rows).toHaveLength(8)
    expect(outcome.result.settings.draws).toBe(5000)
  })

  it('calibration contrasts the standard and calibrated yield levels with what SIAP reports', async () => {
    const outcome = await runModel('calibration', context('¿Qué tan cierto es el modelo?'))
    if (!outcome.ok || outcome.model !== 'calibration') throw new Error('calibration failed')
    const { maizeLevels } = outcome.result
    // CALIBRATION_RESULTS.md, maize 2006-2021: default 6.47, calibrated 2.31, SIAP 2.56 (continuous maize at the full dose)
    expect(maizeLevels.standard).toBeCloseTo(6.47, 1)
    expect(maizeLevels.calibrated).toBeCloseTo(2.31, 1)
    expect(maizeLevels.observed).toBeCloseTo(2.56, 1)
  })

  it('statistical finds the best holdout model and the plain mean it has to beat', async () => {
    const outcome = await runModel('statistical', context('¿Sirven los árboles?'))
    if (!outcome.ok || outcome.model !== 'statistical') throw new Error('statistical failed')
    expect(outcome.result.baseline).toEqual({ model: 'mean', rmse: expect.closeTo(0.731, 2) })
    expect(outcome.result.best.model).toBe('ensemble_ridge') // lowest holdout RMSE (0.719) among the models
    expect(outcome.result.best.rmse).toBeLessThan(outcome.result.baseline.rmse)
  })
})

describe('runModels', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reports each model as waiting, running and done, in that order, and returns outcomes in the models order', async () => {
    const log: [ModelId, Progress][] = []
    const outcomes = await runModels(context('¿Qué sembrar y qué pasa si llueve poco?'), (m, state) => log.push([m, state]))
    expect(outcomes.map((o) => o.model)).toEqual(['planner', 'risk'])
    for (const model of ['planner', 'risk'] as const) {
      expect(log.filter(([m]) => m === model).map(([, state]) => state)).toEqual(['waiting', 'running', 'done'])
    }
  })

  it('keeps the other models\' results when one fails, and marks the failed one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const log: [ModelId, Progress][] = []
    const outcomes = await runModels(context('¿Qué sembrar y cómo es mi clima?', { lat: 29.3, lon: -102.2 }), (m, s) => log.push([m, s]))
    expect(outcomes.find((o) => o.model === 'planner')?.ok).toBe(true)
    expect(outcomes.find((o) => o.model === 'climate')).toMatchObject({ ok: false, code: 'offline' })
    expect(log.filter(([m, s]) => m === 'climate' && s === 'failed')).toHaveLength(1)
  })
})
