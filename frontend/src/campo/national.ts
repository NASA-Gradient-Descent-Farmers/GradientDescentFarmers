// Any place in Mexico -> its SIAP district and the district engine's answers, for the simple farmer view (/campo).
//
// The engine's answers for every district come precomputed (web_export_national.py, public/data/district/national/), with
// an index that maps each municipality of public/data/municipios.json (same order) to its district. A GPS point is placed
// in the municipality whose rural localities are closest (an approximation the view states). Near one of the three demo
// points the richer demo answers are used (all priority settings, English, and the WOFOST simulation).

import { DEMO_LOCATIONS, type DemoLocationId } from '../lib/demoLocations.ts'
import type { CurrentRotationOption, DistrictPlace, WaterRegime } from '../lib/district.ts'
import { distanceKm, type LatLon } from '../lib/geo.ts'

export interface NationalDistrict {
  state_id: number
  ddr: number
  estado: string
  distrito: string
  /** The name the engine was run with (the district, or one of its municipalities). */
  lugar: string
  regimenes: Partial<Record<WaterRegime, CurrentRotationOption[]>>
}

export interface NationalIndex {
  version: number
  prioridades: string[]
  max_prioridades: number
  distritos: Record<string, NationalDistrict>
  /** For each row of municipios.json, in the same order, its district key or null. */
  municipios: (string | null)[]
}

/** One row of municipios.json: [state, municipality, lat, lon]. */
export type MunicipioRow = [string, string, number, number]

export interface FarmPlace {
  municipality: string
  state: string
  point: LatLon
  /** How the place was found: by name, or the closest municipality to the phone's position. */
  how: 'search' | 'gps' | 'example'
  districtKey: string | null
  /** Within DEMO_RADIUS_KM of a demo point: the richer demo answers and the WOFOST simulation apply. */
  demoId: DemoLocationId | null
}

export const DEMO_RADIUS_KM = 40

let indexLoading: Promise<NationalIndex | null> | null = null
let rowsLoading: Promise<MunicipioRow[]> | null = null

export function loadNationalIndex(base: string, fetcher: typeof fetch = fetch): Promise<NationalIndex | null> {
  indexLoading ??= fetcher(`${base}data/district/national/index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<NationalIndex>) : null))
    .catch(() => null)
  return indexLoading
}

export function loadMunicipioRows(base: string, fetcher: typeof fetch = fetch): Promise<MunicipioRow[]> {
  rowsLoading ??= fetcher(`${base}data/municipios.json`)
    .then((r) => (r.ok ? r.json() : { places: [] }))
    .then((file: { places?: MunicipioRow[] }) => file.places ?? [])
    .catch(() => [])
  return rowsLoading
}

const nearDemo = (point: LatLon): DemoLocationId | null => {
  for (const place of DEMO_LOCATIONS) if (distanceKm(point, { lat: place.latitude, lon: place.longitude }) <= DEMO_RADIUS_KM) return place.id
  return null
}

const stateName = (state: string) => (state === 'Estado de México' ? 'México' : state)

/** A place found by municipality name and state (as the search lists them). */
export function placeByName(rows: MunicipioRow[], index: NationalIndex | null, municipality: string, state: string, how: FarmPlace['how'] = 'search'): FarmPlace | null {
  const i = rows.findIndex(([s, m]) => m === municipality && s === stateName(state))
  if (i < 0) return null
  const [s, m, lat, lon] = rows[i]
  const point = { lat, lon }
  return { municipality: m, state: s, point, how, districtKey: index?.municipios[i] ?? null, demoId: nearDemo(point) }
}

/** The municipality closest to a point (its rural localities' median position). */
export function placeByPoint(rows: MunicipioRow[], index: NationalIndex | null, point: LatLon): FarmPlace | null {
  let best = -1
  let bestKm = Infinity
  rows.forEach(([, , lat, lon], i) => {
    const km = distanceKm(point, { lat, lon })
    if (km < bestKm) {
      best = i
      bestKm = km
    }
  })
  if (best < 0 || bestKm > 80) return null // outside Mexico, or far from any municipality
  const [s, m] = rows[best]
  return { municipality: m, state: s, point, how: 'gps', districtKey: index?.municipios[best] ?? null, demoId: nearDemo(point) }
}

/** The district as the engine's loader wants it (lib/district.ts DistrictPlace). */
export function nationalDistrictPlace(index: NationalIndex, key: string): DistrictPlace | null {
  const d = index.distritos[key]
  return d ? { municipio: d.lugar, estado: d.estado, regimenes: d.regimenes } : null
}
