import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fold, indexPlaces, parsePlaces, placeLabel, searchPlaces } from './places.ts'

const file = JSON.parse(readFileSync(new URL('../../public/data/municipios.json', import.meta.url), 'utf8')) as unknown
const places = parsePlaces(file)
const index = indexPlaces(places)

describe('fold', () => {
  it('drops accents, case and punctuation', () => {
    expect(fold('  Texcóco, Edo. de México ')).toBe('texcoco edo de mexico')
    expect(fold('Peñón Blanco')).toBe('penon blanco')
  })
})

describe('the municipality file', () => {
  it('lists the whole country, with the state of Mexico under the name farmers use', () => {
    expect(places.length).toBeGreaterThan(2400)
    expect(new Set(places.map((p) => p.state)).size).toBe(32)
    expect(places.some((p) => p.state === 'México')).toBe(false)
    const texcoco = places.find((p) => p.municipality === 'Texcoco')!
    expect(placeLabel(texcoco)).toBe('Texcoco, Estado de México')
    expect(texcoco.point.lat).toBeCloseTo(19.49, 1)
    expect(texcoco.point.lon).toBeCloseTo(-98.87, 1)
  })

  it('skips rows that are not a place on Earth and refuses a file with none', () => {
    const parsed = parsePlaces({ places: [['A', 'Good', 19, -99], ['B', 'BadLat', 99, -99], ['C', 'Text', 'x', 1], ['D'], 7] })
    expect(parsed.map((p) => p.municipality)).toEqual(['Good'])
    expect(() => parsePlaces({ places: [] })).toThrow()
    expect(() => parsePlaces(null)).toThrow()
  })
})

describe('searchPlaces', () => {
  it('finds a municipality whatever the accents or case', () => {
    for (const query of ['texcoco', 'TEXCÓCO', 'texcoco mexico', 'estado de mexico texcoco']) {
      expect(placeLabel(searchPlaces(index, query)[0]), query).toBe('Texcoco, Estado de México')
    }
  })

  it('ranks the exact name before names that merely contain it', () => {
    const results = searchPlaces(index, 'cuautla', 10)
    expect(results[0].municipality.toLowerCase()).toBe('cuautla')
    expect(results.length).toBeGreaterThan(1)
  })

  it('tells places with the same name apart by their state', () => {
    const results = searchPlaces(index, 'benito juarez', 10).map(placeLabel)
    expect(results.length).toBeGreaterThan(1)
    expect(new Set(results).size).toBe(results.length)
  })

  it('returns nothing for a very short or unknown text, and never more than the limit', () => {
    expect(searchPlaces(index, 'a')).toEqual([])
    expect(searchPlaces(index, 'zzzzqq')).toEqual([])
    expect(searchPlaces(index, 'san', 4).length).toBe(4)
  })
})
