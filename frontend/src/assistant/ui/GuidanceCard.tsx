import { useMemo } from 'react'
import { useI18n } from '../../i18n/index.tsx'
import { COST_KEEP, weightsFor } from '../../lib/farm.ts'
import { OBJECTIVES, type Meta } from '../../lib/types.ts'
import type { Say } from '../compose.ts'
import { guide } from '../guidance.ts'
import type { FarmInputs, PlannerResult } from '../types.ts'

interface Props {
  farm: FarmInputs
  result: PlannerResult
  meta: Meta
  /** Open the farmer's answers to review or change them, if there is a way to. */
  onEdit?: () => void
}

const MARK = { good: '✓', note: '•', warn: '!' } as const

/** The farmer's answers, one line each: what they did to the plan, and what kind of statement the line is. */
export function GuidanceCard({ farm, result, meta, onEdit }: Props) {
  const { t, fmt } = useI18n()
  const items = useMemo(() => guide(farm, result, meta, { t, fmt } satisfies Say), [farm, result, meta, t, fmt])
  const weights = result.preset === 'costs' ? null : weightsFor(result.preset, meta)
  const limits = result.limits

  return (
    <section className="guidance" aria-label={t('assistant.guidance.title')}>
      <header>
        <h3>{t('assistant.guidance.title')}</h3>
        {onEdit && (
          <button type="button" className="link" onClick={onEdit}>
            {t('assistant.guidance.edit')}
          </button>
        )}
      </header>
      <p className="guidance-intro">{t('assistant.guidance.intro')}</p>
      <ul>
        {items.map((item, i) => (
          <li key={i} className={item.tone}>
            <span className="mark" aria-hidden="true">
              {MARK[item.tone]}
            </span>
            <span className={`tag basis-${item.basis}`}>{t(`assistant.guidance.basis.${item.basis}`)}</span>
            {item.text}
          </li>
        ))}
      </ul>
      <p className="summary-note">{t('assistant.guidance.placeholders')}</p>
      <details className="tech">
        <summary>{t('assistant.guidance.details')}</summary>
        <div className="tech-body">
          <p>{t('assistant.guidance.detailsRotations', { rotations: (limits?.rotations ?? farm.rotations).map((r) => t(`rotations.${r}`)).join(' · ') })}</p>
          <p>
            {limits?.capPerHa != null ? t('assistant.guidance.detailsCap', { cap: fmt.number(limits.capPerHa) }) : t('assistant.guidance.detailsNoCap')}
          </p>
          {weights ? (
            <>
              <p>{t('assistant.guidance.detailsWeights', { preset: t(`assistant.presets.${result.preset}`) })}</p>
              <table>
                <tbody>
                  {OBJECTIVES.map((key) => (
                    <tr key={key}>
                      <th scope="row">{t(`objectives.${key}.name`)}</th>
                      <td className="num">{fmt.number(weights[key], 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p>{t('assistant.guidance.detailsRule', { share: fmt.percent(COST_KEEP) })}</p>
          )}
        </div>
      </details>
    </section>
  )
}
