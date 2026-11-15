import { describe, expect, it } from 'vitest'
import { data } from '../assistant/testdata.ts'
import { confidenceOf, nextCrop, recommend, RecommendationError, roundMoney, zoneOf, type Zone } from './recommend.ts'
import type { Situation } from './state.ts'

const inside: Zone = { status: 'inside', key: 'inside', km: 10 }
const point = { lat: 19.55, lon: -98.9 }
const base: Situation = { previous: 'maize', hectares: 2, water: 'rain', goal: 'earn' }
const run = (situation: Situation = base, zone: Zone = inside) => recommend({ data, point, place: 'Texcoco, Estado de México', situation, zone, now: 1700000000000 })

describe('recommend', () => {
  it('runs the planner on the answers and returns its own numbers', async () => {
    const rec = await run()
    expect(data.meta.rotation_order).toContain(rec.result.strategy.rotation)
    expect(rec.farm.areaHa).toBe(2)
    expect(rec.result.preset).toBe('profit')
    expect(Number.isFinite(rec.result.strategy.values.net_mxn_ha)).toBe(true)
    expect(rec.result.picks.profit.rotation).toBeTruthy()
    expect(rec.place).toBe('Texcoco, Estado de México')
    expect(rec.at).toBe(1700000000000)
  })

  it('turns what matters most into the planner setting', async () => {
    expect((await run({ ...base, goal: 'water' })).result.preset).toBe('steady')
    expect((await run({ ...base, goal: 'soil' })).result.preset).toBe('sustainability')
  })

  it('keeps the risk rows of the recommended rotation only', async () => {
    const rec = await run()
    expect(rec.risk).not.toBeNull()
    expect(rec.risk!.rows.length).toBeGreaterThan(0)
    expect(rec.risk!.rows.every((row) => row.rotation === rec.result.strategy.rotation)).toBe(true)
  })

  it('is the same every time for the same answers', async () => {
    const a = await run()
    const b = await run()
    expect({ ...a, id: '' }).toEqual({ ...b, id: '' })
  })

  it('refuses to guess when an answer is missing', async () => {
    await expect(run({ previous: 'maize', hectares: 2 })).rejects.toBeInstanceOf(RecommendationError)
  })
})

describe('nextCrop', () => {
  it('follows the rotation order and says nothing when last season does not fit it', () => {
    expect(nextCrop('maize-fababean', 'maize', data.meta)).toBe('fababean')
    expect(nextCrop('maize-fababean', 'fababean', data.meta)).toBe('maize')
    expect(nextCrop('maize-barley-fababean', 'maize', data.meta)).toBe('barley')
    expect(nextCrop('maize', 'maize', data.meta)).toBe('maize')
    expect(nextCrop('maize', 'barley', data.meta)).toBeNull()
    expect(nextCrop('maize-barley', 'other', data.meta)).toBeNull()
    expect(nextCrop('maize-barley', 'none', data.meta)).toBeNull()
    expect(nextCrop('maize-barley', undefined, data.meta)).toBeNull()
  })
})

describe('confidence and rounding', () => {
  it('is never higher than low, and absent outside the zone', () => {
    expect(confidenceOf(inside)).toBe('low')
    expect(confidenceOf({ status: 'near', key: 'near', km: 30 })).toBe('veryLow')
    expect(confidenceOf({ status: 'unknown', key: null, km: 30 })).toBe('veryLow')
    expect(confidenceOf({ status: 'outside', key: 'outsideDistance', km: 300 })).toBe('none')
  })

  it('keeps a pending verdict as unknown', () => {
    expect(zoneOf(null, 12)).toEqual({ status: 'unknown', key: null, km: 12 })
    expect(zoneOf({ status: 'inside', reason: null }, 5)).toEqual({ status: 'inside', key: 'inside', km: 5 })
  })

  it('rounds money to a figure a person would say', () => {
    expect(roundMoney(12290)).toBe(12000)
    expect(roundMoney(5895)).toBe(5900)
    expect(roundMoney(-3249)).toBe(-3200)
  })
})
