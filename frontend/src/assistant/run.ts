// Runs the models a question needs. Nothing here is generated: each result is computed from the exported grid
// (planner), asked of NASA now (climate) or read from saved results (risk, calibration, statistical).

import { fetchClimate } from '../lib/climate.ts'
import { compareClimate, coverage } from '../lib/coverage.ts'
import { capPerHa, pickStrategy } from '../lib/farm.ts'
import { rangeOf } from '../lib/front.ts'
import { distanceKm, type LatLon } from '../lib/geo.ts'
import { Planner } from '../lib/planner.ts'
import { limitedFront, sameEconomics, type LimitedFront } from '../lib/scenario.ts'
import type { DashboardData, ObjectiveKey, Strategy } from '../lib/types.ts'
import { OBJECTIVES } from '../lib/types.ts'
import type {
  CalibrationResult,
  ClimateResult,
  FailureCode,
  Interpretation,
  ModelId,
  Outcome,
  PlannerResult,
  Preset,
  Progress,
  RiskResult,
  StatisticalResult,
  StrategyView,
} from './types.ts'

export interface RunContext {
  data: DashboardData
  pin: LatLon | null
  interpretation: Interpretation
}

/** A failure that the farmer can act on: no pin, no connection, or something else. */
export class ModelFailure extends Error {
  readonly code: FailureCode
  constructor(code: FailureCode, message: string) {
    super(message)
    this.code = code
  }
}

const view = (strategy: Strategy, data: DashboardData, cost: number): StrategyView => ({
  rotation: strategy.rotation,
  nScale: strategy.nScale,
  retention: strategy.retention,
  doses: Object.fromEntries(
    [...new Set(data.meta.rotations[strategy.rotation])].map((crop) => [crop, strategy.nScale * data.meta.crops[crop].n_kg_ha_at_scale_1]),
  ),
  values: strategy.values,
  cost,
})

function runPlanner({ data, interpretation }: RunContext): PlannerResult {
  const { settings, farm } = interpretation
  const { meta, maximize } = data
  const grid = data.grids[settings.world]
  // What the farmer's answers rule out: rotations without the crops they named, and plans dearer than their budget.
  const ceiling = farm?.budget ? capPerHa(farm.budget, farm.areaHa) : null
  const limits = { rotations: farm?.rotations, maxCostPerHa: ceiling }
  const limited = limitedFront(grid, settings.economics, meta.lattice, maximize, limits)
  const { front } = limited
  const pick = (preset: Preset, from: LimitedFront = limited) => pickStrategy(preset, from.front, meta, maximize, from.cost)
  const show = (strategy: Strategy, from: LimitedFront = limited) => view(strategy, data, from.cost(strategy))
  const rotationCount = farm?.rotations.length ?? grid.order.length
  const scored = rotationCount * (meta.lattice.n_scale_steps + 1) * (meta.lattice.retention_steps + 1)

  const edited = !sameEconomics(settings.economics, meta.economics)
  const chosen = pick(settings.preset)
  let atOriginalPrices: StrategyView | null = null
  if (edited) {
    const originalFront = limitedFront(grid, meta.economics, meta.lattice, maximize, limits)
    const original = pick(settings.preset, originalFront)
    const same = original.rotation === chosen.rotation && original.nScale === chosen.nScale && original.retention === chosen.retention
    if (!same) atOriginalPrices = show(original, originalFront)
  }
  // What the budget changed: the pick of the same rotations without a ceiling, when it is a different plan.
  let withoutBudget: StrategyView | null = null
  if (ceiling !== null) {
    const free = limitedFront(grid, settings.economics, meta.lattice, maximize, { rotations: farm?.rotations })
    const open = pick(settings.preset, free)
    if (open.rotation !== chosen.rotation || open.nScale !== chosen.nScale || open.retention !== chosen.retention) withoutBudget = show(open, free)
  }
  return {
    world: settings.world,
    preset: settings.preset,
    strategy: show(chosen),
    picks: { sustainability: show(pick('sustainability')), profit: show(pick('profit')) },
    frontSize: front.length,
    scored,
    limits: farm ? { rotations: farm.rotations, capPerHa: ceiling, feasible: limited.feasible, cheapest: limited.cheapest, withoutBudget } : null,
    ranges: Object.fromEntries(OBJECTIVES.map((key) => [key, rangeOf(front, key)])) as Record<ObjectiveKey, [number, number]>,
    economics: settings.economics,
    economicsEdited: edited,
    atOriginalPrices,
    designYears: meta.design_years,
  }
}

async function runClimate({ data, pin }: RunContext): Promise<ClimateResult> {
  if (!pin) throw new ModelFailure('needs-pin', 'no pin')
  const site = { lat: data.meta.site.latitude, lon: data.meta.site.longitude }
  try {
    const [here, reference] = await Promise.all([fetchClimate(pin), fetchClimate(site)])
    const comparison = compareClimate(here, reference)
    const km = distanceKm(pin, site)
    return { here, reference, comparison, distanceKm: km, verdict: coverage(km, comparison) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // fetch() rejects with a TypeError when there is no connection or the request is blocked.
    throw new ModelFailure(error instanceof TypeError ? 'offline' : 'failed', message)
  }
}

function runRisk({ data, interpretation }: RunContext): RiskResult {
  const { risk } = data.models
  const wanted = new Set(['baseline', ...interpretation.scenarios])
  const rows = risk.rows.filter((row) => wanted.has(row.scenario))
  return {
    scenarios: interpretation.scenarios,
    rows,
    referenceRotation: risk.referenceRotation,
    settings: {
      seed: risk.settings.seed,
      draws: risk.settings.draws,
      harvests: risk.settings.harvests,
      failureThresholdTHa: risk.settings.failureThresholdTHa,
    },
    method: risk.method,
  }
}

function runCalibration({ data }: RunContext): CalibrationResult {
  const { calibration } = data.models
  const level = (world: 'default' | 'calibrated') =>
    new Planner(data.grids[world], data.meta.economics).objectives('maize', 1, 0).yield_t_ha // continuous maize at the full dose
  const observed = calibration.rows.find((r) => r.label === 'climatology' && r.split === 'calibration' && r.crop === 'maize')
  if (!observed) throw new ModelFailure('failed', 'the calibration results have no SIAP maize mean')
  return {
    rows: calibration.rows,
    fitYears: calibration.fitYears,
    holdoutYears: calibration.holdoutYears,
    maizeLevels: { standard: level('default'), calibrated: level('calibrated'), observed: observed.observedMean },
    trial: calibration.trial,
    knobs: calibration.knobs,
  }
}

function runStatistical({ data }: RunContext): StatisticalResult {
  const { statistical } = data.models
  const holdout = statistical.observed.rows.filter((r) => r.split === 'holdout')
  const baseline = holdout.find((r) => r.model === 'mean')
  if (!baseline || holdout.length === 0) throw new ModelFailure('failed', 'the statistical results have no holdout scores')
  const best = holdout.reduce((a, b) => (b.rmse < a.rmse ? b : a))
  return {
    observed: { ...statistical.observed },
    emulation: { ...statistical.emulation },
    best: { model: best.model, rmse: best.rmse },
    baseline: { model: baseline.model, rmse: baseline.rmse },
  }
}

/** Run one model; a failure becomes an outcome the interface can show and retry, never an exception. */
export async function runModel(model: ModelId, context: RunContext): Promise<Outcome> {
  try {
    switch (model) {
      case 'planner':
        return { model, ok: true, result: runPlanner(context) }
      case 'climate':
        return { model, ok: true, result: await runClimate(context) }
      case 'risk':
        return { model, ok: true, result: runRisk(context) }
      case 'calibration':
        return { model, ok: true, result: runCalibration(context) }
      case 'statistical':
        return { model, ok: true, result: runStatistical(context) }
    }
  } catch (error) {
    const code = error instanceof ModelFailure ? error.code : 'failed'
    return { model, ok: false, code, message: error instanceof Error ? error.message : String(error) } as Outcome
  }
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * Run the models of an interpretation. `onProgress` reports each model as it really starts and finishes, so the
 * progress shown is the actual state (there is no streaming here to show instead). Models run side by side;
 * each yields to the page first so the progress can be painted before heavy work begins.
 */
export async function runModels(context: RunContext, onProgress: (model: ModelId, state: Progress) => void = () => {}): Promise<Outcome[]> {
  const { models } = context.interpretation
  models.forEach((model) => onProgress(model, 'waiting'))
  const outcomes = await Promise.all(
    models.map(async (model) => {
      await nextTask()
      onProgress(model, 'running')
      await nextTask()
      const outcome = await runModel(model, context)
      onProgress(model, outcome.ok ? 'done' : 'failed')
      return outcome
    }),
  )
  return outcomes
}
