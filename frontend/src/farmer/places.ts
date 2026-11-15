// Finding a place by name, with no network: the municipality catalogue ships with the app (public/data/municipios.json,
// from the INEGI catalogue of localities held in this repository). Only municipalities are listed, not every locality.

import type { LatLon } from '../lib/geo.ts'

export interface Place {
  municipality: string
  state: string
  /** The median position of the municipality's rural localities (its seat when there are fewer than three). */
  point: LatLon
}

export interface IndexedPlace {
  place: Place
  /** The municipality name and the whole label, lower case and without accents. */
  name: string
  full: string
}

/** INEGI calls the state "México"; farmers say "Estado de México". */
export const stateLabel = (state: string) => (state === 'México' ? 'Estado de México' : state)

export const placeLabel = ({ municipality, state }: Place) => `${municipality}, ${state}`

/** Lower case, no accents, only letters and digits separated by single spaces: what searches are compared on. */
export const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** The places in the file as written; rows that are not a place on Earth are skipped. */
export function parsePlaces(file: unknown): Place[] {
  const rows = (file as { places?: unknown } | null)?.places
  if (!Array.isArray(rows)) throw new Error('municipios.json has no list of places')
  const places: Place[] = []
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 4) continue
    const [state, municipality, lat, lon] = row as unknown[]
    if (typeof state !== 'string' || typeof municipality !== 'string' || typeof lat !== 'number' || typeof lon !== 'number') continue
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
    places.push({ municipality, state: stateLabel(state), point: { lat, lon } })
  }
  if (places.length === 0) throw new Error('municipios.json has no usable place')
  return places
}

export const indexPlaces = (places: Place[]): IndexedPlace[] =>
  places.map((place) => ({ place, name: fold(place.municipality), full: fold(placeLabel(place)) }))

/**
 * Places whose name (and state) contain every word typed, best first: the exact name, then names that start with the
 * text, then names with a word that starts with it, then the rest. Equal ranks go shortest name first.
 */
export function searchPlaces(index: IndexedPlace[], query: string, limit = 6): Place[] {
  const q = fold(query)
  if (q.length < 2) return []
  const words = q.split(' ')
  const hits: { rank: number; length: number; place: Place }[] = []
  for (const { place, name, full } of index) {
    if (!words.every((word) => full.includes(word))) continue
    const rank = name === q ? 0 : name.startsWith(q) ? 1 : name.split(' ').some((part) => part.startsWith(words[0])) ? 2 : words.every((w) => name.includes(w)) ? 3 : 4
    hits.push({ rank, length: name.length, place })
  }
  hits.sort((a, b) => a.rank - b.rank || a.length - b.length || a.place.municipality.localeCompare(b.place.municipality, 'es'))
  return hits.slice(0, limit).map((hit) => hit.place)
}

let cache: Promise<IndexedPlace[]> | null = null

/** The catalogue, fetched once; a failed fetch is forgotten so the next search tries again. */
export function loadPlaces(): Promise<IndexedPlace[]> {
  cache ??= fetch(`${import.meta.env.BASE_URL}data/municipios.json`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`municipios.json: HTTP ${response.status}`)
      return indexPlaces(parsePlaces(await response.json()))
    })
    .catch((error: unknown) => {
      cache = null
      throw error
    })
  return cache
}
