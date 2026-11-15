// "Use my location": the phone's own position, asked only when the farmer taps the button. A rough fix is enough (the
// models work at the scale of kilometres), which is also faster and kinder to cheap phones.

import type { LatLon } from '../lib/geo.ts'

export type GeoErrorCode = 'denied' | 'unavailable' | 'timeout' | 'unsupported'

export class GeoError extends Error {
  readonly code: GeoErrorCode
  constructor(code: GeoErrorCode) {
    super(code)
    this.code = code
  }
}

export function currentPosition(timeoutMs = 20000): Promise<LatLon> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new GeoError('unsupported'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      (error) => reject(new GeoError(error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable')),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 5 * 60 * 1000 },
    )
  })
}
