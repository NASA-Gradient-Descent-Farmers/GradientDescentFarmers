// Reading what the farmer types. This is not language understanding: each reader accepts a small, stated grammar
// (a number with an optional unit, a month name, a crop name from a short list) and says "unclear" for anything
// else, so the question can ask for what is missing instead of guessing.

import { normalize } from '../assistant/interpret.ts'
import { AREA_UNITS, CROPS, toHectares, type AreaUnit, type Crop, type Land, type Part, type Planting } from '../lib/farm.ts'

// ---- numbers ----

/**
 * A number as people write it: 2, 2.5, 2,5, 1,500, 1 500, 1,500.75 or 1.500,75. A dot or a lone comma not followed by
 * three digits is the decimal mark; otherwise commas and dots group thousands. Null if it is not a number.
 */
export function readNumber(text: string): number | null {
  const body = text.replace(/\s/g, '')
  if (!/^[\d.,]+$/.test(body) || !/\d/.test(body)) return null
  const dots = body.split('.').length - 1
  const commas = body.split(',').length - 1
  const grouped = (digits: string, group: string) => new RegExp(`^\\d{1,3}(\\${group}\\d{3})+$`).test(digits)
  let normalized: string
  if (dots > 0 && commas > 0) {
    const decimal = body.lastIndexOf('.') > body.lastIndexOf(',') ? '.' : ','
    const group = decimal === '.' ? ',' : '.'
    const parts = body.split(decimal)
    if (parts.length !== 2) return null
    if (parts[0].includes(group) && !grouped(parts[0], group)) return null
    normalized = `${parts[0].split(group).join('')}.${parts[1]}`
  } else if (commas > 0) {
    if (commas === 1 && !/,\d{3}$/.test(body)) normalized = body.replace(',', '.') // 2,5
    else if (grouped(body, ',')) normalized = body.replace(/,/g, '') // 1,500 and 1,500,000
    else return null
  } else if (dots > 1) {
    if (!grouped(body, '.')) return null // 1.500.000 groups thousands the way Spain writes them
    normalized = body.replace(/\./g, '')
  } else {
    normalized = body
  }
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

// ---- land ----

const UNIT_WORDS: [AreaUnit, RegExp][] = [
  ['ha', /^(ha|has|hectarea|hectareas|hectare|hectares)$/],
  ['ac', /^(ac|acre|acres)$/],
  ['m2', /^(m2|mt2|mts2|m\^2|metro cuadrado|metros cuadrados|square meter|square meters|square metre|square metres|sqm)$/],
]

export const readUnit = (word: string): AreaUnit | null => UNIT_WORDS.find(([, pattern]) => pattern.test(normalize(word).replace(/²/g, '2').trim()))?.[0] ?? null

export type AreaProblem = 'empty' | 'unreadable' | 'notPositive'

/** Plausible plots: from a garden (100 m²) to a very large farm. */
export const MIN_HA = 0.01
export const MAX_HA = 10000
/** A figure in hectares this large is more often square metres typed against the wrong unit. */
export const HA_SUSPICIOUS = 500

/**
 * An area from text: "2", "2.5 ha", "5,000 m2", "1.5 acres", "media hectárea", "half an acre". A unit in the text wins
 * over `fallback`, the unit selected beside the field.
 */
export function readArea(text: string, fallback: AreaUnit): { ok: true; land: Land } | { ok: false; problem: AreaProblem } {
  const body = normalize(text).replace(/²/g, '2').trim()
  if (body === '') return { ok: false, problem: 'empty' }
  const half = /^(media|medio|half)(\s+an?)?\s+(.+)$/.exec(body)
  if (half) {
    const unit = readUnit(half[3])
    return unit ? { ok: true, land: { amount: 0.5, unit } } : { ok: false, problem: 'unreadable' }
  }
  const match = /^([\d.,\s]*\d[\d.,\s]*?)\s*([a-z][a-z0-9^ ]*)?$/.exec(body)
  if (!match) return { ok: false, problem: 'unreadable' }
  const amount = readNumber(match[1])
  if (amount === null) return { ok: false, problem: 'unreadable' }
  let unit = fallback
  if (match[2]) {
    const named = readUnit(match[2])
    if (!named) return { ok: false, problem: 'unreadable' }
    unit = named
  }
  return amount > 0 ? { ok: true, land: { amount, unit } } : { ok: false, problem: 'notPositive' }
}

/**
 * Whether an area is believable. `unit` means the figure and the unit may not belong together (500 ha, or 20 m²):
 * the question asks which one was meant instead of accepting it or refusing it.
 */
export function checkLand(land: Land): 'ok' | 'unit' | 'tooSmall' | 'tooLarge' {
  const ha = toHectares(land)
  if (ha > MAX_HA) return 'tooLarge'
  if (land.unit === 'ha' && land.amount >= HA_SUSPICIOUS) return 'unit'
  if (ha < MIN_HA) return land.unit === 'ha' ? 'tooSmall' : 'unit'
  return 'ok'
}

export const isAreaUnit = (value: unknown): value is AreaUnit => (AREA_UNITS as readonly unknown[]).includes(value)

// ---- planting time ----

const MONTH_WORDS: [number, string[]][] = [
  [0, ['enero', 'ene', 'january', 'jan']],
  [1, ['febrero', 'feb', 'february']],
  [2, ['marzo', 'mar', 'march']],
  [3, ['abril', 'abr', 'april', 'apr']],
  [4, ['mayo', 'may']],
  [5, ['junio', 'jun', 'june']],
  [6, ['julio', 'jul', 'july']],
  [7, ['agosto', 'ago', 'august', 'aug']],
  [8, ['septiembre', 'setiembre', 'sep', 'sept', 'september']],
  [9, ['octubre', 'oct', 'october']],
  [10, ['noviembre', 'nov', 'november']],
  [11, ['diciembre', 'dic', 'december', 'dec']],
]

const PART_WORDS: Record<Part, RegExp> = {
  early: /\b(principio|principios|inicio|inicios|comienzo|comienzos|primera quincena|early|beginning|start)\b/,
  mid: /\b(mediados|medio|mid|middle)\b/,
  late: /\b(final|finales|fines|fin|segunda quincena|late|end)\b/,
}
const RAINS = /(primeras lluvias|primer lluvia|cuando (empiece|empiecen|inicie|inicien|llueva|lleguen|caigan)|empiezan las lluvias|inicio de (las )?lluvias|temporal|first rains?|when (the )?rains?|start of (the )?rains|rainy season|monsoon)/

export type WhenProblem = 'empty' | 'unclear' | 'several'

/** The months named in the text, in calendar order. */
export function monthsIn(text: string): number[] {
  const words = normalize(text).split(/[^a-z]+/).filter(Boolean)
  return MONTH_WORDS.filter(([, names]) => names.some((name) => words.includes(name))).map(([month]) => month)
}

/**
 * A planting time from text: a month ("junio", "mid-June", "a finales de mayo") or "when the rains start". More than
 * one month ("junio o julio") is `several`: the question asks which one is closer instead of choosing.
 */
export function readWhen(text: string): { ok: true; planting: Planting } | { ok: false; problem: WhenProblem; months: number[] } {
  const body = normalize(text).trim()
  if (body === '') return { ok: false, problem: 'empty', months: [] }
  const months = monthsIn(body)
  if (months.length > 1) return { ok: false, problem: 'several', months }
  if (months.length === 1) {
    const part = (Object.keys(PART_WORDS) as Part[]).find((p) => PART_WORDS[p].test(body)) ?? null
    return { ok: true, planting: { kind: 'month', month: months[0], part } }
  }
  if (RAINS.test(body)) return { ok: true, planting: { kind: 'rains' } }
  return { ok: false, problem: 'unclear', months: [] }
}

// ---- crops ----

const CROP_WORDS: Record<Crop, RegExp> = {
  maize: /^(maiz|maize|corn)$/,
  barley: /^(cebada|barley)$/,
  fababean: /^(haba|habas|faba|fava|faba bean|fava bean|broad bean)$/,
}

/** The crops in a list typed by the farmer ("maíz, trigo y haba"): those the models cover, and the rest as written. */
export function readCrops(text: string): { crops: Crop[]; unmodelled: string[] } {
  const crops: Crop[] = []
  const unmodelled: string[] = []
  for (const piece of text.split(/[,;/\n]|\sy\s|\sand\s/i)) {
    const name = piece.trim()
    if (!name) continue
    const found = CROPS.find((crop) => CROP_WORDS[crop].test(normalize(name)))
    if (found) {
      if (!crops.includes(found)) crops.push(found)
    } else if (!unmodelled.includes(name)) {
      unmodelled.push(name)
    }
  }
  return { crops, unmodelled }
}

// ---- money ----

/** An amount of money from text: "20000", "$20,000", "20k", "20 mil", "20,000 pesos". Null if it is not one. */
export function readMoney(text: string): number | null {
  const body = normalize(text)
    .replace(/(pesos?|mxn|usd|dolares?|dollars?|\$)/g, ' ')
    .trim()
  const match = /^([\d.,\s]*\d)\s*(k|mil|thousand)?$/.exec(body)
  if (!match) return null
  const value = readNumber(match[1])
  return value === null ? null : match[2] ? value * 1000 : value
}
