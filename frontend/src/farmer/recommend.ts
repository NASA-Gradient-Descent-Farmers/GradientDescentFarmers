// The recommendation: the planner (and the stored rain-risk results) run on the farmer's answers, exactly as the
// assistant runs them. Nothing is estimated or written here beyond what the models return; what the answers cannot
// change (the crop of last season) is kept as context and said so.

import { newId } from '../assistant/history.ts'
import { runModel } from '../assistant/run.ts'
import type { FarmInputs, Interpretation, Outcome, PlannerResult, RiskResult, ScenarioId, Settings } from '../assistant/types.ts'
import { verdictKey, type Verdict } from '../lib/coverage.ts'
import { presetFor } from '../lib/farm.ts'
import type { LatLon } from '../lib/geo.ts'
import type { DashboardData, Meta } from '../lib/types.ts'
import { farmInputs, isComplete, PRIORITY_OF, type Previous, type Situation } from './state.ts'

/** The weather scenarios about short rain: what "if it rains little" is answered from. */
export const DRY_SCENARIOS: ScenarioId[] = ['rain80', 'canicula50']

export type ZoneStatus = 'inside' | 'near' | 'outside' | 'unknown'

/** Where the parcel sits against the one place the crop model was fitted to (see lib/coverage.ts). */
export interface Zone {
  status: ZoneStatus
  /** Which sentence applies, as in coverage.ts `verdictKey`; null while the climate comparison is pending. */
  key: string | null
  km: number
}

export const zoneOf = (verdict: Verdict | null, km: number): Zone =>
  verdict ? { status: verdict.status, key: verdictKey(verdict), km } : { status: 'unknown', key: null, km }

/**
 * How far to trust the numbers, from what the model has shown (the calibrated maize model follows the level of the
 * reported yields but not their year-to-year ups and downs, in the years held out). Even inside the zone it is "low":
 * the plan is for comparing options, not for promising a harvest. There is deliberately no higher step.
 */
export type Confidence = 'low' | 'veryLow' | 'none'
export const confidenceOf = ({ status }: Zone): Confidence => (status === 'inside' ? 'low' : status === 'outside' ? 'none' : 'veryLow')

export interface Recommendation {
  id: string
  at: number
  /** "Texcoco, Estado de México", or null for a point on the map. */
  place: string | null
  point: LatLon
  situation: Situation
  farm: FarmInputs
  result: PlannerResult
  /** Risk rows of the recommended rotation only (baseline and the dry scenarios); null if the stored results are missing. */
  risk: RiskResult | null
  zone: Zone
}

export class RecommendationError extends Error {}

export interface RecommendInput {
  data: DashboardData
  point: LatLon
  place: string | null
  situation: Situation
  zone: Zone
  now?: number
}

export async function recommend({ data, point, place, situation, zone, now = Date.now() }: RecommendInput): Promise<Recommendation> {
  if (!isComplete(situation) || !situation.goal) throw new RecommendationError('incomplete')
  const farm = farmInputs(situation, data.meta)
  const settings: Settings = { world: 'calibrated', preset: presetFor(PRIORITY_OF[situation.goal]), economics: data.meta.economics }
  const interpretation: Interpretation = {
    mode: 'auto', intents: ['plan'], models: ['planner', 'risk'], added: [], understood: [], scenarios: DRY_SCENARIOS, settings, farm,
  }
  const context = { data, pin: point, interpretation }
  const [planner, risk] = await Promise.all([runModel('planner', context), runModel('risk', context)])
  if (!planner.ok) throw new RecommendationError(planner.message)
  const result = (planner as Extract<Outcome, { model: 'planner'; ok: true }>).result
  const riskResult = risk.ok ? (risk as Extract<Outcome, { model: 'risk'; ok: true }>).result : null
  return {
    id: newId(),
    at: now,
    place,
    point,
    situation,
    farm,
    result,
    risk: riskResult && { ...riskResult, rows: riskResult.rows.filter((row) => row.rotation === result.strategy.rotation) },
    zone,
  }
}

/**
 * The crop that follows last season's in the recommended rotation, by the order of the rotation (maize, then barley,
 * then faba bean, then maize again). This is how a rotation works, not a model prediction. Null when last season's
 * crop is not in the rotation, or was not one of its crops.
 */
export function nextCrop(rotation: string, previous: Previous | undefined, meta: Meta): string | null {
  if (!previous || previous === 'other' || previous === 'none') return null
  const cycle = meta.rotations[rotation] ?? []
  const at = cycle.indexOf(previous)
  return at === -1 ? null : cycle[(at + 1) % cycle.length]
}

/** The two sums the card quotes: a figure per hectare and, with the area, for the whole parcel. Both are rounded to a figure a person would say. */
export const roundMoney = (value: number) => {
  const sign = value < 0 ? -1 : 1
  const v = Math.abs(value)
  return sign * (v >= 10000 ? Math.round(v / 1000) * 1000 : Math.round(v / 100) * 100)
}
