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
  /** The plan year the season ends in: a season sown in November of year 1 ends in year 2. */
  planningYearEnd: number
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
  /** What the service marks it as: `unvalidated_experiment`, or `high_risk_experiment` when a simulated harvest is under 50 kg/ha. */
  advisoryStatus: string
  /** The objectives the service picked this option for: balance (its priority ranking), income, water, soil, pesticide, tradeoff. */
  highlightObjectives: string[]
  paretoEfficient: boolean
  /** Water the crops used in total over the plan (rain plus irrigation), mm: not the same as the irrigation applied. */
  evapotranspirationMm: number | null
  rainfallMm: number | null
  /** Against the comparison reference of its regime (never the farmer's practice); negative means more irrigation. */
  irrigationSavingPct: number | null
  /** The run's soil-health proxy, 0-100: a heuristic, not a measurement. */
  soilProxyScore: number | null
  immatureCampaigns: number
  failedHarvests: number
  requiresIrrigationConfirmation: boolean
  highlightsEs: string[]
  /** null when there is no price data: "no data", never zero. */
  gross: { median: number | null; p10: number | null; p90: number | null } | null
  campaigns: RotationCampaign[]
}

/** How the run was set up and what it used, from the other files of the run folder (null when they were not provided). */
export interface RotationDetails {
  prices: { crop: string; regime: string; year: number; mxnPerT: number | null; scope: string; state: string; cycle: string; modality: string }[]
  soilModel: { method: string; fieldValidated: boolean; assumptions: string[]; inputs: Record<string, number>; parameters: Record<string, number> } | null
  rejected: { modelFailures: number; optimizationRejected: string[][] } | null
  runSettings: { crops: string[]; horizonYears: number; waterRegimes: string[]; irrigationEfficiency: number; rootableDepthCm: number; initialAvailableWaterFraction: number; priceYears: number[] } | null
  cropVarieties: { fieldValidated: boolean; varieties: Record<string, string> } | null
  priceSource: { dataset: string; note: string; years: number[] } | null
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
  /** The priorities the service ranked by (they sum to 100). */
  weightsRequested: Record<string, number> | null
  /** What each regime's irrigation saving is measured against. */
  references: { irrigated: Reference | null; rainfed: Reference | null }
  /** The service says it does not compute area totals: amounts are per hectare. */
  areaTotalsComputed: boolean
  details: RotationDetails | null
}

export interface Reference {
  kind: string
  sequence: (string | null)[]
  grossMedianMxnHa: number | null
  irrigationGrossMm: number | null
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
    planningYearEnd: finite(raw.planningYearEnd ?? raw.planningYear, `${where}.planningYearEnd`),
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
    advisoryStatus: text(raw.advisoryStatus, `${where}.advisoryStatus`),
    highlightObjectives: list(raw.highlightObjectives, `${where}.highlightObjectives`).map((objective, i) => text(objective, `${where}.highlightObjectives[${i}]`)),
    paretoEfficient: raw.paretoEfficient === true,
    evapotranspirationMm: maybe(raw.evapotranspirationMm ?? null, `${where}.evapotranspirationMm`),
    rainfallMm: maybe(raw.rainfallMm ?? null, `${where}.rainfallMm`),
    irrigationSavingPct: maybe(raw.irrigationSavingPct ?? null, `${where}.irrigationSavingPct`),
    soilProxyScore: maybe(raw.soilProxyScore ?? null, `${where}.soilProxyScore`),
    immatureCampaigns: finite(raw.immatureCampaigns ?? 0, `${where}.immatureCampaigns`),
    failedHarvests: finite(raw.failedHarvests, `${where}.failedHarvests`),
    requiresIrrigationConfirmation: raw.requiresIrrigationConfirmation === true,
    highlightsEs: list(raw.highlightsEs, `${where}.highlightsEs`).map((line, i) => text(line, `${where}.highlightsEs[${i}]`)),
    gross,
    campaigns,
  }
}

function parseReference(raw: unknown): Reference | null {
  if (!isObject(raw)) return null
  return { kind: String(raw.kind), sequence: Array.isArray(raw.sequence) ? (raw.sequence as (string | null)[]) : [], grossMedianMxnHa: typeof raw.grossMedianMxnHa === 'number' ? raw.grossMedianMxnHa : null, irrigationGrossMm: typeof raw.irrigationGrossMm === 'number' ? raw.irrigationGrossMm : null }
}

function parseDetails(raw: unknown): RotationDetails | null {
  if (!isObject(raw)) return null
  const object = (value: unknown) => (isObject(value) ? value : null)
  const soil = object(raw.soilModel)
  const rejected = object(raw.rejected)
  const settings = object(raw.runSettings)
  const varieties = object(raw.cropVarieties)
  const source = object(raw.priceSource)
  return {
    prices: Array.isArray(raw.prices) ? (raw.prices as RotationDetails['prices']) : [],
    soilModel: soil && { method: String(soil.method), fieldValidated: soil.fieldValidated === true, assumptions: (soil.assumptions as string[]) ?? [], inputs: (soil.inputs as Record<string, number>) ?? {}, parameters: (soil.parameters as Record<string, number>) ?? {} },
    rejected: rejected && { modelFailures: Number(rejected.modelFailures ?? 0), optimizationRejected: (rejected.optimizationRejected as string[][]) ?? [] },
    runSettings: settings && (settings as unknown as RotationDetails['runSettings']),
    cropVarieties: varieties && { fieldValidated: varieties.fieldValidated === true, varieties: (varieties.varieties as Record<string, string>) ?? {} },
    priceSource: source && (source as unknown as RotationDetails['priceSource']),
  }
}

/** Checks a slim rotations file and returns it typed. Throws, naming the field, on anything the answers would rely on. */
export function parseRotations(raw: unknown): Rotations {
  if (!isObject(raw)) return fail('the file is not an object')
  if (raw.version !== 1) fail(`unsupported version ${String(raw.version)}`)
  const confidence = isObject(raw.confidence) ? raw.confidence : fail('confidence is missing')
  const best = isObject(raw.best) ? raw.best : fail('best is missing')
  const options = list(raw.options, 'options').map(parseOption)
  // a run that found nothing feasible says so (`no_feasible_options`) and has no options; any other run needs some
  if (options.length === 0 && raw.status !== 'no_feasible_options') fail('no options')
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
    weightsRequested: isObject(raw.weightsRequested) ? (raw.weightsRequested as Record<string, number>) : null,
    references: { irrigated: parseReference(isObject(raw.references) ? raw.references.irrigated : null), rainfed: parseReference(isObject(raw.references) ? raw.references.rainfed : null) },
    areaTotalsComputed: raw.areaTotalsComputed === true,
    details: parseDetails(raw.details),
  }
}

/** The option the service's priority weights ranked first for a water regime, or null when there is none. */
export function bestOption(rotations: Rotations, regime: Regime): RotationOption | null {
  const id = rotations.best[regime]
  return rotations.options.find((option) => option.id === id) ?? null
}

/** What the farmer says matters most; `earn` is income, `water` is using water well, `soil` is looking after the soil. */
export type RotationGoal = 'earn' | 'water' | 'soil'

/** The objective the service labels its options with for each goal. */
const OBJECTIVE_OF: Record<RotationGoal, string> = { earn: 'income', water: 'water', soil: 'soil' }

/**
 * The option the service itself picked for what the farmer says matters, within one water regime: the one whose
 * `highlight_objectives` has income, water or soil for the goal (the highest priority score when several do). When the
 * regime has none, the service's own priority ranking decides (its "balance" pick). Nothing is ranked here.
 */
export function pickForGoal(rotations: Rotations, regime: Regime, goal: RotationGoal): RotationOption | null {
  const labelled = rotations.options.filter((option) => option.regime === regime && option.highlightObjectives.includes(OBJECTIVE_OF[goal]))
  const top = labelled.reduce<RotationOption | null>((best, option) => (best === null || (option.priorityScore ?? -Infinity) > (best.priorityScore ?? -Infinity) ? option : best), null)
  return top ?? bestOption(rotations, regime)
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
