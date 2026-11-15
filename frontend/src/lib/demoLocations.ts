// The three demonstration locations, in one place. The WhatsApp simulator reads them from here and nothing else defines
// a location. They are reference points for the demo, not verified agricultural parcels.
//
// `results` says what model output exists for the point:
//   'experimental'  the bundled model results (computed for El Batán, Texcoco) may be shown, always labelled as
//                   experimental demonstration data;
//   'rotations'     the rotations service published results for this point (public/data/rotations/<id>.json): shown
//                   when that file loaded, always as exploratory scenarios; when it did not, as "data unavailable";
//   null            no model results: the simulator shows "data unavailable" and never borrows another location's.

import { distanceKm, type LatLon } from './geo.ts'

export const DEMO_LOCATION_IDS = ['guanajuato', 'sinaloa', 'sonora'] as const
export type DemoLocationId = (typeof DEMO_LOCATION_IDS)[number]

export interface DemoLocation {
  id: DemoLocationId
  name: string
  latitude: number
  longitude: number
  results: 'experimental' | 'rotations' | null
}

export const DEMO_LOCATIONS: readonly DemoLocation[] = [
  { id: 'guanajuato', name: 'Guanajuato', latitude: 20.4243195, longitude: -101.1466639, results: 'experimental' },
  { id: 'sinaloa', name: 'Sinaloa', latitude: 25.7636111, longitude: -108.8613889, results: 'rotations' },
  { id: 'sonora', name: 'Sonora', latitude: 27.332202, longitude: -110.162783, results: 'rotations' },
]

export const demoLocation = (id: DemoLocationId): DemoLocation => DEMO_LOCATIONS.find((place) => place.id === id)!

/** The demonstration place closest to a point, and how far it is. */
export function nearestDemoLocation(point: LatLon): { place: DemoLocation; km: number } {
  let best = { place: DEMO_LOCATIONS[0], km: Infinity }
  for (const place of DEMO_LOCATIONS) {
    const km = distanceKm(point, { lat: place.latitude, lon: place.longitude })
    if (km < best.km) best = { place, km }
  }
  return best
}
