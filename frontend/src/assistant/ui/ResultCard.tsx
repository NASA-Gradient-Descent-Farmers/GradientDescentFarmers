import type { ReactNode } from 'react'
import { useI18n } from '../../i18n/index.tsx'
import { modelInfo } from '../models.ts'
import type { ModelId } from '../types.ts'

/** The frame of one model's result: who produced it, what kind of result it is, the body, and technical details. */
export function ResultCard({ model, children, details }: { model: ModelId; children: ReactNode; details?: ReactNode }) {
  const { t } = useI18n()
  const info = modelInfo(model)
  return (
    <section className={`result-card model-${model}`} aria-label={t(`assistant.models.${model}.name`)}>
      <header className="result-head">
        <h4>{t(`assistant.models.${model}.name`)}</h4>
        <span className={`badge kind-${info.kind}`}>{t(`assistant.panel.status.${info.kind}`)}</span>
      </header>
      <div className="result-body">{children}</div>
      {details && (
        <details className="tech">
          <summary>{t('assistant.message.details')}</summary>
          <div className="tech-body">{details}</div>
        </details>
      )}
    </section>
  )
}

/** Source files with the start of their hash: enough to tell which saved run a result came from. */
export function Sources({ files }: { files: { file: string; sha256: string }[] }) {
  const { t } = useI18n()
  return (
    <div>
      <h5>{t('assistant.details.sources')}</h5>
      <ul className="sources">
        {files.map((f) => (
          <li key={f.file}>
            <code>{f.file}</code> <span className="hash">{f.sha256.slice(0, 10)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
