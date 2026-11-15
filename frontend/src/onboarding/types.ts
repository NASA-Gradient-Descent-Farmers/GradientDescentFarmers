// What the onboarding collects. An answer is a value or an explicit "not sure"; a question never asked has no entry.

import type { Budget, Crop, Land, Planting, Priority, Water } from '../lib/farm.ts'

export type Answer<T> = { unsure: true } | { unsure: false; value: T }

export const sure = <T>(value: T): Answer<T> => ({ unsure: false, value })
export const unsure = <T>(): Answer<T> => ({ unsure: true })

/** `help`: the farmer asked to be helped to choose, so every rotation is compared. */
export interface CropsAnswer {
  help: boolean
  crops: Crop[]
  /** Crops the farmer typed that no model covers: kept to say so, never used. */
  unmodelled: string[]
}

export interface Profile {
  crops?: CropsAnswer
  land?: Answer<Land>
  when?: Answer<Planting>
  budget?: Answer<Budget>
  water?: Answer<Water>
  priority?: Answer<Priority>
  /** The farmer reached the summary and confirmed it: later visits skip the questions. */
  confirmed?: boolean
}

/** The questions in the order they are asked. `where` is the pin on the map, kept apart from the profile. */
export const STEPS = ['crops', 'where', 'land', 'when', 'budget', 'water', 'priority'] as const
export type StepId = (typeof STEPS)[number]

/** The rows of the summary: every step, in the same order. */
export type Step = StepId
