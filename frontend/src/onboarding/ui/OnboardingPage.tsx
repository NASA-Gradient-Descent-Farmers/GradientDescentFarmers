import { useEffect, useState } from 'react'
import { LangToggle } from '../../components/LangToggle.tsx'
import { LeafMark } from '../../components/Leaf.tsx'
import { useI18n } from '../../i18n/index.tsx'
import type { LatLon } from '../../lib/geo.ts'
import type { DashboardData } from '../../lib/types.ts'
import { stepsToAsk } from '../profile.ts'
import type { Profile, StepId } from '../types.ts'
import type { Drafts, Position } from './hooks.ts'
import { BudgetStep } from './steps/BudgetStep.tsx'
import { PriorityStep, WaterStep } from './steps/ChoiceSteps.tsx'
import { CropsStep } from './steps/CropsStep.tsx'
import { LandStep } from './steps/LandStep.tsx'
import { SummaryStep } from './steps/SummaryStep.tsx'
import type { StepProps } from './steps/types.ts'
import { WhenStep } from './steps/WhenStep.tsx'
import { WhereStep } from './steps/WhereStep.tsx'

/** How the questionnaire opens: at the first question still to ask, at the summary, or on one answer alone. */
export type Start = { kind: 'ask' } | { kind: 'summary' } | { kind: 'edit'; step: StepId }

interface Props {
  data: DashboardData
  site: LatLon
  profile: Profile
  pin: LatLon | null
  start: Start
  /** Keep the answers (called after every question). */
  onProfile: (profile: Profile) => void
  onPin: (pin: LatLon) => void
  /** The farmer confirmed the summary. */
  onFinish: (profile: Profile) => void
  /** Leave without finishing: back to where the farmer came from. */
  onExit: () => void
  /** Go straight to the assistant with whatever is known. */
  onSkipAll: () => void
  onClear: () => void
}

type View = { kind: 'step'; step: StepId } | { kind: 'summary' }

/**
 * Conversational onboarding: one question per screen, only the ones the models still need, an editable summary at the
 * end. Answers are kept as they are given, so leaving and coming back (or going back one question) loses nothing.
 */
export function OnboardingPage({ data, site, profile, pin, start, onProfile, onPin, onFinish, onExit, onSkipAll, onClear }: Props) {
  const { t } = useI18n()
  // The questions of this run are decided once: they do not shift under the farmer as answers come in.
  const [run] = useState<StepId[]>(() => (start.kind === 'ask' ? stepsToAsk(profile, pin) : []))
  const [view, setView] = useState<View>(() =>
    start.kind === 'edit' ? { kind: 'step', step: start.step } : start.kind === 'ask' && run.length > 0 ? { kind: 'step', step: run[0] } : { kind: 'summary' },
  )
  const [editing, setEditing] = useState<StepId | null>(start.kind === 'edit' ? start.step : null)
  const [drafts] = useState<Drafts>(() => new Map())

  const viewKey = view.kind === 'summary' ? 'summary' : view.step
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [viewKey])

  const toSummary = () => {
    setEditing(null)
    setView({ kind: 'summary' })
  }
  const advance = (step: StepId) => {
    drafts.delete(step)
    const index = run.indexOf(step)
    if (editing || index < 0 || index + 1 >= run.length) toSummary()
    else setView({ kind: 'step', step: run[index + 1] })
  }
  const back = (step: StepId) => {
    const index = run.indexOf(step)
    if (editing) toSummary()
    else if (index > 0) setView({ kind: 'step', step: run[index - 1] })
    else onExit()
  }

  const props = (step: StepId): StepProps => {
    const index = run.indexOf(step)
    const position: Position = { number: Math.max(index, 0) + 1, total: Math.max(run.length, 1), editing: editing !== null, onBack: () => back(step) }
    return {
      profile,
      pin,
      data,
      site,
      drafts,
      position,
      commit: (patch) => {
        onProfile({ ...profile, ...patch })
        advance(step)
      },
    }
  }

  let body
  if (view.kind === 'summary') {
    body = (
      <SummaryStep
        key="summary"
        profile={profile}
        pin={pin}
        data={data}
        fromElsewhere={run.length === 0}
        onEdit={(step) => {
          setEditing(step)
          setView({ kind: 'step', step })
        }}
        onBack={() => (run.length > 0 ? setView({ kind: 'step', step: run[run.length - 1] }) : onExit())}
        onFinish={() => onFinish({ ...profile, confirmed: true })}
        onClear={onClear}
      />
    )
  } else {
    const step = view.step
    const common = props(step)
    switch (step) {
      case 'crops':
        body = <CropsStep key={step} {...common} />
        break
      case 'where':
        body = (
          <WhereStep
            key={step}
            {...common}
            onPin={(point) => {
              onPin(point)
              advance(step)
            }}
          />
        )
        break
      case 'land':
        body = <LandStep key={step} {...common} />
        break
      case 'when':
        body = <WhenStep key={step} {...common} />
        break
      case 'budget':
        body = <BudgetStep key={step} {...common} />
        break
      case 'water':
        body = <WaterStep key={step} {...common} />
        break
      case 'priority':
        body = <PriorityStep key={step} {...common} />
        break
    }
  }

  const index = view.kind === 'step' ? run.indexOf(view.step) : run.length
  const showProgress = run.length > 0 && editing === null && index >= 0
  const steps = run.length + 1 // the questions and the summary

  return (
    <div className="ob">
      <div className="ob-top">
        <button type="button" className="brand-link ob-brand" onClick={onExit} aria-label={t('onboarding.leave')}>
          <LeafMark className="brand-leaf" />
          <span className="brand-name">{t('app.title')}</span>
        </button>
        <div className="ob-top-end">
          <button type="button" className="link-quiet" onClick={onSkipAll}>
            {t('onboarding.skipAll')}
          </button>
          <LangToggle />
        </div>
      </div>
      {showProgress && (
        <div
          className="ob-progress"
          role="progressbar"
          aria-label={t('onboarding.label')}
          aria-valuemin={1}
          aria-valuemax={steps}
          aria-valuenow={index + 1}
          aria-valuetext={view.kind === 'summary' ? t('onboarding.summary.eyebrow') : t('onboarding.progress', { n: index + 1, total: run.length })}
        >
          <span style={{ width: `${((index + 1) / steps) * 100}%` }} />
        </div>
      )}
      <main className="ob-main">{body}</main>
    </div>
  )
}
