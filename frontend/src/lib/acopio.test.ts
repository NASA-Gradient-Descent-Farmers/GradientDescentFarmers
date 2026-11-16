// The nearest official collection centre: same state only, the municipality point as the location, and the file written by
// scripts/acopio.mjs from real directory rows (fixtures/acopio_sample.*).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DICTIONARIES, translate } from '../i18n/translate.ts'
import { centresOf, loadCentres, nearestCentres, resetCentres, stateKey, type AcopioFile } from './acopio.ts'
import { makeFormat } from './format.ts'
import { nearestSentences } from './market.ts'

const file = JSON.parse(readFileSync(new URL('fixtures/acopio_sample.json', import.meta.url), 'utf8')) as AcopioFile
const centres = centresOf(file)
const t = (path: string, vars?: Record<string, string | number>) => translate(DICTIONARIES.es, path, vars)

describe('collection centres', () => {
  it('the script places every sample centre at its municipality, with the state from the centre code', () => {
    expect(centres).toHaveLength(6)
    expect(centres.every((c) => c.point)).toBe(true)
    expect(centres.find((c) => c.name === '08 CA EL CARMEN')).toMatchObject({ state: 'Jalisco', municipality: 'La Barca' })
  })

  it('one key per state however it is written', () => {
    expect(stateKey('Veracruz de Ignacio de la Llave')).toBe(stateKey('Veracruz'))
    expect(stateKey('Estado de México')).toBe(stateKey('México'))
    expect(stateKey('Michoacán')).toBe(stateKey('Michoacán de Ocampo'))
  })

  it('offers the closest centre in the same state only', () => {
    // Ocotlán, Jalisco: La Barca is next door; Jocotepec is farther
    const near = nearestCentres(centres, { lat: 20.35, lon: -102.77 }, 'Jalisco', 'Ocotlán', 2)
    expect(near.map((c) => c.municipality)).toEqual(['La Barca', 'Jocotepec'])
    expect(near[0]!.km).toBeLessThan(40)
    // a point in Nayarit next to Jalisco still gets the Nayarit centre, never one across the state line
    expect(nearestCentres(centres, { lat: 20.6, lon: -104.4 }, 'Nayarit').map((c) => c.state)).toEqual(['Nayarit'])
    expect(nearestCentres(centres, { lat: 21, lon: -101 }, 'Guanajuato')).toEqual([])
  })

  it('says it in words: name, place, rounded distance, and what the directory does not tell', () => {
    const near = nearestCentres(centres, { lat: 20.35, lon: -102.77 }, 'Jalisco', 'Ocotlán', 1)
    const [line, note] = nearestSentences(near, file.downloaded, t, makeFormat('es'))
    expect(line).toMatch(/Centro de acopio El Carmen \(El Carmen, La Barca\), a unos \d+ km en línea recta/)
    expect(note).toMatch(/no dice qué grano recibe/)
    const same = nearestCentres(centres, { lat: 20.35, lon: -102.77 }, 'Jalisco', 'La Barca', 1)
    expect(nearestSentences(same, null, t, makeFormat('es'))[0]).toMatch(/en tu municipio/)
  })

  it('without the directory file there is simply nothing to say', async () => {
    resetCentres()
    const missing = (async () => new Response('not found', { status: 404 })) as typeof fetch
    expect(await loadCentres('/', missing)).toBeNull()
    resetCentres()
    const present = (async () => new Response(JSON.stringify(file), { status: 200 })) as typeof fetch
    expect((await loadCentres('/', present))!.centres).toHaveLength(6)
    resetCentres()
  })
})
