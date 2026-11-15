// The summary's wording: each answer as the farmer would say it, and how the models will use it. The second line is
// the input mapping made visible, so no answer is used in a way that is not written down.

import { describePlanting, list } from '../assistant/guidance.ts'
import type { I18n } from '../i18n/index.tsx'
import { capPerHa, rotationsFor, toHectares, type Budget, type Land } from '../lib/farm.ts'
import type { LatLon } from '../lib/geo.ts'
import { toInput } from '../lib/numberInput.ts'
import type { Meta } from '../lib/types.ts'
import type { Profile, StepId } from './types.ts'

export interface Described {
  /** The answer, in words. Empty when the question has not been answered. */
  value: string
  /** How the models will use it. */
  used: string | null
  state: 'answered' | 'unsure' | 'open'
}

const hectares = (fmt: I18n['fmt'], ha: number) => (Number.isInteger(ha) ? fmt.number(ha) : fmt.number(ha, ha < 1 ? 3 : 2))
const number = (fmt: I18n['fmt'], value: number) => (Number.isInteger(value) ? fmt.number(value) : toInput(value))

export const describeLand = ({ t, fmt }: I18n, land: Land) => `${number(fmt, land.amount)} ${t(`onboarding.land.units.${land.unit}`)}`

export function describeBudget({ t, fmt }: I18n, budget: Budget): string {
  const amount = (value: number) => `${fmt.number(value)} ${budget.currency}`
  const basis = t(`onboarding.summary.basis.${budget.basis}`)
  if (budget.high === null) return t('onboarding.summary.budgetOver', { amount: amount(budget.low), basis })
  if (budget.low === budget.high) return t('onboarding.summary.budgetAbout', { amount: amount(budget.high), basis })
  if (budget.low === 0) return t('onboarding.summary.budgetUpTo', { amount: amount(budget.high), basis })
  return t('onboarding.summary.budgetBetween', { from: fmt.number(budget.low), to: amount(budget.high), basis })
}

export function describeAnswer(step: StepId, profile: Profile, pin: LatLon | null, meta: Meta, i18n: I18n): Described {
  const { t, fmt, coords } = i18n
  const open: Described = { value: '', used: null, state: 'open' }
  const notSure = (used: string): Described => ({ value: t('onboarding.summary.notSure'), used, state: 'unsure' })

  switch (step) {
    case 'crops': {
      const crops = profile.crops
      if (!crops) return open
      const unmodelled = crops.unmodelled.length > 0 ? t('onboarding.summary.unmodelled', { names: crops.unmodelled.join(', ') }) : ''
      const rotations = rotationsFor(crops.help ? null : crops.crops, meta)
      const used = t(crops.help ? 'onboarding.used.cropsHelp' : 'onboarding.used.crops', {
        n: rotations.length,
        rotations: list(i18n, rotations.map((r) => t(`rotations.${r}`).toLowerCase())),
      })
      const value = crops.help ? t('onboarding.summary.cropsHelp') : list(i18n, crops.crops.map((c) => t(`crops.${c}`).toLowerCase()))
      return { value: `${value}${unmodelled}`, used, state: 'answered' }
    }
    case 'where':
      return pin ? { value: coords(pin), used: t('onboarding.used.where'), state: 'answered' } : open
    case 'land': {
      const land = profile.land
      if (!land) return open
      if (land.unsure) return notSure(t('onboarding.used.landUnsure'))
      return { value: describeLand(i18n, land.value), used: t('onboarding.used.land', { ha: hectares(fmt, toHectares(land.value)) }), state: 'answered' }
    }
    case 'when': {
      const when = profile.when
      if (!when) return open
      if (when.unsure) return notSure(t('onboarding.used.whenUnsure'))
      return { value: describePlanting(when.value, i18n), used: t('onboarding.used.when', { mm: meta.sowing.onset_rain_mm, days: meta.sowing.onset_rain_days }), state: 'answered' }
    }
    case 'budget': {
      const budget = profile.budget
      if (!budget) return open
      if (budget.unsure) return notSure(t('onboarding.used.budgetUnsure'))
      const land = profile.land && !profile.land.unsure ? toHectares(profile.land.value) : null
      const cap = capPerHa(budget.value, land)
      const used =
        budget.value.high === null
          ? t('onboarding.used.budgetNone')
          : cap === null
            ? t('onboarding.used.budgetNeedsArea')
            : t('onboarding.used.budget', { cap: fmt.number(cap) })
      return { value: describeBudget(i18n, budget.value), used, state: 'answered' }
    }
    case 'water': {
      const water = profile.water
      if (!water) return open
      if (water.unsure) return notSure(t('onboarding.used.waterUnsure'))
      return { value: t(`onboarding.water.options.${water.value}.label`), used: t(water.value === 'rain' ? 'onboarding.used.waterRain' : 'onboarding.used.waterIrrigated'), state: 'answered' }
    }
    case 'priority': {
      const priority = profile.priority
      if (!priority) return open
      if (priority.unsure) return notSure(t('onboarding.used.priorityUnsure'))
      return { value: t(`onboarding.priority.options.${priority.value}.label`), used: t(`onboarding.used.priority.${priority.value}`), state: 'answered' }
    }
  }
}
