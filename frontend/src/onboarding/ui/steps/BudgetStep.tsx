import { useMemo, useState } from 'react'
import { useI18n } from '../../../i18n/index.tsx'
import {
  ASSUMED_MXN_PER_USD, CURRENCIES, budgetEdges, costBand, niceRound, rotationsFor, toHectares,
  type Budget, type Currency,
} from '../../../lib/farm.ts'
import { toInput } from '../../../lib/numberInput.ts'
import { readMoney, readNumber } from '../../read.ts'
import { resolveBudget } from '../../resolve.ts'
import { sure, unsure } from '../../types.ts'
import { Choice, StepFrame } from '../frame.tsx'
import { useDraft } from '../hooks.ts'
import type { StepProps } from './types.ts'

interface Draft {
  currency: Currency
  rate: string
  /** Index of the range picked (0 = the lowest), or none. */
  pick: number | null
  text: string
}

type Problem = 'empty' | 'unreadable' | 'notPositive' | 'rate'

/** "¿Con cuánto cuentas para esta siembra?": ranges built from the planner's own costs, or an amount, in pesos or dollars. */
export function BudgetStep({ profile, data, drafts, position, commit }: StepProps) {
  const { t, fmt } = useI18n()
  const land = profile.land && !profile.land.unsure ? profile.land.value : null
  const areaHa = land ? toHectares(land) : null
  // With no area the amounts are per hectare: a total could not be set against the planner's costs.
  const basis: Budget['basis'] = areaHa ? 'total' : 'perHa'
  const wanted = profile.crops && !profile.crops.help ? profile.crops.crops : []
  const wantedKey = wanted.join(',')
  const band = useMemo(
    () => costBand(data.grids.calibrated, data.meta, rotationsFor(wantedKey ? (wantedKey.split(',') as typeof wanted) : null, data.meta)),
    [data, wantedKey],
  )
  const [edge1, edge2] = budgetEdges(band)

  const [draft, setDraft] = useDraft<Draft>(drafts, 'budget', () => {
    const known = profile.budget && !profile.budget.unsure ? profile.budget.value : null
    return {
      currency: known?.currency ?? 'MXN',
      rate: toInput(known?.rate ?? ASSUMED_MXN_PER_USD),
      pick: null,
      text: known && known.high !== null && known.low === known.high ? toInput(known.high) : '',
    }
  })
  const [problem, setProblem] = useState<Problem | null>(null)
  const [ask, setAsk] = useState<Budget | null>(null)

  const rate = draft.currency === 'USD' ? readNumber(draft.rate) : 1
  const usable = rate !== null && rate > 0
  const scale = basis === 'total' && areaHa ? areaHa : 1
  const show = (pesos: number) => niceRound(pesos / (usable ? rate : 1))
  const money = (amount: number) => `${fmt.number(amount)} ${draft.currency}`
  const edges = [show(edge1 * scale), show(edge2 * scale)]
  const ranges = [
    { low: 0, high: edges[0], label: t('onboarding.budget.upTo', { amount: money(edges[0]) }) },
    { low: edges[0], high: edges[1], label: t('onboarding.budget.between', { from: fmt.number(edges[0]), to: money(edges[1]) }) },
    { low: edges[1], high: null, label: t('onboarding.budget.over', { amount: money(edges[1]) }) },
  ]

  const edit = (patch: Partial<Draft>) => {
    setProblem(null)
    setAsk(null)
    setDraft({ ...draft, ...patch })
  }

  const finish = (budget: Budget) => commit({ budget: sure(budget) })

  const submit = () => {
    const outcome = resolveBudget(draft, { areaHa, ranges: ranges.map(({ low, high }) => ({ low, high })), cheapestPerHa: band.min })
    if (outcome.kind === 'problem') return setProblem(outcome.problem)
    if (outcome.kind === 'ask') return setAsk(outcome.budget)
    finish(outcome.budget)
  }

  const typed = draft.text.trim() !== '' ? readMoney(draft.text) : null
  const pesos = typed !== null && usable && draft.currency === 'USD' ? typed * rate : null

  const notice = ask ? (
    <div className="ob-followup" role="group" aria-label={t('onboarding.followUp')}>
      <strong>{t('onboarding.budget.askBasis', { amount: money(ask.high ?? 0), area: toInput(Number((areaHa ?? 0).toFixed(2))) })}</strong>
      <div className="ob-followup-actions">
        <button type="button" className="chip-button strong" onClick={() => finish(ask)}>
          {t('onboarding.budget.askTotal')}
        </button>
        <button type="button" className="chip-button" onClick={() => finish({ ...ask, basis: 'perHa' })}>
          {t('onboarding.budget.askPerHa')}
        </button>
      </div>
    </div>
  ) : problem ? (
    <p className="ob-problem" role="alert">
      {t(`onboarding.budget.problem.${problem}`)}
    </p>
  ) : null

  return (
    <StepFrame
      position={position}
      title={t('onboarding.steps.budget.title')}
      help={t(basis === 'total' ? 'onboarding.steps.budget.helpTotal' : 'onboarding.steps.budget.helpPerHa', { area: areaHa ? toInput(Number(areaHa.toFixed(2))) : '' })}
      onSubmit={submit}
      notice={notice}
      skip={{ label: t('onboarding.budget.notSure'), onSkip: () => commit({ budget: unsure() }) }}
    >
      <Choice
        name="currency"
        legend={t('onboarding.budget.currency')}
        type="radio"
        options={CURRENCIES.map((currency) => ({ id: currency, label: t(`onboarding.budget.currencies.${currency}`) }))}
        value={[draft.currency]}
        onChange={([currency]) => edit({ currency: currency as Currency, pick: null })}
      />
      {draft.currency === 'USD' && (
        <div className="ob-field">
          <label htmlFor="ob-rate">{t('onboarding.budget.rate')}</label>
          <input
            id="ob-rate"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={draft.rate}
            aria-invalid={problem === 'rate' ? true : undefined}
            onChange={(event) => edit({ rate: event.target.value, pick: null })}
          />
          <small>{t('onboarding.budget.rateHint')}</small>
        </div>
      )}
      {usable && (
        <Choice
          name="range"
          legend={t(basis === 'total' ? 'onboarding.budget.rangesTotal' : 'onboarding.budget.rangesPerHa')}
          type="radio"
          variant="cards"
          options={ranges.map((range, i) => ({ id: String(i), label: range.label }))}
          value={draft.pick === null ? [] : [String(draft.pick)]}
          onChange={([i]) => edit({ pick: Number(i), text: '' })}
        />
      )}
      <div className="ob-field">
        <label htmlFor="ob-budget-text">{t('onboarding.budget.textLabel', { currency: draft.currency })}</label>
        <input
          id="ob-budget-text"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={draft.text}
          placeholder={t('onboarding.budget.textPlaceholder')}
          aria-invalid={problem === 'unreadable' || problem === 'notPositive' ? true : undefined}
          onChange={(event) => edit({ text: event.target.value, pick: null })}
        />
        {pesos !== null && <small className="ob-read">{t('onboarding.budget.converted', { pesos: fmt.number(pesos) })}</small>}
      </div>
      <p className="ob-muted small">{t('onboarding.budget.costsNote', { min: fmt.number(niceRound(band.min)), max: fmt.number(niceRound(band.max)) })}</p>
    </StepFrame>
  )
}
