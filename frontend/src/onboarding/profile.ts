// The farmer's answers: kept only in this browser, checked field by field when read back, and turned into the inputs
// of the models. Which questions are still to ask follows from what is already known.

import {
  AREA_UNITS, CROPS, CURRENCIES, PARTS, PRIORITIES, WATER, presetFor, rotationsFor, toHectares,
  type Budget, type Land, type Planting, type Preset,
} from '../lib/farm.ts'
import type { LatLon } from '../lib/geo.ts'
import type { Meta } from '../lib/types.ts'
import type { FarmInputs } from '../assistant/types.ts'
import { STEPS, type Answer, type CropsAnswer, type Profile, type StepId } from './types.ts'
import { scopedKey } from '../account/storage.ts'

const STORAGE_KEY = 'campo-verde-profile'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T => list.includes(value as T)

function readLand(value: unknown): Land | null {
  return isObject(value) && isNumber(value.amount) && value.amount > 0 && oneOf(AREA_UNITS, value.unit) ? { amount: value.amount, unit: value.unit } : null
}

function readPlanting(value: unknown): Planting | null {
  if (!isObject(value)) return null
  if (value.kind === 'rains') return { kind: 'rains' }
  if (value.kind !== 'month' || !isNumber(value.month) || !Number.isInteger(value.month) || value.month < 0 || value.month > 11) return null
  if (value.part !== null && !oneOf(PARTS, value.part)) return null
  return { kind: 'month', month: value.month, part: value.part }
}

function readBudget(value: unknown): Budget | null {
  if (!isObject(value) || !oneOf(CURRENCIES, value.currency) || !oneOf(['total', 'perHa'] as const, value.basis)) return null
  if (!isNumber(value.low) || value.low < 0) return null
  if (value.high !== null && (!isNumber(value.high) || value.high < value.low)) return null
  const rate = isNumber(value.rate) && value.rate > 0 ? value.rate : null
  if (value.currency === 'USD' && rate === null) return null
  return { currency: value.currency, rate: value.currency === 'USD' ? rate : null, low: value.low, high: value.high, basis: value.basis }
}

function readAnswer<T>(raw: unknown, read: (value: unknown) => T | null): Answer<T> | undefined {
  if (!isObject(raw)) return undefined
  if (raw.unsure === true) return { unsure: true }
  const value = raw.unsure === false ? read(raw.value) : null
  return value === null ? undefined : { unsure: false, value }
}

function readCrops(raw: unknown): CropsAnswer | undefined {
  if (!isObject(raw) || typeof raw.help !== 'boolean' || !Array.isArray(raw.crops) || !Array.isArray(raw.unmodelled)) return undefined
  const crops = CROPS.filter((crop) => (raw.crops as unknown[]).includes(crop))
  const unmodelled = raw.unmodelled.filter((name): name is string => typeof name === 'string' && name.trim() !== '').slice(0, 10)
  return raw.help || crops.length > 0 ? { help: raw.help, crops: raw.help ? [] : crops, unmodelled } : undefined
}

/** A profile from stored text: every field that does not check out is dropped, and unusable text gives an empty profile. */
export function parseProfile(text: string | null): Profile {
  if (!text) return {}
  try {
    const raw: unknown = JSON.parse(text)
    if (!isObject(raw) || raw.version !== 1 || !isObject(raw.profile)) return {}
    const p = raw.profile
    const profile: Profile = {}
    const crops = readCrops(p.crops)
    if (crops) profile.crops = crops
    const land = readAnswer(p.land, readLand)
    if (land) profile.land = land
    const when = readAnswer(p.when, readPlanting)
    if (when) profile.when = when
    const budget = readAnswer(p.budget, readBudget)
    if (budget) profile.budget = budget
    const water = readAnswer(p.water, (v) => (oneOf(WATER, v) ? v : null))
    if (water) profile.water = water
    const priority = readAnswer(p.priority, (v) => (oneOf(PRIORITIES, v) ? v : null))
    if (priority) profile.priority = priority
    if (p.confirmed === true) profile.confirmed = true
    return profile
  } catch {
    return {}
  }
}

export function loadProfile(): Profile {
  try {
    return parseProfile(localStorage.getItem(scopedKey(STORAGE_KEY)))
  } catch {
    return {}
  }
}

/** Keeps the profile on this device; false if the browser does not let it (the answers then last for this visit). */
export function saveProfile(profile: Profile): boolean {
  try {
    localStorage.setItem(scopedKey(STORAGE_KEY), JSON.stringify({ version: 1, profile }))
    return true
  } catch {
    return false
  }
}

export function clearProfile(): void {
  try {
    localStorage.removeItem(scopedKey(STORAGE_KEY))
  } catch {
    // nothing stored, or storage blocked
  }
}

// ---- which questions are still to ask ----

/** Whether a step has an answer already. The map step is answered by the pin, which is stored apart from the profile. */
export function isAnswered(profile: Profile, pin: LatLon | null, step: StepId): boolean {
  if (step === 'where') return pin !== null
  return profile[step] !== undefined
}

/** The questions to ask, in order, leaving out whatever is known. */
export const stepsToAsk = (profile: Profile, pin: LatLon | null): StepId[] => STEPS.filter((step) => !isAnswered(profile, pin, step))

/** Enough to start: what to grow (or "help me") and where. */
export const isReady = (profile: Profile, pin: LatLon | null): boolean => profile.crops !== undefined && pin !== null

// ---- into the models ----

const valueOf = <T>(answer: Answer<T> | undefined): T | null => (answer && !answer.unsure ? answer.value : null)

/** The inputs the models take, from the answers. Null if nothing has been answered. */
export function farmInputs(profile: Profile, meta: Meta): FarmInputs | null {
  const answered = [profile.crops, profile.land, profile.when, profile.budget, profile.water, profile.priority].some((a) => a !== undefined)
  if (!answered) return null
  const wanted = profile.crops && !profile.crops.help ? profile.crops.crops : []
  const land = valueOf(profile.land)
  return {
    wanted,
    unmodelled: profile.crops?.unmodelled ?? [],
    rotations: rotationsFor(wanted.length > 0 ? wanted : null, meta),
    areaHa: land ? toHectares(land) : null,
    budget: valueOf(profile.budget),
    planting: valueOf(profile.when),
    water: valueOf(profile.water),
    priority: valueOf(profile.priority),
  }
}

/** The planner preset the farmer's priority asks for, if they gave one. */
export function presetOf(profile: Profile): Preset | null {
  const priority = valueOf(profile.priority)
  return priority ? presetFor(priority) : null
}
