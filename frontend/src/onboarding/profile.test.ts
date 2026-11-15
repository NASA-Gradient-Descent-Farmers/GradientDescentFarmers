import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { data } from '../assistant/testdata.ts'
import { farmInputs, isAnswered, isReady, loadProfile, parseProfile, presetOf, saveProfile, stepsToAsk, clearProfile } from './profile.ts'
import { sure, unsure, STEPS, type Profile } from './types.ts'

const pin = { lat: 19.53, lon: -98.85 }
const complete: Profile = {
  crops: { help: false, crops: ['maize', 'fababean'], unmodelled: ['trigo'] },
  land: sure({ amount: 2, unit: 'ha' }),
  when: sure({ kind: 'month', month: 5, part: 'early' }),
  budget: sure({ currency: 'USD', rate: 18, low: 1000, high: 1500, basis: 'total' }),
  water: sure('some'),
  priority: sure('water'),
  confirmed: true,
}

describe('which questions are still to ask', () => {
  it('asks everything, in order, of someone new', () => {
    expect(stepsToAsk({}, null)).toEqual([...STEPS])
  })

  it('leaves out what is known, including the map step when there is a pin', () => {
    expect(stepsToAsk({}, pin)).toEqual(['crops', 'land', 'when', 'budget', 'water', 'priority'])
    expect(stepsToAsk(complete, pin)).toEqual([])
    expect(stepsToAsk({ crops: complete.crops, land: unsure() }, null)).toEqual(['where', 'when', 'budget', 'water', 'priority'])
  })

  it('counts "not sure" as an answer, so it is not asked again', () => {
    expect(isAnswered({ budget: unsure() }, null, 'budget')).toBe(true)
    expect(isAnswered({}, null, 'budget')).toBe(false)
    expect(isAnswered({}, pin, 'where')).toBe(true)
  })

  it('is ready to start with a crop answer (or a request for help) and a pin', () => {
    expect(isReady({}, pin)).toBe(false)
    expect(isReady({ crops: { help: true, crops: [], unmodelled: [] } }, null)).toBe(false)
    expect(isReady({ crops: { help: true, crops: [], unmodelled: [] } }, pin)).toBe(true)
  })
})

describe('storage', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps every answer through a save and a load', () => {
    expect(saveProfile(complete)).toBe(true)
    expect(loadProfile()).toEqual(complete)
  })

  it('starts empty when nothing is stored, and after clearing', () => {
    expect(loadProfile()).toEqual({})
    saveProfile(complete)
    clearProfile()
    expect(loadProfile()).toEqual({})
  })

  it('drops what does not check out and keeps the rest', () => {
    const text = JSON.stringify({
      version: 1,
      profile: {
        crops: { help: false, crops: ['maize', 'oats'], unmodelled: [3, 'frijol'] },
        land: { unsure: false, value: { amount: -2, unit: 'ha' } }, // not an area
        when: { unsure: false, value: { kind: 'month', month: 12, part: null } }, // no such month
        budget: { unsure: false, value: { currency: 'USD', rate: null, low: 0, high: 5, basis: 'total' } }, // dollars without a rate
        water: { unsure: false, value: 'flood' },
        priority: { unsure: false, value: 'yield' },
      },
    })
    expect(parseProfile(text)).toEqual({ crops: { help: false, crops: ['maize'], unmodelled: ['frijol'] }, priority: sure('yield') })
  })

  it('refuses a crop answer that names nothing and does not ask for help', () => {
    expect(parseProfile(JSON.stringify({ version: 1, profile: { crops: { help: false, crops: [], unmodelled: ['trigo'] } } }))).toEqual({})
    expect(parseProfile(JSON.stringify({ version: 1, profile: { crops: { help: true, crops: ['maize'], unmodelled: [] } } }))).toEqual({
      crops: { help: true, crops: [], unmodelled: [] },
    })
  })

  it('gives an empty profile for text that is not one', () => {
    for (const text of [null, '', 'nope', '[]', '{"version":2,"profile":{}}', '{"version":1}']) expect(parseProfile(text)).toEqual({})
  })

  it('keeps working when storage is blocked', () => {
    const blocked = () => {
      throw new Error('blocked')
    }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    expect(saveProfile(complete)).toBe(false)
    expect(loadProfile()).toEqual({})
    expect(() => clearProfile()).not.toThrow()
  })
})

describe('farmInputs: the answers as the models take them', () => {
  const { meta } = data

  it('is null until something is answered', () => {
    expect(farmInputs({}, meta)).toBeNull()
    expect(farmInputs({ confirmed: true }, meta)).toBeNull()
  })

  it('maps every answer: crops to rotations, area to hectares, and the rest as they are', () => {
    expect(farmInputs(complete, meta)).toEqual({
      wanted: ['maize', 'fababean'],
      unmodelled: ['trigo'],
      rotations: ['maize-fababean', 'maize-barley-fababean'],
      areaHa: 2,
      budget: { currency: 'USD', rate: 18, low: 1000, high: 1500, basis: 'total' },
      planting: { kind: 'month', month: 5, part: 'early' },
      water: 'some',
      priority: 'water',
    })
  })

  it('compares every rotation when the farmer asks for help, and leaves "not sure" answers out', () => {
    const farm = farmInputs({ crops: { help: true, crops: [], unmodelled: [] }, land: unsure(), budget: unsure(), water: unsure(), priority: unsure(), when: unsure() }, meta)
    expect(farm).toEqual({
      wanted: [], unmodelled: [], rotations: meta.rotation_order, areaHa: null, budget: null, planting: null, water: null, priority: null,
    })
  })

  it('converts the area unit', () => {
    expect(farmInputs({ land: sure({ amount: 5000, unit: 'm2' }) }, meta)?.areaHa).toBeCloseTo(0.5, 12)
    expect(farmInputs({ land: sure({ amount: 10, unit: 'ac' }) }, meta)?.areaHa).toBeCloseTo(4.0468564224, 9)
  })

  it('turns the priority into a planner preset', () => {
    expect(presetOf({ priority: sure('income') })).toBe('profit')
    expect(presetOf({ priority: sure('soil') })).toBe('sustainability')
    expect(presetOf({ priority: sure('water') })).toBe('steady')
    expect(presetOf({ priority: unsure() })).toBeNull()
    expect(presetOf({})).toBeNull()
  })
})
