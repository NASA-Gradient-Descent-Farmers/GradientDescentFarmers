import { describe, expect, it } from 'vitest'
import { data } from '../assistant/testdata.ts'
import { evidenceFor, yearsText } from './evidence.ts'

describe('evidenceFor', () => {
  it('reads the maize rows of the calibrated model from the stored results', () => {
    const evidence = evidenceFor(data.models)
    const fit = data.models.calibration.rows.find((r) => r.label === 'calibrated' && r.crop === 'maize' && r.split === 'calibration')!
    expect(evidence.level).toEqual({ sim: fit.simulatedMean, obs: fit.observedMean, years: data.models.calibration.fitYears })
    expect(evidence.level!.sim).toBeGreaterThan(0)
    const holdout = data.models.calibration.rows.find((r) => r.label === 'calibrated' && r.crop === 'maize' && r.split === 'holdout')!
    // the sentence about the held-out years appears only if the stored skill really is negative
    expect(evidence.holdoutWorse !== undefined).toBe(holdout.skill < 0)
  })

  it('writes years as a range', () => {
    expect(yearsText([2006, 2021])).toBe('2006–2021')
    expect(yearsText([2022, 2022])).toBe('2022')
  })
})
