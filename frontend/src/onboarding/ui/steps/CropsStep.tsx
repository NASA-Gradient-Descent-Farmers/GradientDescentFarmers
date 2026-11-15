import { useState } from 'react'
import { useI18n } from '../../../i18n/index.tsx'
import { CROPS, type Crop } from '../../../lib/farm.ts'
import { list } from '../../../assistant/guidance.ts'
import { resolveCrops } from '../../resolve.ts'
import { Choice, StepFrame } from '../frame.tsx'
import { useDraft } from '../hooks.ts'
import type { StepProps } from './types.ts'

interface Draft {
  picked: string[]
  help: boolean
  other: string
}

/** "¿Qué piensas sembrar?": any of the crops the models cover, a way to name another, or "help me choose". */
export function CropsStep({ profile, drafts, position, commit }: StepProps) {
  const { t, fmt } = useI18n()
  const [draft, setDraft] = useDraft<Draft>(drafts, 'crops', () => ({
    picked: profile.crops && !profile.crops.help ? [...profile.crops.crops] : [],
    help: profile.crops?.help ?? false,
    other: profile.crops?.unmodelled.join(', ') ?? '',
  }))
  const [problem, setProblem] = useState(false)
  // Typed crops the models do not cover: the one focused follow-up of this question.
  const [followUp, setFollowUp] = useState<{ crops: Crop[]; unmodelled: string[] } | null>(null)

  const options = [
    ...CROPS.map((crop) => ({ id: crop, label: t(`crops.${crop}`), hint: t(`onboarding.crops.hint.${crop}`) })),
    { id: 'help', label: t('onboarding.crops.help'), hint: t('onboarding.crops.helpHint') },
  ]

  const finish = (help: boolean, crops: Crop[], unmodelled: string[]) => commit({ crops: { help, crops: help ? [] : crops, unmodelled } })

  const submit = () => {
    const outcome = resolveCrops(draft, followUp !== null)
    if (outcome.kind === 'empty') return setProblem(true)
    if (outcome.kind === 'followUp') return setFollowUp({ crops: outcome.crops, unmodelled: outcome.unmodelled })
    commit({ crops: outcome.answer })
  }

  const covered = list({ t, fmt }, CROPS.map((crop) => t(`crops.${crop}`).toLowerCase()))

  const notice = followUp ? (
    <div className="ob-followup" role="group" aria-label={t('onboarding.followUp')}>
      <strong>{t('onboarding.crops.unmodelledTitle', { names: followUp.unmodelled.join(', ') })}</strong>
      <p>{t('onboarding.crops.unmodelledBody', { covered })}</p>
      <div className="ob-followup-actions">
        <button type="button" className="chip-button strong" onClick={() => finish(true, [], followUp.unmodelled)}>
          {t('onboarding.crops.useHelp')}
        </button>
        {followUp.crops.length > 0 && (
          <button type="button" className="chip-button" onClick={() => finish(false, followUp.crops, followUp.unmodelled)}>
            {t('onboarding.crops.keep', { crops: list({ t, fmt }, followUp.crops.map((crop) => t(`crops.${crop}`).toLowerCase())) })}
          </button>
        )}
      </div>
    </div>
  ) : problem ? (
    <p className="ob-problem" role="alert">
      {t('onboarding.crops.empty')}
    </p>
  ) : null

  return (
    <StepFrame position={position} title={t('onboarding.steps.crops.title')} help={t('onboarding.steps.crops.help')} onSubmit={submit} notice={notice}>
      <Choice
        name="crops"
        legend={t('onboarding.steps.crops.title')}
        hideLegend
        type="checkbox"
        options={options}
        value={draft.help ? ['help'] : draft.picked}
        onChange={(next) => {
          setProblem(false)
          setFollowUp(null)
          // "Help me choose" and named crops exclude each other.
          if (next.includes('help') && !draft.help) setDraft({ ...draft, picked: [], help: true })
          else setDraft({ ...draft, picked: next.filter((id) => id !== 'help'), help: false })
        }}
      />
      <div className="ob-field">
        <label htmlFor="ob-other-crop">{t('onboarding.crops.otherLabel')}</label>
        <input
          id="ob-other-crop"
          type="text"
          autoComplete="off"
          value={draft.other}
          placeholder={t('onboarding.crops.otherPlaceholder')}
          onChange={(event) => {
            setProblem(false)
            setFollowUp(null)
            setDraft({ ...draft, other: event.target.value })
          }}
        />
        <small>{t('onboarding.crops.otherHint', { covered })}</small>
      </div>
    </StepFrame>
  )
}
