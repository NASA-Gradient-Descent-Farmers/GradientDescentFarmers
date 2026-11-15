import { useI18n } from '../../../i18n/index.tsx'
import { describeAnswer } from '../../describe.ts'
import { STEPS, type StepId } from '../../types.ts'
import { useEffect, useRef } from 'react'
import type { StepProps } from './types.ts'

interface Props extends Pick<StepProps, 'profile' | 'pin' | 'data'> {
  /** Open one question again, alone, and come back here. */
  onEdit: (step: StepId) => void
  onBack: () => void
  /** Hand the answers to the assistant. */
  onFinish: () => void
  /** Forget every answer on this device and start over. */
  onClear: () => void
  /** Leaves the questionnaire (the summary was opened from the assistant or the home page). */
  fromElsewhere: boolean
}

/** The last screen: every answer, editable, with how the models will use it; nothing is sent until the farmer confirms. */
export function SummaryStep({ profile, pin, data, onEdit, onBack, onFinish, onClear, fromElsewhere }: Props) {
  const i18n = useI18n()
  const { t } = i18n
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [])
  const ready = profile.crops !== undefined && pin !== null

  return (
    <section className="ob-card wide" aria-labelledby="ob-title">
      <p className="ob-eyebrow">{t('onboarding.summary.eyebrow')}</p>
      <h1 id="ob-title" className="ob-title" tabIndex={-1} ref={heading}>
        {t('onboarding.summary.title')}
      </h1>
      <p className="ob-help">{t('onboarding.summary.help')}</p>

      <dl className="ob-summary">
        {STEPS.map((step) => {
          const described = describeAnswer(step, profile, pin, data.meta, i18n)
          return (
            <div key={step} className={`ob-row-summary ${described.state}`}>
              <dt>{t(`onboarding.steps.${step}.short`)}</dt>
              <dd>
                <span className="ob-answer">{described.state === 'open' ? t('onboarding.summary.open') : described.value}</span>
                {described.used && <small>{described.used}</small>}
              </dd>
              <dd className="ob-edit">
                <button type="button" className="link-quiet" onClick={() => onEdit(step)} aria-label={t('onboarding.summary.editAria', { question: t(`onboarding.steps.${step}.short`) })}>
                  {described.state === 'open' ? t('onboarding.summary.answer') : t('onboarding.summary.change')}
                </button>
              </dd>
            </div>
          )
        })}
      </dl>

      {!ready && (
        <p className="ob-problem" role="alert">
          {t('onboarding.summary.needs')}
        </p>
      )}

      <div className="ob-actions">
        <button type="button" className="ob-back" onClick={onBack}>
          ← {fromElsewhere ? t('onboarding.summary.leave') : t('onboarding.back')}
        </button>
        <button type="button" className="ob-skip" onClick={onClear}>
          {t('onboarding.summary.clear')}
        </button>
        <button type="button" className="cv-button ob-next" disabled={!ready} onClick={onFinish}>
          {t('onboarding.summary.finish')}
        </button>
      </div>
      <p className="ob-muted small">{t('onboarding.summary.privacy')}</p>
    </section>
  )
}
