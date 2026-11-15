import { describe, expect, it } from 'vitest'
import { data } from '../assistant/testdata.ts'
import { EMPTY, farmInputs, isComplete, missing, parcelAt, parseState, PRIORITY_OF, validHectares } from './state.ts'

describe('parseState', () => {
  it('keeps what checks out and drops the rest', () => {
    const text = JSON.stringify({
      parcel: { label: 'Texcoco, Estado de México', source: 'search', point: { lat: 19.49, lon: -98.87 } },
      situation: { previous: 'maize', hectares: 2.5, water: 'rain', goal: 'earn' },
    })
    const state = parseState(text)
    expect(state.parcel?.label).toBe('Texcoco, Estado de México')
    expect(state.situation).toEqual({ previous: 'maize', hectares: 2.5, water: 'rain', goal: 'earn' })

    const bad = parseState(JSON.stringify({ parcel: { source: 'gps', point: { lat: 400, lon: 0 } }, situation: { previous: 'wheat', hectares: -3, water: 'flood', goal: 'rich' } }))
    expect(bad).toEqual(EMPTY)
    expect(parseState('not json')).toEqual(EMPTY)
    expect(parseState(null)).toEqual(EMPTY)
  })

  it('accepts only a sensible number of hectares', () => {
    expect([0.5, 1, 250, 10000].every(validHectares)).toBe(true)
    expect([0, -1, NaN, Infinity, 10001, '2'].some(validHectares)).toBe(false)
  })
})

describe('the questions', () => {
  it('are asked in order and the situation is complete only when all four are answered', () => {
    expect(missing({})).toEqual(['previous', 'hectares', 'water', 'goal'])
    expect(missing({ previous: 'none', water: 'rain' })).toEqual(['hectares', 'goal'])
    expect(isComplete({ previous: 'none', hectares: 1, water: 'rain', goal: 'soil' })).toBe(true)
  })
})

describe('parcelAt', () => {
  const saved = { parcel: { label: 'Texcoco, Estado de México', source: 'search' as const, point: { lat: 19.4873, lon: -98.8676 } }, situation: {} }
  it('keeps the label only while the pin is where it was saved', () => {
    expect(parcelAt(saved, { lat: 19.4873, lon: -98.8676 })?.label).toBe('Texcoco, Estado de México')
    expect(parcelAt(saved, { lat: 20, lon: -99 })).toEqual({ label: null, source: 'map', point: { lat: 20, lon: -99 } })
    expect(parcelAt(saved, null)).toBeNull()
  })
})

describe('farmInputs', () => {
  it('maps the answers onto what the planner takes, and invents nothing', () => {
    const farm = farmInputs({ previous: 'barley', hectares: 3, water: 'some', goal: 'safe' }, data.meta)
    expect(farm).toMatchObject({ areaHa: 3, water: 'some', priority: 'steady', wanted: [], budget: null, planting: null })
    expect(farm.rotations).toEqual(data.meta.rotation_order)
    expect(PRIORITY_OF).toEqual({ earn: 'income', safe: 'steady', soil: 'soil' })
    expect(farmInputs({}, data.meta)).toMatchObject({ areaHa: null, water: null, priority: null })
  })
})
