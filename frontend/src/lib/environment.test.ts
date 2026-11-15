// The environmental packages published for the three demonstration places: the file check, the summaries, and the figures
// they must agree with in Daniel's source profiles (rain, temperature, soil, run ids).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { climateYears, mean, meanTemperatureC, monthlySeries, parseEnvironment, passing, soilDepths, soilProperties, soilValue, stats } from './environment.ts'

const file = (id: string): Record<string, unknown> => JSON.parse(readFileSync(new URL(`../../public/data/environment/${id}.json`, import.meta.url), 'utf8'))
const places = { guanajuato: parseEnvironment(file('guanajuato')), sinaloa: parseEnvironment(file('sinaloa')), sonora: parseEnvironment(file('sonora')) }

describe('the published environmental packages', () => {
  it('are the runs Daniel\'s builder reported, at the exact demo coordinates', () => {
    expect(places.guanajuato).toMatchObject({ farmId: 'guanajuato_valle_demo', runId: '67b66942681a4214', latitude: 20.4243195, longitude: -101.1466639 })
    expect(places.sinaloa).toMatchObject({ farmId: 'mexico_norte_01', runId: 'b50bfdf0a58240aa', latitude: 25.763611, longitude: -108.861389 })
    expect(places.sonora).toMatchObject({ farmId: 'mexico_norte_02', runId: '9849d2f76f944625', latitude: 27.332202, longitude: -110.162783 })
  })

  it.each(Object.entries(places))('%s: two years of daily weather and every table present', (_id, e) => {
    expect(e.period).toEqual({ from: '2024-01-01', to: '2025-12-31' })
    expect(e.daily.days).toBe(731)
    expect(e.climate.monthly).toHaveLength(24)
    expect(e.climate.annual.map((row) => row.year)).toEqual([2024, 2025])
    expect(e.vegetation).toHaveLength(46)
    expect(e.evapotranspiration).toHaveLength(92)
    expect(e.surfaceTemperature).toHaveLength(92)
    expect(e.soil).toHaveLength(24)
    expect(e.sources.length).toBeGreaterThanOrEqual(15)
    expect(e.readiness).toHaveLength(12)
    expect(e.integrityOk).toBe(true)
  })

  it('Sonora: the annual rain and the figures in the profile', () => {
    const rain = places.sonora.climate.annual.map((row) => row.rainMm)
    expect(rain).toEqual([308, 414.2])
    expect(places.sonora.climate.annual[0]).toMatchObject({ longestDryRunDays: 80, heatDays: 158, frostDays: 0 })
    expect(places.sonora.terrain.elevationM).toBe(9)
    expect(soilValue(places.sonora, 'phh2o', '0-5cm')).toMatchObject({ value: 8, unit: 'pH' })
  })

  it('the daily series agree with the monthly table (rain by month adds up to the same total, within rounding)', () => {
    const e = places.sonora
    const dailyTotal = e.daily.rainMm.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    const monthlyTotal = e.climate.monthly.reduce((sum, row) => sum + (row.rainMm ?? 0), 0)
    expect(Math.abs(dailyTotal - monthlyTotal)).toBeLessThan(2)
  })

  it('every source has a status, and the missing ones are said to be missing, not filled in', () => {
    const status = Object.fromEntries(places.sonora.sources.map((source) => [source.key, source.status]))
    expect(status).toMatchObject({ nasa_power: 'available', soilgrids_wcs: 'available', modis_mod13q1: 'partial', validated_crop_parameters: 'missing', local_crop_prices: 'missing' })
    expect(places.sonora.readiness.find((gate) => gate.key === 'wofost_validated')?.ready).toBe(false)
    expect(places.sonora.missingInputs.cropParameters.length).toBeGreaterThan(0)
  })

  it('refuses a file that is not what the answers rely on, naming the part', () => {
    const base = file('sonora')
    expect(() => parseEnvironment(null)).toThrow(/not an object/)
    expect(() => parseEnvironment({ ...base, version: 3 })).toThrow(/unsupported version/)
    expect(() => parseEnvironment({ ...base, daily: { ...(base.daily as object), rainMm: [1, 2] } })).toThrow(/daily\.rainMm does not have 731/)
    expect(() => parseEnvironment({ ...base, climate: { monthly: [], annual: [] } })).toThrow(/climate is empty/)
    expect(() => parseEnvironment({ ...base, soil: undefined })).toThrow(/soil is not a list/)
  })
})

describe('the plain summaries', () => {
  const e = places.sonora
  it('years, monthly series (null where there is no value) and soil layout', () => {
    expect(climateYears(e)).toEqual([2024, 2025])
    expect(monthlySeries(e, 2024, 'rainMm')).toHaveLength(12)
    expect(monthlySeries(e, 1999, 'rainMm').every((value) => value === null)).toBe(true)
    expect(soilDepths(e)).toEqual(['0-5cm', '5-15cm', '15-30cm'])
    expect(soilProperties(e)).toContain('wv1500')
  })

  it('means and ranges ignore missing values and never turn them into zero', () => {
    expect(mean([1, null, 3])).toBe(2)
    expect(mean([null, undefined])).toBeNull()
    expect(stats([2, null, 4])).toEqual({ min: 2, max: 4, mean: 3, count: 2 })
    expect(stats([])).toBeNull()
    const t = meanTemperatureC(e)!
    expect(t).toBeGreaterThan(15)
    expect(t).toBeLessThan(30)
  })

  it('keeps only the observations that passed their quality check', () => {
    const ndvi = passing(e.vegetation)
    expect(ndvi.length).toBeLessThanOrEqual(e.vegetation.length)
    expect(ndvi.every((row) => row.qaPass)).toBe(true)
  })
})
