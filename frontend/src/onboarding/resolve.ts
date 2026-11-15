// What each question does with what was typed or picked when the farmer presses Continue: accept it, say what is
// wrong, or ask one focused follow-up. Kept apart from the screens so every path can be tested.

import { CROPS, type AreaUnit, type Budget, type Crop, type Currency, type Land, type Planting } from '../lib/farm.ts'
import { checkLand, readArea, readCrops, readMoney, readNumber, readWhen, type AreaProblem, type WhenProblem } from './read.ts'
import type { CropsAnswer } from './types.ts'

// ---- crops ----

export interface CropsDraft {
  picked: string[]
  /** "Help me choose": every rotation is compared. */
  help: boolean
  /** The free-text field: other crops, typed. */
  other: string
}

export type CropsOutcome =
  | { kind: 'done'; answer: CropsAnswer }
  | { kind: 'empty' }
  /** Typed crops no model covers: shown once, and Continue again accepts what is left. */
  | { kind: 'followUp'; crops: Crop[]; unmodelled: string[] }

export function resolveCrops(draft: CropsDraft, acknowledged: boolean): CropsOutcome {
  const typed = readCrops(draft.other)
  if (draft.help) return { kind: 'done', answer: { help: true, crops: [], unmodelled: typed.unmodelled } }
  const crops = CROPS.filter((crop) => draft.picked.includes(crop) || typed.crops.includes(crop))
  if (crops.length === 0 && typed.unmodelled.length === 0) return { kind: 'empty' }
  if (typed.unmodelled.length > 0 && (crops.length === 0 || !acknowledged)) return { kind: 'followUp', crops, unmodelled: typed.unmodelled }
  return { kind: 'done', answer: { help: false, crops, unmodelled: typed.unmodelled } }
}

// ---- land ----

export type LandOutcome =
  | { kind: 'done'; land: Land }
  /** The figure and the unit may not belong together: ask which was meant. */
  | { kind: 'ask'; land: Land }
  | { kind: 'problem'; problem: AreaProblem | 'tooSmall' | 'tooLarge' }

export function resolveLand(text: string, unit: AreaUnit): LandOutcome {
  const read = readArea(text, unit)
  if (!read.ok) return { kind: 'problem', problem: read.problem }
  const verdict = checkLand(read.land)
  if (verdict === 'tooSmall' || verdict === 'tooLarge') return { kind: 'problem', problem: verdict }
  return verdict === 'unit' ? { kind: 'ask', land: read.land } : { kind: 'done', land: read.land }
}

/** The same figure with the other plausible unit, offered when the first reading looks like a slip. */
export const otherUnit = (land: Land): Land => ({ amount: land.amount, unit: land.unit === 'ha' ? 'm2' : 'ha' })

// ---- planting time ----

export interface WhenDraft {
  pick: Planting | null
  text: string
}

export type WhenOutcome = { kind: 'done'; planting: Planting } | { kind: 'problem'; problem: WhenProblem; months: number[]; text: string }

/** Typed words win over a picked month (typing clears the pick, so they never disagree). */
export function resolveWhen(draft: WhenDraft): WhenOutcome {
  if (draft.text.trim() !== '') {
    const read = readWhen(draft.text)
    return read.ok ? { kind: 'done', planting: read.planting } : { kind: 'problem', problem: read.problem, months: read.months, text: draft.text.trim() }
  }
  return draft.pick ? { kind: 'done', planting: draft.pick } : { kind: 'problem', problem: 'empty', months: [], text: '' }
}

// ---- budget ----

export interface BudgetDraft {
  currency: Currency
  rate: string
  /** Index of the range picked, or none. */
  pick: number | null
  text: string
}

export interface BudgetContext {
  areaHa: number | null
  /** The ranges on offer, in the draft's currency. */
  ranges: { low: number; high: number | null }[]
  /** The cheapest yearly cost per hectare among the rotations in play, pesos. */
  cheapestPerHa: number
}

export type BudgetOutcome =
  | { kind: 'done'; budget: Budget }
  /** An amount that cannot pay for a hectare: for the whole land, or for each hectare? */
  | { kind: 'ask'; budget: Budget }
  | { kind: 'problem'; problem: 'empty' | 'unreadable' | 'notPositive' | 'rate' }

/** Below this share of the cheapest plan, per hectare, a typed total is more likely a per-hectare figure. */
export const IMPLAUSIBLE_SHARE = 0.25

export function resolveBudget(draft: BudgetDraft, { areaHa, ranges, cheapestPerHa }: BudgetContext): BudgetOutcome {
  const rate = draft.currency === 'USD' ? readNumber(draft.rate) : 1
  if (rate === null || rate <= 0) return { kind: 'problem', problem: 'rate' }
  // With no area the amounts are per hectare: a total could not be set against the planner's costs.
  const basis: Budget['basis'] = areaHa ? 'total' : 'perHa'
  const base = { currency: draft.currency, rate: draft.currency === 'USD' ? rate : null, basis } as const
  if (draft.text.trim() !== '') {
    const amount = readMoney(draft.text)
    if (amount === null) return { kind: 'problem', problem: 'unreadable' }
    if (amount <= 0) return { kind: 'problem', problem: 'notPositive' }
    const budget: Budget = { ...base, low: amount, high: amount }
    if (basis === 'total' && areaHa && (amount * rate) / areaHa < cheapestPerHa * IMPLAUSIBLE_SHARE) return { kind: 'ask', budget }
    return { kind: 'done', budget }
  }
  if (draft.pick === null || !ranges[draft.pick]) return { kind: 'problem', problem: 'empty' }
  const { low, high } = ranges[draft.pick]
  return { kind: 'done', budget: { ...base, low, high } }
}
