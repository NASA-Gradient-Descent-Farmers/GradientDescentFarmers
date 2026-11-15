// What the farmer's answers did to the plan, said one answer at a time. Like the summaries in compose.ts, every
// sentence is a template filled with numbers from the planner's result or from the answers themselves; nothing is
// generated. Each item says what kind of statement it is: something the planner computed, the farmer's answer
// checked against the model, or something the models do not cover.

import { checkPlanting, sowingDates, type Planting } from '../lib/farm.ts'
import type { Meta } from '../lib/types.ts'
import type { Say } from './compose.ts'
import type { FarmInputs, PlannerResult } from './types.ts'

export type GuidanceTopic = 'crops' | 'priority' | 'budget' | 'land' | 'planting' | 'water'

export interface GuidanceItem {
  topic: GuidanceTopic
  /** `plan`: computed by the planner; `check`: the farmer's answer set against the model; `limit`: the models do not cover it. */
  basis: 'plan' | 'check' | 'limit'
  tone: 'good' | 'note' | 'warn'
  text: string
}

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

/** A list in a sentence: "maize", "maize and faba bean", "maize, barley and faba bean". */
export function list({ t }: Say, items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} ${t('assistant.guidance.and')} ${items[items.length - 1]}`
}

/** "15 de mayo" / "May 15". */
const dateText = ({ t, fmt }: Say, day: { month: number; day: number }) => t('assistant.guidance.date', { day: day.day, month: fmt.monthLong(day.month) })

/** A planting time as the farmer said it: "a principios de junio", "in June", "when the rains start". */
export function describePlanting(planting: Planting, { t, fmt }: Say): string {
  if (planting.kind === 'rains') return t('assistant.guidance.when.rains')
  return t(`assistant.guidance.when.${planting.part ?? 'whole'}`, { month: fmt.monthLong(planting.month) })
}

/** Crops of the suggested rotation, the ones the farmer named first when the rotation holds some of them. */
function cropsToCheck(farm: FarmInputs, rotation: string, meta: Meta): string[] {
  const inRotation = [...new Set(meta.rotations[rotation])]
  const named = inRotation.filter((crop) => (farm.wanted as string[]).includes(crop))
  return named.length > 0 ? named : inRotation
}

export function guide(farm: FarmInputs, result: PlannerResult, meta: Meta, say: Say): GuidanceItem[] {
  const { t, fmt } = say
  const items: GuidanceItem[] = []
  const add = (topic: GuidanceTopic, basis: GuidanceItem['basis'], tone: GuidanceItem['tone'], key: string, vars: Record<string, string | number> = {}) =>
    items.push({ topic, basis, tone, text: t(`assistant.guidance.${key}`, vars) })
  const pick = result.strategy
  const rotationName = lower(t(`rotations.${pick.rotation}`))
  const cropName = (crop: string) => lower(t(`crops.${crop}`))
  const money = (value: number) => fmt.number(value)

  // ---- crops ----
  if (farm.wanted.length === 0) {
    add('crops', 'plan', 'note', 'crops.help', { n: farm.rotations.length, rotation: rotationName })
  } else {
    const names = list(say, farm.wanted.map(cropName))
    // One rotation holds everything that was ticked: there was nothing to compare.
    const key = farm.rotations.length === 1 ? 'crops.only' : farm.wanted.length === 1 ? 'crops.chosenOne' : 'crops.chosen'
    add('crops', 'plan', 'note', key, {
      crops: names,
      rotations: list(say, farm.rotations.map((r) => lower(t(`rotations.${r}`)))),
      rotation: rotationName,
    })
    const extra = [...new Set(meta.rotations[pick.rotation])].filter((crop) => !(farm.wanted as string[]).includes(crop))
    if (extra.length > 0) add('crops', 'plan', 'warn', 'crops.extra', { extra: list(say, extra.map(cropName)) })
  }
  if (farm.unmodelled.length > 0) add('crops', 'limit', 'warn', 'crops.unmodelled', { names: farm.unmodelled.join(', ') })

  // ---- priority ----
  if (farm.priority) add('priority', farm.priority === 'water' ? 'limit' : 'plan', farm.priority === 'water' ? 'warn' : 'note', `priority.${farm.priority}`)

  // ---- budget ----
  const limits = result.limits
  if (farm.budget && limits) {
    if (farm.budget.high === null) {
      add('budget', 'check', 'note', 'budget.noCeiling', { cost: money(pick.cost) })
    } else if (limits.capPerHa === null) {
      add('budget', 'check', 'warn', 'budget.needsArea')
    } else if (!limits.feasible) {
      add('budget', 'check', 'warn', 'budget.tooLow', { cap: money(limits.capPerHa), cheapest: money(limits.cheapest), cost: money(pick.cost) })
    } else {
      add('budget', 'check', 'good', 'budget.fits', { cap: money(limits.capPerHa), cost: money(pick.cost), margin: money(limits.capPerHa - pick.cost) })
      if (limits.withoutBudget) {
        add('budget', 'plan', 'note', 'budget.changed', {
          rotation: lower(t(`rotations.${limits.withoutBudget.rotation}`)),
          cost: money(limits.withoutBudget.cost),
        })
      }
    }
  }

  // ---- land ----
  if (farm.areaHa !== null) {
    const ha = farm.areaHa
    const areaText = Number.isInteger(ha) || ha >= 10 ? fmt.number(Math.round(ha)) : String(Math.round(ha * 100) / 100)
    // Totals are "about" figures: hundreds of pesos are as exact as multiplying a per-hectare average allows.
    const about = (value: number) => money(Math.round(value / 100) * 100)
    add('land', 'check', 'note', 'land', {
      area: areaText,
      cost: about(pick.cost * ha),
      net: about(pick.values.net_mxn_ha * ha),
    })
  }

  // ---- planting ----
  if (farm.planting) {
    const crops = cropsToCheck(farm, pick.rotation, meta)
    if (farm.planting.kind === 'rains') {
      // The crop the model sows first, from its earliest date on.
      const first = crops
        .map((crop) => ({ crop, dates: sowingDates(crop, meta.sowing) }))
        .filter((w): w is { crop: string; dates: NonNullable<ReturnType<typeof sowingDates>> } => w.dates !== null)
        .sort((a, b) => a.dates.from.month - b.dates.from.month || a.dates.from.day - b.dates.from.day)[0]
      if (first) {
        add('planting', 'check', 'good', 'planting.rains', {
          mm: meta.sowing.onset_rain_mm,
          days: meta.sowing.onset_rain_days,
          crop: cropName(first.crop),
          from: dateText(say, first.dates.from),
        })
      }
    } else {
      const check = checkPlanting(farm.planting, crops, meta.sowing)
      if (check) {
        add('planting', 'check', check.fit === 'inside' ? 'good' : check.fit === 'partly' ? 'note' : 'warn', `planting.${check.fit}`, {
          when: describePlanting(farm.planting, say),
          crop: cropName(check.crop),
          from: dateText(say, check.from),
          to: dateText(say, check.to),
          mm: meta.sowing.onset_rain_mm,
          days: meta.sowing.onset_rain_days,
        })
      }
    }
  }

  // ---- water ----
  if (farm.water === 'rain') add('water', 'check', 'good', 'water.rain')
  else if (farm.water) add('water', 'limit', 'warn', 'water.irrigated')

  return items
}
