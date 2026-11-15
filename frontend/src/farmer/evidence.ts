// What the model's own validation says, for the "how reliable is it" lines. These are numbers from the stored calibration
// results (the maize rows of the calibrated model against the yields SIAP reports for Texcoco), not claims written here.

import type { Precomputed } from '../lib/precomputed.ts'

export interface Evidence {
  /** Average maize yield per season in the years the model was fitted: what the model gave and what was reported. */
  level?: { sim: number; obs: number; years: [number, number] }
  /** The years held out, when the model did worse there than simply using the average of other years. */
  holdoutWorse?: [number, number]
}

export function evidenceFor(models: Precomputed): Evidence {
  const rows = models.calibration.rows.filter((row) => row.label === 'calibrated' && row.crop === 'maize')
  const fit = rows.find((row) => row.split === 'calibration')
  const holdout = rows.find((row) => row.split === 'holdout')
  return {
    level: fit ? { sim: fit.simulatedMean, obs: fit.observedMean, years: models.calibration.fitYears } : undefined,
    // `skill` is the error against the plain average of other years: below zero means worse than that average
    holdoutWorse: holdout && holdout.skill < 0 ? models.calibration.holdoutYears : undefined,
  }
}

export const yearsText = ([from, to]: [number, number]) => (from === to ? String(from) : `${from}–${to}`)
