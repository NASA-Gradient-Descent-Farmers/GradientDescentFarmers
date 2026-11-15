import { useState } from 'react'
import { useI18n } from '../../../i18n/index.tsx'
import { AREA_UNITS, toHectares, type AreaUnit, type Land } from '../../../lib/farm.ts'
import { toInput } from '../../../lib/numberInput.ts'
import { readArea } from '../../read.ts'
import { otherUnit, resolveLand } from '../../resolve.ts'
import { sure, unsure } from '../../types.ts'
import { Choice, StepFrame } from '../frame.tsx'
import { useDraft } from '../hooks.ts'
import type { StepProps } from './types.ts'

const SIZES = [0.5, 1, 2, 5, 10] // hectares: a few sizes of plot to start from

type Problem = 'empty' | 'unreadable' | 'notPositive' | 'tooSmall' | 'tooLarge'

/** "¿Cuánta tierra vas a usar?": a number with a unit, a few common sizes, and a question when the figure and unit do not fit. */
export function LandStep({ profile, drafts, position, commit }: StepProps) {
  const { t, fmt } = useI18n()
  const known = profile.land && !profile.land.unsure ? profile.land.value : null
  const [draft, setDraft] = useDraft(drafts, 'land', () => ({ text: known ? toInput(known.amount) : '', unit: (known?.unit ?? 'ha') as AreaUnit }))
  const [problem, setProblem] = useState<{ text: string; kind: Problem } | null>(null)
  // The figure and the unit may not belong together (500 ha, 20 m²): ask which was meant.
  const [ask, setAsk] = useState<Land | null>(null)

  const read = readArea(draft.text, draft.unit)
  const unitName = (unit: AreaUnit) => t(`onboarding.land.units.${unit}`)
  const describe = (land: Land) => `${Number.isInteger(land.amount) ? fmt.number(land.amount) : toInput(land.amount)} ${unitName(land.unit)}`

  const edit = (text: string, unit: AreaUnit) => {
    setProblem(null)
    setAsk(null)
    setDraft({ text, unit })
  }

  const submit = () => {
    const outcome = resolveLand(draft.text, draft.unit)
    if (outcome.kind === 'problem') return setProblem({ text: draft.text.trim(), kind: outcome.problem })
    if (outcome.kind === 'ask') return setAsk(outcome.land)
    commit({ land: sure(outcome.land) })
  }

  const hectares = read.ok && read.land.unit !== 'ha' ? toHectares(read.land) : null

  const notice = ask ? (
    <div className="ob-followup" role="group" aria-label={t('onboarding.followUp')}>
      <strong>{t('onboarding.land.askUnit', { land: describe(ask) })}</strong>
      <div className="ob-followup-actions">
        <button type="button" className="chip-button strong" onClick={() => commit({ land: sure(ask) })}>
          {t('onboarding.land.askYes', { land: describe(ask) })}
        </button>
        <button type="button" className="chip-button" onClick={() => commit({ land: sure(otherUnit(ask)) })}>
          {t('onboarding.land.askOther', { land: describe(otherUnit(ask)) })}
        </button>
      </div>
    </div>
  ) : problem ? (
    <p className="ob-problem" role="alert" id="ob-land-problem">
      {t(`onboarding.land.problem.${problem.kind}`, { text: problem.text })}
    </p>
  ) : null

  return (
    <StepFrame
      position={position}
      title={t('onboarding.steps.land.title')}
      help={t('onboarding.steps.land.help')}
      onSubmit={submit}
      notice={notice}
      skip={{ label: t('onboarding.skipNotYet'), onSkip: () => commit({ land: unsure() }) }}
    >
      <div className="ob-row">
        <div className="ob-field grow">
          <label htmlFor="ob-land">{t('onboarding.land.label')}</label>
          <input
            id="ob-land"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={draft.text}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? 'ob-land-problem' : undefined}
            placeholder={t('onboarding.land.placeholder')}
            onChange={(event) => edit(event.target.value, draft.unit)}
          />
        </div>
        <Choice
          name="unit"
          legend={t('onboarding.land.unit')}
          type="radio"
          options={AREA_UNITS.map((unit) => ({ id: unit, label: unitName(unit) }))}
          value={[draft.unit]}
          onChange={([unit]) => edit(draft.text, unit as AreaUnit)}
        />
      </div>
      {hectares !== null && <p className="ob-muted">{t('onboarding.land.equals', { ha: fmt.number(hectares, hectares < 1 ? 3 : 2) })}</p>}
      <Choice
        name="size"
        legend={t('onboarding.land.sizes')}
        type="radio"
        options={SIZES.map((size) => ({ id: String(size), label: describe({ amount: size, unit: 'ha' }) }))}
        value={draft.unit === 'ha' && read.ok && read.land.unit === 'ha' ? [String(read.land.amount)] : []}
        onChange={([size]) => edit(size, 'ha')}
      />
    </StepFrame>
  )
}
