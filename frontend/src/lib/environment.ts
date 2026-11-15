// The environmental package the source builder published for a place (gradientdescentfarmers/source_builder), in the
// compact form scripts/slim-profile.mjs writes to public/data/environment/<location>.json: two years of NASA POWER
// weather, SoilGrids soil, SRTM terrain, MODIS vegetation, evapotranspiration and surface temperature, SMAP soil
// moisture, GPM rain, World Bank context, and the status of every source. These are satellite and model grids for a
// point, not measurements of a parcel. This file only reads and checks them and computes plain summaries.

import { INSIDE_KM } from './coverage.ts'
import { DEMO_LOCATIONS, type DemoLocationId } from './demoLocations.ts'
import { distanceKm, type LatLon } from './geo.ts'
import type { Rotations, RotationsByLocation } from './rotations.ts'

export interface MonthClimate {
  year: number
  month: number
  rainMm: number | null
  tmeanC: number | null
  tminC: number | null
  tmaxC: number | null
}

export interface YearClimate {
  year: number
  rainMm: number | null
  rainCoveragePct: number | null
  fullYear: boolean
  dryDays: number | null
  longestDryRunDays: number | null
  frostDays: number | null
  heatDays: number | null
  gddBase10: number | null
}

export interface SoilValue {
  property: string
  depth: string
  value: number | null
  unit: string
}

export interface Composite {
  date: string
  qaPass: boolean
}

export interface Environment {
  version: 1
  farmId: string
  runId: string
  createdUtc: string
  buildState: string
  integrityOk: boolean
  qaOk: boolean
  latitude: number
  longitude: number
  period: { from: string; to: string }
  climate: { monthly: MonthClimate[]; annual: YearClimate[] }
  daily: { start: string; days: number; rainMm: (number | null)[]; tmeanC: (number | null)[]; tminC: (number | null)[]; tmaxC: (number | null)[]; humidityPct: (number | null)[]; windMs: (number | null)[]; solarMjM2: (number | null)[] }
  soil: SoilValue[]
  terrain: { elevationM: number | null; slopeDeg: number | null; samples: { sample: string; elevationM: number | null }[] }
  vegetation: (Composite & { ndvi: number | null; evi: number | null })[]
  evapotranspiration: (Composite & { periodDays: number | null; etMmDay: number | null; petMmDay: number | null; ratio: number | null })[]
  surfaceTemperature: { date: string; dayC: number | null; nightC: number | null; dayQaPass: boolean; nightQaPass: boolean }[]
  soilMoisture: { at: string; surface: number | null; rootzone: number | null; cellLat: number | null; cellLon: number | null }[]
  gpm: { date: string; totalMm: number | null; max30minMm: number | null; slots: number | null; validSlots: number | null; complete: boolean }[]
  country: { indicator: string; year: number; value: number | null; unit: string }[]
  sources: { key: string; status: string; provider: string | null; rows: number | null; coverage: number | null }[]
  readiness: { key: string; ready: boolean; reason: string }[]
  blockers: Record<string, string>
  notes: string[]
  limitations: string[]
  missingInputs: { cropParameters: string[]; prices: string[]; practices: string[] }
}

export type EnvironmentByLocation = Partial<Record<DemoLocationId, Environment>>

const fail = (message: string): never => {
  throw new Error(`environment: ${message}`)
}
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const list = (value: unknown, name: string): unknown[] => (Array.isArray(value) ? value : fail(`${name} is not a list`))
const record = (value: unknown, name: string): Record<string, unknown> => (isObject(value) ? value : fail(`${name} is not an object`))
const text = (value: unknown, name: string) => (typeof value === 'string' && value !== '' ? value : fail(`${name} is not text`))
const finite = (value: unknown, name: string) => (typeof value === 'number' && Number.isFinite(value) ? value : fail(`${name} is not a number`))

/** Checks a slim environment file and returns it typed. Throws, naming the part, on anything the answers would rely on. */
export function parseEnvironment(raw: unknown): Environment {
  const file = record(raw, 'the file')
  if (file.version !== 1) fail(`unsupported version ${String(file.version)}`)
  const daily = record(file.daily, 'daily')
  const days = finite(daily.days, 'daily.days')
  for (const column of ['rainMm', 'tmeanC', 'tminC', 'tmaxC', 'humidityPct', 'windMs', 'solarMjM2']) {
    if (list(daily[column], `daily.${column}`).length !== days) fail(`daily.${column} does not have ${days} values`)
  }
  const climate = record(file.climate, 'climate')
  const monthly = list(climate.monthly, 'climate.monthly')
  const annual = list(climate.annual, 'climate.annual')
  if (monthly.length === 0 || annual.length === 0) fail('climate is empty')
  const terrain = record(file.terrain, 'terrain')
  const period = record(file.period, 'period')
  const missing = record(file.missingInputs, 'missingInputs')
  for (const table of ['soil', 'vegetation', 'evapotranspiration', 'surfaceTemperature', 'soilMoisture', 'gpm', 'country', 'sources', 'readiness', 'notes', 'limitations']) list(file[table], table)
  record(file.blockers, 'blockers')
  return {
    version: 1,
    farmId: text(file.farmId, 'farmId'),
    runId: text(file.runId, 'runId'),
    createdUtc: text(file.createdUtc, 'createdUtc'),
    buildState: text(file.buildState, 'buildState'),
    integrityOk: file.integrityOk === true,
    qaOk: file.qaOk === true,
    latitude: finite(file.latitude, 'latitude'),
    longitude: finite(file.longitude, 'longitude'),
    period: { from: text(period.from, 'period.from'), to: text(period.to, 'period.to') },
    climate: { monthly: monthly as MonthClimate[], annual: annual as YearClimate[] },
    daily: { ...(daily as unknown as Environment['daily']), days },
    soil: file.soil as SoilValue[],
    terrain: { elevationM: (terrain.elevationM as number | null) ?? null, slopeDeg: (terrain.slopeDeg as number | null) ?? null, samples: list(terrain.samples, 'terrain.samples') as Environment['terrain']['samples'] },
    vegetation: file.vegetation as Environment['vegetation'],
    evapotranspiration: file.evapotranspiration as Environment['evapotranspiration'],
    surfaceTemperature: file.surfaceTemperature as Environment['surfaceTemperature'],
    soilMoisture: file.soilMoisture as Environment['soilMoisture'],
    gpm: file.gpm as Environment['gpm'],
    country: file.country as Environment['country'],
    sources: file.sources as Environment['sources'],
    readiness: file.readiness as Environment['readiness'],
    blockers: file.blockers as Record<string, string>,
    notes: file.notes as string[],
    limitations: file.limitations as string[],
    missingInputs: {
      cropParameters: list(missing.cropParameters, 'missingInputs.cropParameters') as string[],
      prices: list(missing.prices, 'missingInputs.prices') as string[],
      practices: list(missing.practices, 'missingInputs.practices') as string[],
    },
  }
}

// ---- plain summaries: sums and means of the file's own values ----

const present = (values: (number | null | undefined)[]): number[] => values.filter((value): value is number => typeof value === 'number')
export const mean = (values: (number | null | undefined)[]): number | null => {
  const kept = present(values)
  return kept.length === 0 ? null : kept.reduce((sum, value) => sum + value, 0) / kept.length
}

export interface Stats {
  min: number
  max: number
  mean: number
  count: number
}
export function stats(values: (number | null | undefined)[]): Stats | null {
  const kept = present(values)
  return kept.length === 0 ? null : { min: Math.min(...kept), max: Math.max(...kept), mean: kept.reduce((sum, value) => sum + value, 0) / kept.length, count: kept.length }
}

/** One value per month (January first) for a year of the monthly table; null where the file has no value. */
export function monthlySeries(environment: Environment, year: number, key: 'rainMm' | 'tmeanC' | 'tminC' | 'tmaxC'): (number | null)[] {
  const values: (number | null)[] = Array.from({ length: 12 }, () => null)
  for (const row of environment.climate.monthly) if (row.year === year) values[row.month - 1] = row[key]
  return values
}

/** The years the monthly table covers, in order. */
export const climateYears = (environment: Environment): number[] => [...new Set(environment.climate.monthly.map((row) => row.year))].sort((a, b) => a - b)

/** Mean air temperature over every day of the record. */
export const meanTemperatureC = (environment: Environment): number | null => mean(environment.daily.tmeanC)

/** A soil property at a depth ("0-5cm"), or null. */
export function soilValue(environment: Environment, property: string, depth: string): SoilValue | null {
  return environment.soil.find((row) => row.property === property && row.depth === depth) ?? null
}
export const soilProperties = (environment: Environment): string[] => [...new Set(environment.soil.map((row) => row.property))]
export const soilDepths = (environment: Environment): string[] => [...new Set(environment.soil.map((row) => row.depth))]

/** Observations that passed their quality check, as the file marks them. */
export const passing = <T extends { qaPass: boolean }>(rows: T[]): T[] => rows.filter((row) => row.qaPass)

// ---- which places a parcel is near ----

/** A demonstration point a parcel is close enough to use, with what is published for it. */
export interface Zone {
  id: DemoLocationId
  name: string
  /** From the parcel to the point the data was built for. */
  km: number
  rotations: Rotations | null
  environment: Environment | null
}

/**
 * The nearest point with published data (rotation results or an environmental package), if the parcel is within `maxKm`
 * of it: the app's own "inside" distance, about one NASA POWER weather cell. Farther away the data says nothing about the
 * parcel, so none.
 */
export function nearZone(point: LatLon, published: { rotations: RotationsByLocation; environment: EnvironmentByLocation }, maxKm: number = INSIDE_KM): Zone | null {
  let nearest: Zone | null = null
  for (const place of DEMO_LOCATIONS) {
    const rotations = published.rotations[place.id] ?? null
    const environment = published.environment[place.id] ?? null
    if (!rotations && !environment) continue
    const km = distanceKm(point, { lat: place.latitude, lon: place.longitude })
    if (km <= maxKm && (nearest === null || km < nearest.km)) nearest = { id: place.id, name: place.name, km, rotations, environment }
  }
  return nearest
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.json()
}

/**
 * Loads the environmental package of each location from `<base>data/environment/<id>.json`. One that is missing or fails
 * the check is left out, so the app and the chat simply do not offer what they cannot stand behind.
 */
export async function loadEnvironment(ids: readonly DemoLocationId[], base: string): Promise<EnvironmentByLocation> {
  const loaded: EnvironmentByLocation = {}
  await Promise.all(
    ids.map(async (id) => {
      try {
        loaded[id] = parseEnvironment(await getJson(`${base}data/environment/${id}.json`))
      } catch (error) {
        console.warn(`environment data for ${id} not used:`, error instanceof Error ? error.message : error)
      }
    }),
  )
  return loaded
}
