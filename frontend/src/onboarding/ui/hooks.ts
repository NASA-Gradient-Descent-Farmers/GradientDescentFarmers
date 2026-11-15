import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { fetchClimate } from '../../lib/climate.ts'
import type { LatLon } from '../../lib/geo.ts'
import type { StepId } from '../types.ts'

/** What each question has typed in but not yet confirmed, kept while the farmer goes back and forth. */
export type Drafts = Map<StepId, unknown>

export function useDraft<T>(drafts: Drafts, step: StepId, initial: () => T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => (drafts.has(step) ? (drafts.get(step) as T) : initial()))
  useEffect(() => {
    drafts.set(step, value)
  }, [drafts, step, value])
  return [value, setValue]
}

/** Where a question sits in the run, and how to leave it. */
export interface Position {
  /** 1-based number of this question among those being asked, and how many there are. */
  number: number
  total: number
  /** Changing one answer from the summary: the question is shown alone and leads back to it. */
  editing: boolean
  onBack: () => void
}

export type Rain = { state: 'loading' } | { state: 'ready'; monthlyMm: number[] } | { state: 'unavailable' }

/** NASA POWER's monthly rain at the pin (asked once per 0.1° cell and kept); the question works the same without it. */
export function useRain(pin: LatLon | null): Rain {
  const [settled, setSettled] = useState<{ key: string; monthlyMm: number[] | null } | null>(null)
  const key = pin ? `${pin.lat.toFixed(1)},${pin.lon.toFixed(1)}` : ''
  useEffect(() => {
    if (!pin) return
    const controller = new AbortController()
    fetchClimate(pin, controller.signal).then(
      (climate) => setSettled({ key, monthlyMm: climate.rainMonthlyMm }),
      (error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setSettled({ key, monthlyMm: null })
      },
    )
    return () => controller.abort()
    // the pin is represented by its 0.1-degree cell
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  if (!pin) return { state: 'unavailable' }
  if (!settled || settled.key !== key) return { state: 'loading' }
  return settled.monthlyMm ? { state: 'ready', monthlyMm: settled.monthlyMm } : { state: 'unavailable' }
}
