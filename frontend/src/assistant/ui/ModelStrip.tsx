import { useI18n } from '../../i18n/index.tsx'
import type { AssistantMessage } from '../history.ts'
import type { ModelId, Progress } from '../types.ts'

const GLYPH: Record<Progress, string> = { waiting: '○', running: '◐', done: '✓', failed: '!' }

/** The state of each model the question needed, as it really is: waiting, working, done or failed. */
export function ModelStrip({ message }: { message: AssistantMessage }) {
  const { t } = useI18n()
  const stateOf = (model: ModelId): Progress => {
    const outcome = message.outcomes.find((o) => o.model === model)
    if (outcome) return outcome.ok ? 'done' : 'failed'
    if (message.status === 'interrupted') return 'failed'
    return message.progress[model] ?? 'waiting'
  }
  return (
    <div className="model-strip">
      <span className="strip-label">{t('assistant.message.consulted')}</span>
      <ul>
        {message.interpretation.models.map((model) => {
          const state = stateOf(model)
          return (
            <li key={model} className={`state-${state}`}>
              <span className={`glyph${state === 'running' ? ' spin' : ''}`} aria-hidden="true">
                {GLYPH[state]}
              </span>
              <span>{t(`assistant.models.${model}.name`)}</span>
              <span className="state-text">{t(`assistant.progress.${state}`)}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
