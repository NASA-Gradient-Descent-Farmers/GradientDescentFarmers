import { distanceKm, type LatLon } from './geo.ts'

// The official collection centres for maíz and frijol (Alimentación para el Bienestar), as written by scripts/acopio.mjs from
// the datos.gob.mx directory. The directory gives addresses, not coordinates: each centre sits at its municipality's point,
// so a distance is approximate and straight-line. The rules ask the plot and the centre to be in the same state, so only
// centres in the farmer's state are offered. The file is optional: without it, nothing is said about the nearest centre.

export interface AcopioFile {
  source: string
  url: string
  downloaded: string
  located: 'municipio'
  columns: string[]
  centros: [string, string, string, string, string, number | null, number | null, string][]
}

export interface Centre {
  state: string
  municipality: string
  locality: string
  name: string
  address: string
  point: LatLon | null
}

export interface NearCentre extends Centre {
  km: number
  /** True when the centre is in the farmer's own municipality: the distance says nothing then. */
  sameMunicipality: boolean
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** One key for a state however it is written: "Veracruz", "Veracruz de Ignacio de la Llave", "Estado de México", "México". */
export const stateKey = (name: string) =>
  fold(name)
    .replace(/ de (zaragoza|ocampo|ignacio de la llave)$/, '')
    .replace(/^estado de /, '')

export const centresOf = (file: AcopioFile): Centre[] =>
  file.centros.map(([state, municipality, locality, name, address, lat, lon]) => ({ state, municipality, locality, name, address, point: lat != null && lon != null ? { lat, lon } : null }))

/** The centres closest to a point, in the same state only. */
export function nearestCentres(centres: Centre[], point: LatLon, state: string, municipality?: string, n = 2): NearCentre[] {
  const key = stateKey(state)
  return centres
    .filter((c) => c.point && stateKey(c.state) === key)
    .map((c) => ({ ...c, km: distanceKm(point, c.point!), sameMunicipality: !!municipality && fold(municipality) === fold(c.municipality) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, n)
}

export interface Centres {
  centres: Centre[]
  downloaded: string
}

let cache: Promise<Centres | null> | null = null

/** public/data/acopio.json, or null when it is not there (the directory has not been downloaded yet). */
export function loadCentres(base: string, fetcher: typeof fetch = fetch): Promise<Centres | null> {
  cache ??= fetcher(`${base}data/acopio.json`)
    .then((r) => (r.ok ? (r.json() as Promise<AcopioFile>) : null))
    .then((file) => (file && Array.isArray(file.centros) ? { centres: centresOf(file), downloaded: file.downloaded } : null))
    .catch(() => null)
  return cache
}

/** For tests. */
export const resetCentres = () => {
  cache = null
}
