import type { ModelId, ScenarioId } from './types.ts'

export interface ModelInfo {
  id: ModelId
  /** `live`: computed in the browser from the exported grid or asked of NASA now. `stored`: results saved from a run of the Python code. */
  kind: 'live' | 'stored'
  needsInternet: boolean
  needsPin: boolean
}

export const MODELS: ModelInfo[] = [
  { id: 'planner', kind: 'live', needsInternet: false, needsPin: false },
  { id: 'climate', kind: 'live', needsInternet: true, needsPin: true },
  { id: 'risk', kind: 'stored', needsInternet: false, needsPin: false },
  { id: 'calibration', kind: 'stored', needsInternet: false, needsPin: false },
  { id: 'statistical', kind: 'stored', needsInternet: false, needsPin: false },
]

/** Capabilities the project plans but has not built: listed so nobody expects them. */
export const NOT_AVAILABLE = ['rl'] as const

export const SCENARIOS: ScenarioId[] = ['rain80', 'rain60', 'canicula50', 'frost_minus2', 'no_fertilizer', 'fixed_sowing']

/** The scenarios about short rain: what a farmer who wants to save water is shown. */
export const DRY_SCENARIOS: ScenarioId[] = ['rain80', 'rain60', 'canicula50']

export const modelInfo = (id: ModelId): ModelInfo => MODELS.find((m) => m.id === id)!
export const byModelOrder = (a: ModelId, b: ModelId) => MODELS.findIndex((m) => m.id === a) - MODELS.findIndex((m) => m.id === b)
