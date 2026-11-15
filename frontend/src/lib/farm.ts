// What a farmer says about their field, turned into the inputs the models take: crops -> candidate rotations,
// area -> hectares, budget -> a cap on the yearly cost per hectare, planting month -> a check against the crop
// model's rain-onset sowing rule, priority -> how the planner weighs its objectives.
// Nothing here guesses: an answer the models cannot use is kept and reported as such (see assistant/guidance.ts).

import { choose, type Maximize } from './front.ts'
import { Planner } from './planner.ts'
import type { GridWorld, Meta, ObjectiveKey, Sowing, Strategy, Values } from './types.ts'
import { OBJECTIVES } from './types.ts'

export const CROPS = ['maize', 'barley', 'fababean'] as const
export type Crop = (typeof CROPS)[number]
export const isCrop = (value: unknown): value is Crop => (CROPS as readonly unknown[]).includes(value)

// ---- land ----

export const AREA_UNITS = ['ha', 'ac', 'm2'] as const
export type AreaUnit = (typeof AREA_UNITS)[number]

export interface Land {
  amount: number
  unit: AreaUnit
}

/** An acre is exactly 4,046.8564224 m². */
const HA_PER_UNIT: Record<AreaUnit, number> = { ha: 1, ac: 0.40468564224, m2: 0.0001 }
export const toHectares = ({ amount, unit }: Land): number => amount * HA_PER_UNIT[unit]

// ---- planting ----

export type Part = 'early' | 'mid' | 'late'
export const PARTS: readonly Part[] = ['early', 'mid', 'late']

/** A planting time, as exact as the farmer can say it: a month (0 = January) and perhaps a third of it, or "when the rains start". */
export type Planting = { kind: 'month'; month: number; part: Part | null } | { kind: 'rains' }

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const dayOfYear = (month: number, day: number) => MONTH_DAYS.slice(0, month).reduce((sum, n) => sum + n, 0) + day

export interface CalendarDay {
  /** 0 = January. */
  month: number
  day: number
}

function calendarDay(day: number): CalendarDay {
  let month = 0
  let left = day
  while (month < 11 && left > MONTH_DAYS[month]) left -= MONTH_DAYS[month++]
  return { month, day: left }
}

/** First and last day of the year (1-365) a month or a third of it covers. */
export function plantingDays(planting: Extract<Planting, { kind: 'month' }>): [number, number] {
  const { month, part } = planting
  const length = MONTH_DAYS[month]
  const [from, to] = part === 'early' ? [1, 10] : part === 'mid' ? [11, 20] : part === 'late' ? [21, length] : [1, length]
  return [dayOfYear(month, from), dayOfYear(month, to)]
}

/** Days of the year the crop model may sow a crop on: from its earliest date until the forced sowing. */
export function sowingWindow(crop: string, sowing: Sowing): [number, number] | null {
  const earliest = sowing.earliest[crop]
  if (!earliest) return null
  const [month, day] = earliest.split('-').map(Number)
  const from = dayOfYear(month - 1, day)
  return [from, from + sowing.window_days]
}

/** The same window as calendar dates. */
export function sowingDates(crop: string, sowing: Sowing): { from: CalendarDay; to: CalendarDay } | null {
  const window = sowingWindow(crop, sowing)
  return window ? { from: calendarDay(window[0]), to: calendarDay(window[1]) } : null
}

export type Fit = 'inside' | 'partly' | 'before' | 'after'

export interface PlantingCheck {
  crop: string
  fit: Fit
  from: CalendarDay
  to: CalendarDay
}

/** How the planned time sits against the model's sowing window of the crop it fits best (smallest gap, then the order given). */
export function checkPlanting(planting: Extract<Planting, { kind: 'month' }>, crops: string[], sowing: Sowing): PlantingCheck | null {
  const [a, b] = plantingDays(planting)
  let best: { check: PlantingCheck; gap: number } | null = null
  for (const crop of crops) {
    const window = sowingWindow(crop, sowing)
    if (!window) continue
    const [from, to] = window
    const gap = b < from ? from - b : a > to ? a - to : 0
    const fit: Fit = gap > 0 ? (b < from ? 'before' : 'after') : a >= from && b <= to ? 'inside' : 'partly'
    // The smallest gap wins; among those that touch the date, one that holds all of it beats one that holds part.
    const better = !best || gap < best.gap || (gap === 0 && fit === 'inside' && best.check.fit === 'partly')
    if (better) best = { gap, check: { crop, fit, from: calendarDay(from), to: calendarDay(to) } }
  }
  return best?.check ?? null
}

// ---- water, priorities ----

export const WATER = ['rain', 'some', 'regular'] as const
export type Water = (typeof WATER)[number]

export const PRIORITIES = ['income', 'yield', 'costs', 'soil', 'steady', 'water'] as const
export type Priority = (typeof PRIORITIES)[number]

/** The ways the planner can weigh what matters. `costs` is a rule rather than a set of weights (see `pickCheapest`). */
export const PRESETS = ['sustainability', 'profit', 'yield', 'steady', 'costs'] as const
export type Preset = (typeof PRESETS)[number]
export const isPreset = (value: unknown): value is Preset => (PRESETS as readonly unknown[]).includes(value)

/** How a priority is carried out. "Saving water" is not something the planner measures: it is read as protecting
 *  income when rain is short, and the answer says so. */
const PRESET_OF: Record<Priority, Preset> = { income: 'profit', yield: 'yield', costs: 'costs', soil: 'sustainability', steady: 'steady', water: 'steady' }
export const presetFor = (priority: Priority): Preset => PRESET_OF[priority]

/** A priority that gets this share of the weight; the other four objectives split the rest equally. */
export const FOCUS_SHARE = 0.5

export function focusWeights(focus: ObjectiveKey): Values {
  const rest = (1 - FOCUS_SHARE) / (OBJECTIVES.length - 1)
  return Object.fromEntries(OBJECTIVES.map((key) => [key, key === focus ? FOCUS_SHARE : rest])) as Values
}

/** The cheapest strategy keeps at least this share of the best net income on the front. */
export const COST_KEEP = 0.9

/** Weights of a preset; `costs` has none (it picks by cost) and uses the profit weights for the strategies it compares. */
export function weightsFor(preset: Preset, meta: Meta): Values {
  switch (preset) {
    case 'sustainability':
      return meta.weights.sustainability_first
    case 'yield':
      return focusWeights('yield_t_ha')
    case 'steady':
      return focusWeights('cvar_net_mxn_ha')
    default:
      return meta.weights.profit_first
  }
}

/** The strategy a preset picks from a front: the weighted compromise, or for `costs` the cheapest one that keeps COST_KEEP of the best net income. */
export function pickStrategy(preset: Preset, front: Strategy[], meta: Meta, maximize: Maximize, cost: (strategy: Strategy) => number): Strategy {
  if (preset !== 'costs') return front[choose(front, weightsFor(preset, meta), maximize)]
  const best = Math.max(...front.map((s) => s.values.net_mxn_ha))
  const floor = best - (1 - COST_KEEP) * Math.abs(best)
  return front
    .filter((s) => s.values.net_mxn_ha >= floor)
    .reduce((a, b) => {
      const diff = cost(b) - cost(a)
      return diff < -1e-9 || (Math.abs(diff) <= 1e-9 && b.values.net_mxn_ha > a.values.net_mxn_ha) ? b : a
    })
}

// ---- crops, rotations ----

/** Rotations that include every crop the farmer named (all of them when they asked to be helped). */
export function rotationsFor(wanted: Crop[] | null, meta: Meta): string[] {
  if (!wanted || wanted.length === 0) return [...meta.rotation_order]
  return meta.rotation_order.filter((rotation) => wanted.every((crop) => meta.rotations[rotation].includes(crop)))
}

// ---- money ----

export const CURRENCIES = ['MXN', 'USD'] as const
export type Currency = (typeof CURRENCIES)[number]

/** Pesos per dollar offered as a starting point. It is an approximation, shown as one, and the farmer edits it. */
export const ASSUMED_MXN_PER_USD = 18

export interface Budget {
  currency: Currency
  /** Pesos per dollar, when the budget is in dollars. */
  rate: number | null
  /** The most the farmer would spend; a range is `low`..`high`, "more than X" has no `high`. */
  low: number
  high: number | null
  /** Whether the amounts are for the whole field or for each hectare. */
  basis: 'total' | 'perHa'
}

const toPesos = (budget: Budget, amount: number) => amount * (budget.currency === 'USD' ? (budget.rate ?? Number.NaN) : 1)

/** The most the budget allows per hectare in a year, in pesos; null when it has no ceiling or cannot be split by area. */
export function capPerHa(budget: Budget, areaHa: number | null): number | null {
  if (budget.high === null) return null
  const pesos = toPesos(budget, budget.high)
  if (!Number.isFinite(pesos)) return null
  if (budget.basis === 'perHa') return pesos
  return areaHa && areaHa > 0 ? pesos / areaHa : null
}

/** The mean yearly cost per hectare at the cheapest and the dearest ends of the planner's lattice, in the given rotations. */
export function costBand(world: GridWorld, meta: Meta, rotations: string[]): { min: number; max: number } {
  const planner = new Planner(world, meta.economics)
  const costs = rotations.flatMap((rotation) => [planner.meanCost(rotation, 0), planner.meanCost(rotation, planner.maxScale)])
  return { min: Math.min(...costs), max: Math.max(...costs) }
}

/** `value` rounded to a figure a person would say: thousands from 10,000 up, hundreds below. */
export const niceRound = (value: number) => (value >= 10000 ? Math.round(value / 1000) * 1000 : Math.round(value / 100) * 100)

/** Two budget edges that split the planner's cost band in thirds, per hectare and rounded. */
export function budgetEdges(band: { min: number; max: number }): [number, number] {
  const third = (band.max - band.min) / 3
  return [niceRound(band.min + third), niceRound(band.min + 2 * third)]
}
