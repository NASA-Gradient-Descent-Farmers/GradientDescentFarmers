import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parsePrecomputed } from './precomputed.ts'

const file = JSON.parse(readFileSync(new URL('../../public/data/models.json', import.meta.url), 'utf8')) as Record<string, unknown>
const models = parsePrecomputed(file)

describe('parsePrecomputed (the exported models.json)', () => {
  it('has every scenario for every rotation of the risk model', () => {
    expect(models.risk.scenarios).toHaveLength(7)
    expect(models.risk.rotations).toHaveLength(4)
    expect(models.risk.rows).toHaveLength(28)
    const reference = models.risk.rows.find((r) => r.scenario === 'baseline' && r.rotation === 'maize')!
    expect(reference).toMatchObject({ advantage: 0, ciLow: 0, ciHigh: 0 }) // the reference against itself
  })

  it('keeps the risk figures reported in the exploration notes', () => {
    const row = models.risk.rows.find((r) => r.scenario === 'baseline' && r.rotation === 'maize-fababean')!
    expect(row.meanYield).toBeCloseTo(6.91, 2)
    expect(row.advantage).toBeCloseTo(0.63, 2)
    expect(row.ciLow).toBeLessThan(0) // the interval includes zero: the benefit is not clear-cut
    expect(row.ciHigh).toBeGreaterThan(0)
    const drought = models.risk.rows.find((r) => r.scenario === 'rain60' && r.rotation === 'maize')!
    expect(drought.failedHarvestFraction).toBeCloseTo(0.496, 2)
  })

  it('keeps the calibration check against SIAP, including the baselines', () => {
    const maize = models.calibration.rows.filter((r) => r.crop === 'maize' && r.split === 'holdout')
    expect(maize.map((r) => r.label).sort()).toEqual(['calibrated', 'climatology', 'persistence'])
    const calibrated = maize.find((r) => r.label === 'calibrated')!
    expect(calibrated.ratio).toBeCloseTo(0.787, 2)
    expect(calibrated.correlation).toBeCloseTo(-0.174, 2)
    expect(maize.find((r) => r.label === 'climatology')!.correlation).toBeNull() // a constant has no correlation
    expect(models.calibration.trial.unfertilizedOverFertilized).toBeCloseTo(0.93, 2)
  })

  it('keeps the tree and ensemble scores, where the plain mean is the one to beat', () => {
    const observed = models.statistical.observed.rows.filter((r) => r.split === 'holdout')
    const mean = observed.find((r) => r.model === 'mean')!
    expect(mean.rmse).toBeCloseTo(0.731, 2)
    expect(observed.some((r) => r.model === 'xgboost')).toBe(true)
    expect(models.statistical.emulation.rows.some((r) => r.model === 'decision_tree')).toBe(true)
  })

  it('reads the holdout years of every section as a first-to-last span', () => {
    expect(models.calibration.fitYears).toEqual([2006, 2021])
    expect(models.calibration.holdoutYears).toEqual([2022, 2025])
    expect(models.statistical.emulation.holdoutYears).toEqual([2022, 2025]) // exported as the list 2022..2025
    expect(models.statistical.observed.holdoutYears).toEqual([2022, 2025])
  })

  it('lists the source files with their hashes', () => {
    for (const section of [models.risk, models.calibration, models.statistical]) {
      expect(section.sources.length).toBeGreaterThan(0)
      for (const source of section.sources) expect(source.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('refuses a file with a missing section or a non-numeric result', () => {
    expect(() => parsePrecomputed({ risk: file.risk })).toThrow(/missing a section/)
    expect(() => parsePrecomputed(null)).toThrow(/missing a section/)
    const broken = JSON.parse(JSON.stringify(file)) as { risk: { rows: unknown[][] } }
    broken.risk.rows[0][2] = 'oops'
    expect(() => parsePrecomputed(broken)).toThrow(/not a number/)
  })
})
