import type { Climate } from '../lib/climate.ts'
import type { Comparison, Verdict } from '../lib/coverage.ts'
import type { Budget, Crop, Planting, Preset, Priority, Water } from '../lib/farm.ts'
import type { CalibrationRow, RiskRow, ScenarioId, StatRow } from '../lib/precomputed.ts'
import type { Economics, ObjectiveKey, Values, WorldKey } from '../lib/types.ts'

export type { Preset } from '../lib/farm.ts'
export type { ScenarioId } from '../lib/precomputed.ts'

/** The models the assistant can consult, in the order they are listed and answered. */
export const MODEL_IDS = ['planner', 'climate', 'risk', 'calibration', 'statistical'] as const
export type ModelId = (typeof MODEL_IDS)[number]

/** The two ways of weighing objectives that every answer shows side by side. */
export type ClassicPreset = 'sustainability' | 'profit'
export type PriceItem = 'maize' | 'barley' | 'fababean' | 'nitrogen' | 'stover'

/**
 * What the farmer told the onboarding about their field, as the models take it. It rides on the interpretation, so
 * every answer records the inputs it used, and a backend that reads questions receives it with the question.
 */
export interface FarmInputs {
  /** Crops the farmer named; empty when they asked to be helped to choose. */
  wanted: Crop[]
  /** Crops they named that no model covers. */
  unmodelled: string[]
  /** Rotations the planner may choose from: those that include every crop named. */
  rotations: string[]
  areaHa: number | null
  budget: Budget | null
  planting: Planting | null
  water: Water | null
  priority: Priority | null
}

/** The structured inputs the planner needs; the assistant keeps them in a panel as well as reading them from text. */
export interface Settings {
  world: WorldKey
  preset: Preset
  economics: Economics
}

/** What the parser took from a question, shown back to the farmer so a wrong reading is easy to spot. */
export type Understood =
  | { kind: 'price'; item: PriceItem; value: number }
  | { kind: 'priceFactor'; item: PriceItem; factor: number }
  | { kind: 'world'; world: WorldKey }
  | { kind: 'preset'; preset: Preset }
  | { kind: 'scenario'; scenario: ScenarioId }

export type Intent = 'plan' | 'earn' | 'sustain' | 'risk' | 'climate' | 'trust' | 'statistical'

export interface Interpretation {
  /** `auto`: the models follow from the question; `manual`: the farmer picked them in the models panel. */
  mode: 'auto' | 'manual'
  intents: Intent[]
  models: ModelId[]
  /** Models added on top of what was asked, and why: the pin is in between (`zone`) or the farmer wants to save water (`water`). */
  added: { model: ModelId; reason: 'zone' | 'water' }[]
  understood: Understood[]
  scenarios: ScenarioId[]
  /** The settings this answer used: the current ones with whatever the question changed. */
  settings: Settings
  /** The farmer's answers to the onboarding, when they gave any. */
  farm?: FarmInputs
}

// ---- what each model returns ----

export interface StrategyView {
  rotation: string
  nScale: number
  retention: number
  /** kg N/ha of each crop of the rotation at this fertilizer scale. */
  doses: Record<string, number>
  values: Values
  /** Mean yearly cost per hectare (other costs plus fertilizer N), pesos. */
  cost: number
}

/** What the planner was held to by the farmer's answers. */
export interface PlannerLimits {
  /** Rotations it could choose from. */
  rotations: string[]
  /** The yearly cost per hectare the budget allows, if it gives one. */
  capPerHa: number | null
  /** False when no plan fits the budget: the picks are then the cheapest plans there are. */
  feasible: boolean
  /** The lowest yearly cost per hectare among those rotations. */
  cheapest: number
  /** The pick without the budget ceiling, when the ceiling changed it. */
  withoutBudget: StrategyView | null
}

export interface PlannerResult {
  world: WorldKey
  preset: Preset
  strategy: StrategyView
  /** The pick for each of the two classic ways of weighing the objectives, side by side. */
  picks: Record<ClassicPreset, StrategyView>
  /** Strategies on the trade-off curve, and how many were scored to find it. */
  frontSize: number
  scored: number
  /** Set when the farmer's answers narrowed the search. */
  limits: PlannerLimits | null
  ranges: Record<ObjectiveKey, [number, number]>
  economics: Economics
  economicsEdited: boolean
  /** The same pick at the original prices, when it differs from this one. */
  atOriginalPrices: StrategyView | null
  designYears: [number, number]
}

export interface ClimateResult {
  here: Climate
  reference: Climate
  comparison: Comparison
  distanceKm: number
  verdict: Verdict | null
}

export interface RiskResult {
  /** The scenarios asked for; `baseline` is always included as the reference. */
  scenarios: ScenarioId[]
  rows: RiskRow[]
  referenceRotation: string
  settings: { seed: number; draws: number; harvests: number; failureThresholdTHa: number }
  method: string
}

export interface CalibrationResult {
  rows: CalibrationRow[]
  fitYears: [number, number]
  holdoutYears: [number, number]
  /** Mean maize yield of continuous maize at the full dose in the design years, in each WOFOST parameter set. */
  maizeLevels: { standard: number; calibrated: number; observed: number }
  trial: { unfertilizedOverFertilized: number; tolerance: number }
  knobs: Record<string, Record<string, number>>
}

export interface StatisticalResult {
  observed: { rows: StatRow[]; holdoutYears: [number, number]; features: string[]; selectedByCv: string }
  emulation: { rows: StatRow[]; holdoutYears: [number, number]; selectedByCv: string }
  /** Best model on the holdout years, and the plain-mean baseline it has to beat. */
  best: { model: string; rmse: number }
  baseline: { model: string; rmse: number }
}

export interface ResultMap {
  planner: PlannerResult
  climate: ClimateResult
  risk: RiskResult
  calibration: CalibrationResult
  statistical: StatisticalResult
}

export type FailureCode = 'needs-pin' | 'offline' | 'failed'

export type Outcome = {
  [M in ModelId]: { model: M; ok: true; result: ResultMap[M] } | { model: M; ok: false; code: FailureCode; message: string }
}[ModelId]

export type Progress = 'waiting' | 'running' | 'done' | 'failed'
