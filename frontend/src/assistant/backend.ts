// Where a real language model would plug in. The assistant needs two things from a backend:
//  1. `interpret`: which of the project's models a message needs, and with which settings (the demo reads
//     keywords; an LLM could do this with tool calling over the model registry in models.ts);
//  2. optionally `narrate`: the plain-language summary (the demo fills templates from the results).
// Whatever the backend, the models themselves (run.ts) and their results are the same, and a narration must only
// restate numbers found in the outcomes it is given: the interface labels it as written by the backend.

import type { Lang } from '../lib/format.ts'
import type { SummaryItem } from './compose.ts'
import { interpret, type InterpretOptions } from './interpret.ts'
import type { Interpretation, Outcome, Settings } from './types.ts'

export interface AssistantBackend {
  /** `demo`: keyword rules and templates, no language model. */
  readonly kind: 'demo' | 'llm'
  readonly label: string
  interpret(message: string, base: Settings, options: InterpretOptions): Promise<Interpretation> | Interpretation
  narrate?(outcomes: Outcome[], interpretation: Interpretation, language: Lang): Promise<SummaryItem[]>
}

export const demoBackend: AssistantBackend = {
  kind: 'demo',
  label: 'keyword rules + templates',
  interpret,
}
