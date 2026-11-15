// The rotation results published by the rotations service (gradientdescentfarmers/rotations_service), in the slim form
// scripts/slim-rotations.mjs writes to public/data/rotations/<location>.json. They are experimental scenarios: a WOFOST
// crop model run on 2024-2025 weather with SIAP state prices, not a forecast and not validated in the field. Amounts are
// gross income per hectare over the whole plan, never profit. Everything here only reads and checks the file.

import type { DemoLocationId } from './demoLocations.ts'

export type Regime = 'irrigated' | 'rainfed'

export interface RotationCampaign {
  cropEs: string
  /** A fallow campaign grows nothing, so it has no yield or income. */
  fallow: boolean
  planningYear: number
  /** "06-15": month and day, relative to the plan, not a calendar date. */
  sowing: string
  end: string
  grainTHa: number | null
  grossMxnHa: number | null
}

export interface RotationOption {
  id: string
  regime: Regime
  descriptionEs: string
  priorityScore: number | null
  irrigationM3Ha: number | null
  failedHarvests: number
  requiresIrrigationConfirmation: boolean
  highlightsEs: string[]
  /** null when there is no price data: "no data", never zero. */
  gross: { median: number | null; p10: number | null; p90: number | null } | null
  campaigns: RotationCampaign[]
}

export interface Rotations {
  version: 1
  farmId: string
  sourceRunId: string
  rotationRunId: string
  generatedAt: string
  status: string
  basis: string
  municipality: string | null
  confidence: { overall: string; labelEs: string; reasonsEs: string[]; fieldValidated: boolean; probabilityOfSuccess: number | null }
  weatherYears: number[]
  best: { irrigated: string | null; rainfed: string | null }
  options: RotationOption[]
}

/** The rotation results by demonstration location; a location missing here has none loaded. */
export type RotationsByLocation = Partial<Record<DemoLocationId, Rotations>>

const fail = (message: string): never => {
  throw new Error(`rotations: ${message}`)
}
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown, name: string) => (typeof value === 'string' && value !== '' ? value : fail(`${name} is not text`))
const finite = (value: unknown, name: string) => (typeof value === 'number' && Number.isFinite(value) ? value : fail(`${name} is not a number`))
const maybe = (value: unknown, name: string) => (value === null ? null : finite(value, name))
const list = (value: unknown, name: string) => (Array.isArray(value) ? value : fail(`${name} is not a list`))

function parseCampaign(raw: unknown, where: string): RotationCampaign {
  if (!isObject(raw)) return fail(`${where} is not an object`)
  return {
    cropEs: text(raw.cropEs, `${where}.cropEs`),
    fallow: raw.fallow === true,
    planningYear: finite(raw.planningYear, `${where}.planningYear`),
    sowing: text(raw.sowing, `${where}.sowing`),
    end: text(raw.end, `${where}.end`),
    grainTHa: maybe(raw.grainTHa, `${where}.grainTHa`),
    grossMxnHa: maybe(raw.grossMxnHa, `${where}.grossMxnHa`),
  }
}

function parseOption(raw: unknown, index: number): RotationOption {
  const where = `options[${index}]`
  if (!isObject(raw)) return fail(`${where} is not an object`)
  if (raw.regime !== 'irrigated' && raw.regime !== 'rainfed') fail(`${where}.regime is ${String(raw.regime)}`)
  const gross = raw.gross === null ? null : isObject(raw.gross) ? { median: maybe(raw.gross.median, `${where}.gross.median`), p10: maybe(raw.gross.p10, `${where}.gross.p10`), p90: maybe(raw.gross.p90, `${where}.gross.p90`) } : fail(`${where}.gross`)
  const campaigns = list(raw.campaigns, `${where}.campaigns`).map((campaign, i) => parseCampaign(campaign, `${where}.campaigns[${i}]`))
  if (campaigns.length === 0) fail(`${where} has no campaigns`)
  return {
    id: text(raw.id, `${where}.id`),
    regime: raw.regime as Regime,
    descriptionEs: text(raw.descriptionEs, `${where}.descriptionEs`),
    priorityScore: maybe(raw.priorityScore, `${where}.priorityScore`),
    irrigationM3Ha: maybe(raw.irrigationM3Ha, `${where}.irrigationM3Ha`),
    failedHarvests: finite(raw.failedHarvests, `${where}.failedHarvests`),
    requiresIrrigationConfirmation: raw.requiresIrrigationConfirmation === true,
    highlightsEs: list(raw.highlightsEs, `${where}.highlightsEs`).map((line, i) => text(line, `${where}.highlightsEs[${i}]`)),
    gross,
    campaigns,
  }
}

/** Checks a slim rotations file and returns it typed. Throws, naming the field, on anything the answers would rely on. */
export function parseRotations(raw: unknown): Rotations {
  if (!isObject(raw)) return fail('the file is not an object')
  if (raw.version !== 1) fail(`unsupported version ${String(raw.version)}`)
  const confidence = isObject(raw.confidence) ? raw.confidence : fail('confidence is missing')
  const best = isObject(raw.best) ? raw.best : fail('best is missing')
  const options = list(raw.options, 'options').map(parseOption)
  if (options.length === 0) fail('no options')
  const ids = new Set(options.map((option) => option.id))
  for (const regime of ['irrigated', 'rainfed'] as const) {
    const id = best[regime]
    if (id !== null && !ids.has(text(id, `best.${regime}`))) fail(`best.${regime} names an option that is not in the file`)
  }
  return {
    version: 1,
    farmId: text(raw.farmId, 'farmId'),
    sourceRunId: text(raw.sourceRunId, 'sourceRunId'),
    rotationRunId: text(raw.rotationRunId, 'rotationRunId'),
    generatedAt: text(raw.generatedAt, 'generatedAt'),
    status: text(raw.status, 'status'),
    basis: text(raw.basis, 'basis'),
    municipality: raw.municipality === null ? null : text(raw.municipality, 'municipality'),
    confidence: {
      overall: text(confidence.overall, 'confidence.overall'),
      labelEs: text(confidence.labelEs, 'confidence.labelEs'),
      reasonsEs: list(confidence.reasonsEs, 'confidence.reasonsEs').map((reason, i) => text(reason, `confidence.reasonsEs[${i}]`)),
      fieldValidated: confidence.fieldValidated === true,
      probabilityOfSuccess: maybe(confidence.probabilityOfSuccess, 'confidence.probabilityOfSuccess'),
    },
    weatherYears: list(raw.weatherYears, 'weatherYears').map((year, i) => finite(year, `weatherYears[${i}]`)),
    best: { irrigated: (best.irrigated as string | null) ?? null, rainfed: (best.rainfed as string | null) ?? null },
    options,
  }
}

/** The option the service's priority weights ranked first for a water regime, or null when there is none. */
export function bestOption(rotations: Rotations, regime: Regime): RotationOption | null {
  const id = rotations.best[regime]
  return rotations.options.find((option) => option.id === id) ?? null
}

/** The option with the highest median gross income in a regime, ignoring priorities; null without income data. */
export function topIncomeOption(rotations: Rotations, regime: Regime): RotationOption | null {
  const withIncome = rotations.options.filter((option) => option.regime === regime && option.gross?.median != null)
  return withIncome.reduce<RotationOption | null>((top, option) => (top === null || option.gross!.median! > top.gross!.median! ? option : top), null)
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.json()
}

/**
 * Loads the rotation results for the given locations from `<base>data/rotations/<id>.json`. A location whose file is
 * missing or fails the check is simply left out: the chat then says "data unavailable" instead of showing less than it
 * can stand behind.
 */
export async function loadRotations(ids: readonly DemoLocationId[], base: string): Promise<RotationsByLocation> {
  const loaded: RotationsByLocation = {}
  await Promise.all(
    ids.map(async (id) => {
      try {
        loaded[id] = parseRotations(await getJson(`${base}data/rotations/${id}.json`))
      } catch (error) {
        console.warn(`rotation results for ${id} not used:`, error instanceof Error ? error.message : error)
      }
    }),
  )
  return loaded
}
