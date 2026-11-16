// "Where to sell": crops and prices read from the engine's evidence, the guarantee-price rules, and the eligibility check.
import { describe, expect, it } from 'vitest'
import type { DistrictRotation } from '../lib/district.ts'
import { cropPrices, needsSize, programOf, sellLines } from './market.ts'

const line = (crop: string, season: string, price?: number) => ({
  texto: `${crop} (${season}, temporal): en el distrito Los Mochis hay 23 años con registro y unas 3,787 ha sembradas por año. Produce 2.11 t por ha sembrada${price != null ? ` a $${price.toLocaleString('en-US')}/t (precio medio rural, últimos 5 años)` : ''}.`,
  fuente: 'SIAP',
  evidencia: 'alta',
})

const rotation = (...evidencia: ReturnType<typeof line>[]) => ({ tarjeta: { evidencia } }) as unknown as DistrictRotation

describe('where to sell', () => {
  it('reads each crop once, with its district price', () => {
    const r = rotation(line('Maíz', 'primavera-verano', 5320), line('Frijol', 'otoño-invierno', 21500), line('Calabaza (semilla)', 'primavera-verano', 30000), line('Maíz', 'otoño-invierno', 5100))
    expect(cropPrices(r)).toEqual([
      { crop: 'Maíz', price: 5320 },
      { crop: 'Frijol', price: 21500 },
      { crop: 'Calabaza (semilla)', price: 30000 },
    ])
  })

  it('reads English evidence too', () => {
    expect(cropPrices(rotation({ texto: 'Maize (spring-summer, rainfed): ... at $5,320/t (rural average price).', fuente: 'SIAP', evidencia: 'alta' }))).toEqual([{ crop: 'Maize', price: 5320 }])
  })

  it('knows which crops have a guarantee price', () => {
    expect(programOf('Maíz')).toBe('maiz')
    expect(programOf('Maize')).toBe('maiz')
    expect(programOf('Maíz forrajero')).toBeNull()
    expect(programOf('Frijol')).toBe('frijol')
    expect(programOf('Sorgo')).toBeNull()
  })

  it('maíz: up to 5 ha; frijol: up to 30 ha rainfed or 5 ha irrigated', () => {
    const r = rotation(line('Maíz', 'primavera-verano', 5320), line('Frijol', 'otoño-invierno', 21500), line('Sorgo', 'primavera-verano', 4508))
    const unknown = sellLines(r, 'temporal', 'Sinaloa', null)
    expect(unknown).toMatchObject([
      { kind: 'guarantee', program: 'maiz', price: 7000, maxT: 35, maxHa: 5, maxTHa: 7, eligible: null, districtPrice: 5320, pigmented: null },
      { kind: 'guarantee', program: 'frijol', price: 27000, maxT: 15, maxHa: 30, maxTHa: 0.5, eligible: null, districtPrice: 21500 },
      { kind: 'market', crops: [{ crop: 'Sorgo', price: 4508 }] },
    ])
    const mid = sellLines(r, 'temporal', 'Sinaloa', 'hasta30')
    expect(mid.map((l) => (l.kind === 'guarantee' ? l.eligible : 'market'))).toEqual([false, true, 'market'])
    const irrigated = sellLines(r, 'riego', 'Sinaloa', 'hasta30')
    expect(irrigated.map((l) => (l.kind === 'guarantee' ? l.eligible : 'market'))).toEqual([false, false, 'market'])
    expect(sellLines(r, 'riego', 'Sinaloa', 'hasta5').filter((l) => l.kind === 'guarantee').every((l) => l.kind === 'guarantee' && l.eligible)).toBe(true)
  })

  it('the pigmented-maíz price only where that pilot runs', () => {
    const r = rotation(line('Maíz', 'primavera-verano', 5320))
    expect(sellLines(r, 'temporal', 'Puebla', null)[0]).toMatchObject({ pigmented: 8000 })
    expect(sellLines(r, 'temporal', 'Jalisco', null)[0]).toMatchObject({ pigmented: null })
  })

  it('asks the farm size only when a guarantee crop is involved', () => {
    expect(needsSize([rotation(line('Sorgo', 'primavera-verano', 4508))], 'temporal', 'Sinaloa')).toBe(false)
    expect(needsSize([rotation(line('Sorgo', 'primavera-verano', 4508)), rotation(line('Frijol', 'otoño-invierno'))], 'temporal', 'Sinaloa')).toBe(true)
  })
})
