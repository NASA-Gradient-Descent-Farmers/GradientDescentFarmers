import { describe, expect, it } from 'vitest'
import { data } from '../assistant/testdata.ts'
import { recommend, type Recommendation } from './recommend.ts'
import { isRecommendation, MAX_SAVED, parseSaved, withoutSaved, withSaved } from './saved.ts'

const make = (n: number): Promise<Recommendation> =>
  recommend({ data, point: { lat: 19.5, lon: -98.9 }, place: null, situation: { previous: 'none', hectares: 1, water: 'rain', goal: 'earn' }, zone: { status: 'inside', key: 'inside', km: 8 }, now: n })

describe('saved recommendations', () => {
  it('round-trip through stored text and drop entries that cannot be drawn', async () => {
    const rec = await make(1)
    expect(isRecommendation(rec)).toBe(true)
    const text = JSON.stringify([rec, { id: 'x' }, 7, null, { ...rec, result: {} }])
    expect(parseSaved(text).map((r) => r.id)).toEqual([rec.id])
    expect(parseSaved('{oops')).toEqual([])
    expect(parseSaved(null)).toEqual([])
  })

  it('puts the newest first, replaces the same one and keeps only the newest few', async () => {
    let list: Recommendation[] = []
    const first = await make(1)
    for (let i = 0; i < MAX_SAVED + 5; i++) list = withSaved(list, { ...first, id: `r${i}`, at: i })
    expect(list.length).toBe(MAX_SAVED)
    expect(list[0].id).toBe(`r${MAX_SAVED + 4}`)
    const again = withSaved(list, { ...list[3], at: 999 })
    expect(again.length).toBe(MAX_SAVED)
    expect(again[0].at).toBe(999)
    expect(withoutSaved(again, again[0].id).length).toBe(MAX_SAVED - 1)
  })
})
