import { useState } from 'react'
import { useI18n } from '../../../i18n/index.tsx'
import { PRIORITIES, WATER, type Priority, type Water } from '../../../lib/farm.ts'
import { sure, unsure } from '../../types.ts'
import { Choice, StepFrame } from '../frame.tsx'
import { useDraft } from '../hooks.ts'
import type { StepProps } from './types.ts'

const NOT_SURE = 'unsure'

/** "¿Tienes acceso a riego?": the models know rain-fed farming only, and the question says so once irrigation is mentioned. */
export function WaterStep({ profile, drafts, position, commit }: StepProps) {
  const { t } = useI18n()
  const [pick, setPick] = useDraft<string | null>(drafts, 'water', () => (profile.water ? (profile.water.unsure ? NOT_SURE : profile.water.value) : null))
  const [missing, setMissing] = useState(false)

  const submit = () => {
    if (pick === null) return setMissing(true)
    commit({ water: pick === NOT_SURE ? unsure() : sure(pick as Water) })
  }
  const irrigated = pick === 'some' || pick === 'regular'

  return (
    <StepFrame
      position={position}
      title={t('onboarding.steps.water.title')}
      help={t('onboarding.steps.water.help')}
      onSubmit={submit}
      notice={
        irrigated ? (
          <p className="ob-limit" role="note">
            <strong>{t('onboarding.water.limitTitle')}</strong> {t('onboarding.water.limitBody')}
          </p>
        ) : missing ? (
          <p className="ob-problem" role="alert">
            {t('onboarding.pickOne')}
          </p>
        ) : null
      }
    >
      <Choice
        name="water"
        legend={t('onboarding.steps.water.title')}
        hideLegend
        type="radio"
        variant="cards"
        options={[...WATER, NOT_SURE].map((id) => ({ id, label: t(`onboarding.water.options.${id}.label`), hint: t(`onboarding.water.options.${id}.hint`) }))}
        value={pick ? [pick] : []}
        onChange={([id]) => {
          setMissing(false)
          setPick(id)
        }}
      />
    </StepFrame>
  )
}

/** "¿Qué es lo más importante para ti esta temporada?": what the planner weighs, in the farmer's words. */
export function PriorityStep({ profile, drafts, position, commit }: StepProps) {
  const { t } = useI18n()
  const [pick, setPick] = useDraft<string | null>(drafts, 'priority', () => (profile.priority ? (profile.priority.unsure ? NOT_SURE : profile.priority.value) : null))
  const [missing, setMissing] = useState(false)

  const submit = () => {
    if (pick === null) return setMissing(true)
    commit({ priority: pick === NOT_SURE ? unsure() : sure(pick as Priority) })
  }

  return (
    <StepFrame
      position={position}
      title={t('onboarding.steps.priority.title')}
      help={t('onboarding.steps.priority.help')}
      onSubmit={submit}
      notice={
        pick === 'water' ? (
          <p className="ob-limit" role="note">
            <strong>{t('onboarding.priority.waterTitle')}</strong> {t('onboarding.priority.waterBody')}
          </p>
        ) : missing ? (
          <p className="ob-problem" role="alert">
            {t('onboarding.pickOne')}
          </p>
        ) : null
      }
    >
      <Choice
        name="priority"
        legend={t('onboarding.steps.priority.title')}
        hideLegend
        type="radio"
        variant="cards"
        options={[...PRIORITIES, NOT_SURE].map((id) => ({
          id,
          label: t(`onboarding.priority.options.${id}.label`),
          hint: t(`onboarding.priority.options.${id}.hint`),
          tag: id === 'water' ? t('onboarding.priority.closest') : undefined,
        }))}
        value={pick ? [pick] : []}
        onChange={([id]) => {
          setMissing(false)
          setPick(id)
        }}
      />
    </StepFrame>
  )
}
