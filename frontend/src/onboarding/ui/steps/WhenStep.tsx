import { useState } from 'react'
import { describePlanting } from '../../../assistant/guidance.ts'
import { useI18n } from '../../../i18n/index.tsx'
import { CROPS, PARTS, sowingDates, type Part, type Planting } from '../../../lib/farm.ts'
import { capitalize } from '../../../lib/format.ts'
import { readWhen } from '../../read.ts'
import { resolveWhen } from '../../resolve.ts'
import { sure, unsure } from '../../types.ts'
import { Choice, StepFrame } from '../frame.tsx'
import { useDraft, useRain } from '../hooks.ts'
import type { StepProps } from './types.ts'

type Pick = Planting | null

interface Draft {
  pick: Pick
  text: string
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i)

/** "¿Cuándo piensas sembrar?": a month and perhaps a third of it, "when the rains start", or a few words; approximate is fine. */
export function WhenStep({ profile, pin, data, drafts, position, commit }: StepProps) {
  const { t, fmt } = useI18n()
  const say = { t, fmt }
  const [draft, setDraft] = useDraft<Draft>(drafts, 'when', () => ({ pick: profile.when && !profile.when.unsure ? profile.when.value : null, text: '' }))
  const [notice, setNotice] = useState<{ kind: 'empty' | 'unclear' | 'several'; text: string; months: number[] } | null>(null)
  const rain = useRain(pin)

  const month = draft.pick?.kind === 'month' ? draft.pick : null
  const typed = draft.text.trim() !== '' ? readWhen(draft.text) : null
  const peak = rain.state === 'ready' ? Math.max(...rain.monthlyMm) : 0
  const choose = (pick: Pick, text = '') => {
    setNotice(null)
    setDraft({ pick, text })
  }

  const submit = () => {
    const outcome = resolveWhen(draft)
    if (outcome.kind === 'done') return commit({ when: sure(outcome.planting) })
    setNotice({ kind: outcome.problem, text: outcome.text, months: outcome.months })
  }

  // The crops whose sowing the model decides: the ones asked for, or all of them.
  const crops = profile.crops && !profile.crops.help && profile.crops.crops.length > 0 ? profile.crops.crops : [...CROPS]
  const rules = crops.flatMap((crop) => {
    const dates = sowingDates(crop, data.meta.sowing)
    return dates ? [{ crop, dates }] : []
  })

  const followUp =
    notice?.kind === 'several' ? (
      <div className="ob-followup" role="group" aria-label={t('onboarding.followUp')}>
        <strong>{t('onboarding.when.several')}</strong>
        <div className="ob-followup-actions">
          {notice.months.map((m) => (
            <button key={m} type="button" className="chip-button strong" onClick={() => commit({ when: sure({ kind: 'month', month: m, part: null }) })}>
              {capitalize(fmt.monthLong(m))}
            </button>
          ))}
        </div>
      </div>
    ) : notice ? (
      <p className="ob-problem" role="alert">
        {t(`onboarding.when.${notice.kind}`, { text: notice.text })}
      </p>
    ) : null

  return (
    <StepFrame
      position={position}
      title={t('onboarding.steps.when.title')}
      help={t('onboarding.steps.when.help')}
      onSubmit={submit}
      notice={followUp}
      skip={{ label: t('onboarding.skipNotYet'), onSkip: () => commit({ when: unsure() }) }}
    >
      <fieldset className="ob-choice months">
        <legend className="ob-legend">{t('onboarding.when.month')}</legend>
        <div className="ob-options">
          {MONTHS.map((m) => {
            const mm = rain.state === 'ready' ? rain.monthlyMm[m] : null
            return (
              <label key={m} className="ob-option">
                <input
                  type="radio"
                  name="month"
                  value={m}
                  checked={month?.month === m}
                  onChange={() => choose({ kind: 'month', month: m, part: month?.part ?? null })}
                />
                <span className="ob-face">
                  <span className="ob-label">{capitalize(fmt.monthLong(m))}</span>
                  {mm !== null && (
                    <span className="ob-rain" title={t('onboarding.when.rainTitle', { mm: fmt.number(mm) })}>
                      <span className="ob-rain-bar" style={{ width: `${peak > 0 ? Math.max(4, (mm / peak) * 100) : 0}%` }} />
                      <small>{fmt.number(mm)} mm</small>
                    </span>
                  )}
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>
      <p className="ob-muted small">
        {rain.state === 'ready' ? t('onboarding.when.rainSource') : rain.state === 'loading' ? t('onboarding.when.rainLoading') : t('onboarding.when.rainMissing')}
      </p>

      <Choice
        name="part"
        legend={t('onboarding.when.part')}
        type="radio"
        options={[
          { id: 'any', label: t('onboarding.when.parts.any') },
          ...PARTS.map((part) => ({ id: part, label: t(`onboarding.when.parts.${part}`) })),
        ]}
        value={month ? [month.part ?? 'any'] : []}
        onChange={([part]) => month && choose({ kind: 'month', month: month.month, part: part === 'any' ? null : (part as Part) })}
      />

      <Choice
        name="rains"
        legend={t('onboarding.when.other')}
        hideLegend
        type="checkbox"
        options={[{ id: 'rains', label: t('onboarding.when.rains') }]}
        value={draft.pick?.kind === 'rains' ? ['rains'] : []}
        onChange={(next) => choose(next.includes('rains') ? { kind: 'rains' } : null)}
      />

      <div className="ob-field">
        <label htmlFor="ob-when-text">{t('onboarding.when.textLabel')}</label>
        <input
          id="ob-when-text"
          type="text"
          autoComplete="off"
          value={draft.text}
          placeholder={t('onboarding.when.textPlaceholder')}
          onChange={(event) => {
            setNotice(null)
            setDraft({ pick: null, text: event.target.value })
          }}
        />
        {typed?.ok && <small className="ob-read">{t('onboarding.when.understood', { when: describePlanting(typed.planting, say) })}</small>}
      </div>

      <details className="ob-more">
        <summary>{t('onboarding.when.ruleTitle')}</summary>
        <p>{t('onboarding.when.rule', { mm: data.meta.sowing.onset_rain_mm, days: data.meta.sowing.onset_rain_days, window: data.meta.sowing.window_days })}</p>
        <ul>
          {rules.map(({ crop, dates }) => (
            <li key={crop}>
              {t('onboarding.when.ruleCrop', {
                crop: t(`crops.${crop}`),
                from: t('assistant.guidance.date', { day: dates.from.day, month: fmt.monthLong(dates.from.month) }),
              })}
            </li>
          ))}
        </ul>
      </details>
    </StepFrame>
  )
}
