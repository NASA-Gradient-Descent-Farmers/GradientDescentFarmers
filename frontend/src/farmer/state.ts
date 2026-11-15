// What the farmer has told us, kept only on this phone: where the parcel is (its label; the point itself is the pin the
// whole app shares) and four short answers about their situation. Each answer maps onto an input the planner already
// takes (area, water, priority); the crop of last season is context, not a model input (see recommend.ts).

import type { FarmInputs } from '../assistant/types.ts'
import { WATER, type Priority, type Water } from '../lib/farm.ts'
import type { LatLon } from '../lib/geo.ts'
import type { Meta } from '../lib/types.ts'
import { scopedKey } from '../account/storage.ts'

const STORAGE_KEY = 'yolia-farmer'

export const PREVIOUS = ['maize', 'barley', 'fababean', 'other', 'none'] as const
export type Previous = (typeof PREVIOUS)[number]

export const GOALS = ['earn', 'safe', 'soil'] as const
export type Goal = (typeof GOALS)[number]

/** The questions, in the order they are asked. */
export const FIELDS = ['previous', 'hectares', 'water', 'goal'] as const
export type Field = (typeof FIELDS)[number]

export interface Situation {
  previous?: Previous
  hectares?: number
  water?: Water
  goal?: Goal
}

export type ParcelSource = 'search' | 'map' | 'gps'

export interface Parcel {
  /** "Texcoco, Estado de México" when picked by name; null for a point on the map or the phone's position. */
  label: string | null
  source: ParcelSource
  point: LatLon
}

export interface FarmerState {
  parcel: Parcel | null
  situation: Situation
}

export const EMPTY: FarmerState = { parcel: null, situation: {} }

/** Most hectares accepted: a small-scale producer's field, with room to spare, and a guard against a slipped key. */
export const MAX_HECTARES = 10000

const isOne = <T extends string>(list: readonly T[], value: unknown): value is T => (list as readonly unknown[]).includes(value)

export const validHectares = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_HECTARES

const validPoint = (value: unknown): value is LatLon => {
  const point = value as Partial<LatLon> | null
  return (
    !!point && typeof point.lat === 'number' && typeof point.lon === 'number' && Number.isFinite(point.lat) && Number.isFinite(point.lon) &&
    Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180
  )
}

/** The saved state from stored text: anything that does not check out is dropped, never trusted. */
export function parseState(text: string | null): FarmerState {
  if (!text) return EMPTY
  try {
    const raw = JSON.parse(text) as { parcel?: Partial<Parcel> | null; situation?: Record<string, unknown> }
    const situation: Situation = {}
    const s = raw.situation ?? {}
    if (isOne(PREVIOUS, s.previous)) situation.previous = s.previous
    if (validHectares(s.hectares)) situation.hectares = s.hectares
    if (isOne(WATER, s.water)) situation.water = s.water
    if (isOne(GOALS, s.goal)) situation.goal = s.goal
    const p = raw.parcel
    const parcel: Parcel | null =
      p && validPoint(p.point) && isOne(['search', 'map', 'gps'] as const, p.source)
        ? { label: typeof p.label === 'string' ? p.label : null, source: p.source, point: { lat: p.point.lat, lon: p.point.lon } }
        : null
    return { parcel, situation }
  } catch {
    return EMPTY
  }
}

export function loadState(): FarmerState {
  try {
    return parseState(localStorage.getItem(scopedKey(STORAGE_KEY)))
  } catch {
    return EMPTY
  }
}

export function saveState(state: FarmerState): void {
  try {
    localStorage.setItem(scopedKey(STORAGE_KEY), JSON.stringify(state))
  } catch {
    // storage blocked or full: the answers last for this visit only
  }
}

/** The questions still unanswered, in order. */
export const missing = (situation: Situation): Field[] => FIELDS.filter((field) => situation[field] === undefined)

export const isComplete = (situation: Situation) => missing(situation).length === 0

/** The saved label belongs to the saved point only: if the pin moved elsewhere (in Technical mode, say), it no longer applies. */
export function parcelAt(state: FarmerState, pin: LatLon | null): Parcel | null {
  if (!pin) return null
  const saved = state.parcel
  if (saved && Math.abs(saved.point.lat - pin.lat) < 1e-4 && Math.abs(saved.point.lon - pin.lon) < 1e-4) return saved
  return { label: null, source: 'map', point: pin }
}

export const PRIORITY_OF: Record<Goal, Priority> = { earn: 'income', safe: 'steady', soil: 'soil' }

/** The inputs the planner takes from the answers. Nothing is asked about crops or budget: the planner compares every rotation. */
export function farmInputs(situation: Situation, meta: Meta): FarmInputs {
  return {
    wanted: [],
    unmodelled: [],
    rotations: [...meta.rotation_order],
    areaHa: situation.hectares ?? null,
    budget: null,
    planting: null,
    water: situation.water ?? null,
    priority: situation.goal ? PRIORITY_OF[situation.goal] : null,
  }
}
