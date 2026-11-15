import { useEffect, useState } from 'react'
import { DEMO_LOCATIONS } from '../lib/demoLocations.ts'
import { loadRotations, type RotationsByLocation } from '../lib/rotations.ts'

let loading: Promise<RotationsByLocation> | null = null

/**
 * The published rotation results, loaded once for the whole app. null while loading; a location whose file is missing or
 * invalid is simply absent, so the pages fall back to what they said before.
 */
export function useRotations(): RotationsByLocation | null {
  const [value, setValue] = useState<RotationsByLocation | null>(null)
  useEffect(() => {
    let alive = true
    loading ??= loadRotations(
      DEMO_LOCATIONS.filter((place) => place.results === 'rotations').map((place) => place.id),
      import.meta.env.BASE_URL,
    )
    void loading.then((loaded) => alive && setValue(loaded))
    return () => {
      alive = false
    }
  }, [])
  return value
}
