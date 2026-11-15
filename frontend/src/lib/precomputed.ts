// Results of models that are not re-run in the browser, as exported to models.json.

export type ScenarioId = 'baseline' | 'rain80' | 'rain60' | 'canicula50' | 'frost_minus2' | 'no_fertilizer' | 'fixed_sowing'

export interface SourceFile {
  file: string
  sha256: string
}

/** One rotation in one weather scenario: maize harvests against continuous maize (paired-year bootstrap + Monte Carlo). */
export interface RiskRow {
  scenario: string
  rotation: string
  meanYield: number
  advantage: number
  ciLow: number
  ciHigh: number
  fractionYearsBetter: number
  failedHarvestFraction: number
  probAnyFailedHarvest: number
  p05: number
  p95: number
}

export interface RiskResults {
  rows: RiskRow[]
  scenarios: string[]
  rotations: string[]
  crop: string
  referenceRotation: string
  settings: { seed: number; draws: number; harvests: number; spinupYears: number; failureThresholdTHa: number }
  method: string
  sources: SourceFile[]
}

export interface CalibrationRow {
  label: 'calibrated' | 'climatology' | 'persistence'
  split: 'calibration' | 'holdout'
  crop: string
  years: number
  simulatedMean: number
  observedMean: number
  ratio: number
  bias: number
  rmse: number
  /** null when the prediction is constant (the climatology baseline). */
  correlation: number | null
  skill: number
}

export interface CalibrationResults {
  rows: CalibrationRow[]
  fitYears: [number, number]
  holdoutYears: [number, number]
  knobs: Record<string, Record<string, number>>
  trial: { unfertilizedOverFertilized: number; tolerance: number }
  sources: SourceFile[]
}

export interface StatRow {
  model: string
  split: 'cv_pooled' | 'holdout'
  mae: number
  rmse: number
  r2: number
}

export interface StatisticalResults {
  emulation: { rows: StatRow[]; crop: string; features: string; holdoutYears: [number, number]; selectedByCv: string }
  observed: { rows: StatRow[]; features: string[]; holdoutYears: [number, number]; selectedByCv: string }
  sources: SourceFile[]
}

export interface Precomputed {
  risk: RiskResults
  calibration: CalibrationResults
  statistical: StatisticalResults
}

// ---- the file as written (columns + rows of arrays) ----

interface RawTable {
  columns: string[]
  rows: (string | number | null)[][]
}

function objects(table: RawTable): Record<string, string | number | null>[] {
  return table.rows.map((row) => Object.fromEntries(table.columns.map((name, i) => [name, row[i]])))
}

const num = (value: unknown, what: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`models.json: ${what} is not a number`)
  return value
}

/** First and last of the years given, whether the file lists a [start, end] pair or every year. */
const years = (value: unknown, what: string): [number, number] => {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`models.json: ${what} is not a list of years`)
  const all = value.map((v) => num(v, what))
  return [Math.min(...all), Math.max(...all)]
}

function statRows(rows: (string | number | null)[][], what: string): StatRow[] {
  return rows.map(([model, split, mae, rmse, r2]) => ({
    model: String(model),
    split: split as StatRow['split'],
    mae: num(mae, `${what} mae`),
    rmse: num(rmse, `${what} rmse`),
    r2: num(r2, `${what} r2`),
  }))
}

/** Turn models.json into typed objects, refusing a file that is missing a section or has non-numeric results. */
export function parsePrecomputed(file: unknown): Precomputed {
  const raw = file as {
    risk?: RawTable & Record<string, unknown>
    calibration?: RawTable & Record<string, unknown>
    statistical?: Record<string, unknown>
  }
  if (!raw?.risk || !raw.calibration || !raw.statistical) throw new Error('models.json is missing a section')

  const risk = raw.risk as unknown as RawTable & { scenarios: string[]; rotations: string[]; crop: string; reference_rotation: string; settings: Record<string, number>; method: string; sources: SourceFile[] }
  const calibration = raw.calibration as unknown as RawTable & { fit_years: unknown; holdout_years: unknown; knobs: Record<string, Record<string, number>>; trial: { unfertilized_over_fertilized: number; tolerance: number }; sources: SourceFile[] }
  const statistical = raw.statistical as unknown as { emulation: { rows: RawTable['rows']; crop: string; features: string; holdout_years: unknown; selected_by_cv: string }; observed: { rows: RawTable['rows']; features: string[]; holdout_years: unknown; selected_by_cv: string }; sources: SourceFile[] }

  return {
    risk: {
      rows: objects(risk).map((r) => ({
        scenario: String(r.scenario),
        rotation: String(r.rotation),
        meanYield: num(r.mean_yield_t_ha, 'mean yield'),
        advantage: num(r.mean_advantage_t_ha, 'advantage'),
        ciLow: num(r.advantage_ci_low_t_ha, 'ci low'),
        ciHigh: num(r.advantage_ci_high_t_ha, 'ci high'),
        fractionYearsBetter: num(r.fraction_years_better, 'fraction better'),
        failedHarvestFraction: num(r.failed_harvest_fraction, 'failed fraction'),
        probAnyFailedHarvest: num(r.prob_any_failed_harvest, 'prob failed'),
        p05: num(r.mean_yield_p05_t_ha, 'p05'),
        p95: num(r.mean_yield_p95_t_ha, 'p95'),
      })),
      scenarios: risk.scenarios,
      rotations: risk.rotations,
      crop: risk.crop,
      referenceRotation: risk.reference_rotation,
      settings: {
        seed: risk.settings.seed,
        draws: risk.settings.draws,
        harvests: risk.settings.harvests,
        spinupYears: risk.settings.spinup_years,
        failureThresholdTHa: risk.settings.failure_threshold_t_ha,
      },
      method: risk.method,
      sources: risk.sources,
    },
    calibration: {
      rows: objects(calibration).map((r) => ({
        label: r.label as CalibrationRow['label'],
        split: r.split as CalibrationRow['split'],
        crop: String(r.crop),
        years: num(r.years, 'years'),
        simulatedMean: num(r.simulated_mean_t_ha, 'simulated mean'),
        observedMean: num(r.observed_mean_t_ha, 'observed mean'),
        ratio: num(r.ratio, 'ratio'),
        bias: num(r.bias_t_ha, 'bias'),
        rmse: num(r.rmse_t_ha, 'rmse'),
        correlation: r.correlation === null ? null : num(r.correlation, 'correlation'),
        skill: num(r.skill, 'skill'),
      })),
      fitYears: years(calibration.fit_years, 'fit years'),
      holdoutYears: years(calibration.holdout_years, 'holdout years'),
      knobs: calibration.knobs,
      trial: {
        unfertilizedOverFertilized: num(calibration.trial.unfertilized_over_fertilized, 'trial ratio'),
        tolerance: num(calibration.trial.tolerance, 'trial tolerance'),
      },
      sources: calibration.sources,
    },
    statistical: {
      emulation: {
        rows: statRows(statistical.emulation.rows, 'emulation'),
        crop: statistical.emulation.crop,
        features: statistical.emulation.features,
        holdoutYears: years(statistical.emulation.holdout_years, 'emulation holdout'),
        selectedByCv: statistical.emulation.selected_by_cv,
      },
      observed: {
        rows: statRows(statistical.observed.rows, 'observed'),
        features: statistical.observed.features,
        holdoutYears: years(statistical.observed.holdout_years, 'observed holdout'),
        selectedByCv: statistical.observed.selected_by_cv,
      },
      sources: statistical.sources,
    },
  }
}
