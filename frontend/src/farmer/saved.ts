// "Mis recomendaciones": the recommendations the farmer chose to keep, on this phone only. What is stored is what the
// models returned that day, so reopening one shows the same numbers; the card says when they were made.

import type { Recommendation } from './recommend.ts'
import { scopedKey } from '../account/storage.ts'

const STORAGE_KEY = 'yolia-saved'
export const MAX_SAVED = 20

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** A stored entry is kept only if it has what the card needs to draw it. */
export function isRecommendation(value: unknown): value is Recommendation {
  if (!isObject(value)) return false
  const { id, at, point, result, zone, situation } = value
  if (typeof id !== 'string' || typeof at !== 'number' || !isObject(point) || !isObject(zone) || !isObject(situation) || !isObject(result)) return false
  if (typeof point.lat !== 'number' || typeof point.lon !== 'number') return false
  const strategy = result.strategy
  if (!isObject(strategy) || typeof strategy.rotation !== 'string' || !isObject(strategy.values) || !isObject(strategy.doses)) return false
  return isObject(result.picks) && typeof zone.status === 'string'
}

export function parseSaved(text: string | null): Recommendation[] {
  if (!text) return []
  try {
    const raw = JSON.parse(text) as unknown
    return Array.isArray(raw) ? raw.filter(isRecommendation).slice(0, MAX_SAVED) : []
  } catch {
    return []
  }
}

export function loadSaved(): Recommendation[] {
  try {
    return parseSaved(localStorage.getItem(scopedKey(STORAGE_KEY)))
  } catch {
    return []
  }
}

export function storeSaved(list: Recommendation[]): void {
  try {
    localStorage.setItem(scopedKey(STORAGE_KEY), JSON.stringify(list))
  } catch {
    // storage blocked or full: the list lasts for this visit only
  }
}

/** The list with `rec` first (replacing the same one), kept to MAX_SAVED newest. */
export const withSaved = (list: Recommendation[], rec: Recommendation): Recommendation[] =>
  [rec, ...list.filter((item) => item.id !== rec.id)].slice(0, MAX_SAVED)

export const withoutSaved = (list: Recommendation[], id: string): Recommendation[] => list.filter((item) => item.id !== id)
