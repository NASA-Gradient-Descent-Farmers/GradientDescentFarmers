import { useEffect, useState } from 'react'
import { DEMO_LOCATIONS } from '../lib/demoLocations.ts'
import { loadEnvironment, type EnvironmentByLocation } from '../lib/environment.ts'
import { loadRotations, type RotationsByLocation } from '../lib/rotations.ts'

export interface Published {
  rotations: RotationsByLocation
  environment: EnvironmentByLocation
}

let loading: Promise<Published> | null = null

/**
 * Everything the data service published for the demonstration places (rotation results and environmental packages),
 * loaded once for the whole app. null while loading; a file that is missing or invalid is simply absent, so the pages
 * fall back to what they said before.
 */
export function useZoneData(): Published | null {
  const [value, setValue] = useState<Published | null>(null)
  useEffect(() => {
    let alive = true
    loading ??= (async () => {
      const base = import.meta.env.BASE_URL
      const withRotations = DEMO_LOCATIONS.filter((place) => place.results === 'rotations').map((place) => place.id)
      const [rotations, environment] = await Promise.all([loadRotations(withRotations, base), loadEnvironment(DEMO_LOCATIONS.map((place) => place.id), base)])
      return { rotations, environment }
    })()
    void loading.then((loaded) => alive && setValue(loaded))
    return () => {
      alive = false
    }
  }, [])
  return value
}
