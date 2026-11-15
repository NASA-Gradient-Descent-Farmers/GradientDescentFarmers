// The places a farmer can pick are Sonora, Sinaloa and Guanajuato. Texcoco (the old planner's site) is not part of picking a
// location: none of the text of that flow names it, in either language, and the nearest-place helper only knows the three.
import { describe, expect, it } from 'vitest'
import { DICTIONARIES } from '../i18n/translate.ts'
import { DEMO_LOCATIONS, nearestDemoLocation } from './demoLocations.ts'

/** Every string under a dotted path of a dictionary. */
function strings(node: unknown, path = ''): [string, string][] {
  if (typeof node === 'string') return [[path, node]]
  if (typeof node !== 'object' || node === null) return []
  return Object.entries(node).flatMap(([key, value]) => strings(value, path ? `${path}.${key}` : key))
}
const at = (dict: unknown, path: string): unknown => path.split('.').reduce<unknown>((node, key) => (typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[key] : undefined), dict)

// what a person reads while choosing and confirming where their parcel is, and the home page that leads there
const FLOW = ['where', 'near', 'landing', 'env', 'caveat', 'farmer.nav', 'farmer.home', 'farmer.parcel.place', 'farmer.plant', 'farmer.chat.outside', 'farmer.chat.unknown', 'app.tagline']

describe.each(['es', 'en'] as const)('the location flow in %s', (lang) => {
  it('never names Texcoco or El Batán', () => {
    const offenders = FLOW.flatMap((path) => strings(at(DICTIONARIES[lang], path), path)).filter(([, text]) => /Texcoco|El Bat[aá]n/i.test(text))
    expect(offenders).toEqual([])
  })

  it('names the three places the data covers where it says what exists', () => {
    const dict = DICTIONARIES[lang]
    for (const path of ['where.zonesHint', 'farmer.chat.outside']) {
      const text = at(dict, path) as string
      expect(text, path).toMatch(/Sonora/)
      expect(text, path).toMatch(/Sinaloa/)
      expect(text, path).toMatch(/Guanajuato/)
    }
  })
})

describe('the nearest predetermined place', () => {
  it('is each place at its own coordinates, 0 km away', () => {
    for (const place of DEMO_LOCATIONS) {
      const nearest = nearestDemoLocation({ lat: place.latitude, lon: place.longitude })
      expect(nearest.place.id).toBe(place.id)
      expect(nearest.km).toBeLessThan(0.01)
    }
  })

  it('for a pin in Texcoco is one of the three, never Texcoco, and far away', () => {
    const nearest = nearestDemoLocation({ lat: 19.5, lon: -98.85 })
    expect(['guanajuato', 'sinaloa', 'sonora']).toContain(nearest.place.id)
    expect(nearest.place.id).toBe('guanajuato')
    expect(nearest.km).toBeGreaterThan(200)
  })
})
