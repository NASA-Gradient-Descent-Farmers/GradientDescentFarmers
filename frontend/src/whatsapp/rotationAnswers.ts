// What the chat says for a location that has real rotation results (Sinaloa and Sonora): the rotations service's
// experimental scenarios, quoted as they are. Nothing is computed beyond rounding for display. Every answer says what the
// numbers are (a crop model run on past weather, with historical prices, not validated in the field) and that income is
// gross per hectare, never profit. Unknown values read "sin datos", never zero.

import type { Format, Lang } from '../lib/format.ts'
import { confidenceLabelText, cropName, describeOption, highlightText, reasonText } from '../lib/rotationText.ts'
import { bestOption, pickForGoal, topIncomeOption, type Regime, type RotationCampaign, type RotationGoal, type RotationOption, type Rotations } from '../lib/rotations.ts'
import type { Environment } from '../lib/environment.ts'
import type { BotBubble, Focus } from './engine.ts'
import { observedRain } from './environmentAnswers.ts'

type T = (path: string, vars?: Record<string, string | number>) => string

/** The chat's topics, plus the two the assistant answers about the evidence and the doses. */
export type RotationTopic = Focus | 'trust' | 'fertilizer'

export interface Ctx {
  t: T
  fmt: Format
  /** The language of the answer; the service's Spanish text is translated for English. Spanish when not given. */
  lang?: Lang
  /** The place's environmental package, when loaded: the rain question adds what was observed there. */
  observed?: Environment | null
  /** What matters most to the farmer: the options are ranked by it. */
  goal?: RotationGoal | null
  /** The water the farmer says they have: that regime is shown first. */
  water?: 'rain' | 'some' | 'regular' | null
}

const REGIMES: Regime[] = ['irrigated', 'rainfed']
/** Below this a simulated harvest counts as none (the service flags campaigns under 50 kg/ha). */
const NO_HARVEST_T_HA = 0.05

const bold = (text: string) => `*${text}*`
const bullets = (lines: string[]) => lines.map((line) => `• ${line}`).join('\n')

export const years = ({ weatherYears }: Rotations) => {
  const first = Math.min(...weatherYears)
  const last = Math.max(...weatherYears)
  return first === last ? String(first) : `${first}–${last}`
}

const noData = ({ t }: Ctx) => t('whatsapp.rotations.noData')
/** The figure as the service generated it, to the peso: no further rounding. */
export const money = (value: number | null, ctx: Ctx) => (value === null ? noData(ctx) : ctx.fmt.number(Math.round(value)))
export const monthOf = (monthDay: string) => Number(monthDay.slice(0, 2)) - 1
/** The season as the plan gives it: sown in a month of one plan year, ending in a month of the same or the next (not dates). */
export const season = (campaign: RotationCampaign, ctx: Ctx) =>
  ctx.t('whatsapp.rotations.season', { y1: campaign.planningYear, from: ctx.fmt.monthShort(monthOf(campaign.sowing)), y2: campaign.planningYearEnd, to: ctx.fmt.monthShort(monthOf(campaign.end)) })
/** A translated label, or the service's own word when the dictionary has none. */
const word = (path: string, key: string, { t }: Ctx) => {
  const text = t(`${path}.${key}`)
  return text === `${path}.${key}` ? key : text
}

function incomeLine(option: RotationOption, ctx: Ctx): string {
  const { gross } = option
  const low = gross?.p10 != null ? money(gross.p10, ctx) : null
  const high = gross?.p90 != null ? money(gross.p90, ctx) : null
  // a range that rounds to one figure ("de 2,000 a 2,000") says nothing
  const range = low !== null && high !== null && low !== high ? ctx.t('whatsapp.rotations.range', { low, high }) : ''
  return ctx.t('whatsapp.rotations.income', { amount: money(gross?.median ?? null, ctx), range })
}

/** How the option's irrigation compares with the service's reference ("Usa 38 % menos riego que …"), or null when it does not. */
export function irrigationComparison(option: RotationOption, ctx: Ctx, rotations: Rotations): string | null {
  if (option.irrigationSavingPct === null || option.regime !== 'irrigated' || Math.round(option.irrigationSavingPct) === 0) return null
  const reference = rotations.references[option.regime]
  return ctx.t(option.irrigationSavingPct > 0 ? 'whatsapp.rotations.saving' : 'whatsapp.rotations.extra', { pct: ctx.fmt.number(Math.abs(Math.round(option.irrigationSavingPct))), reference: word('whatsapp.rotations.reference', reference?.kind ?? '', ctx) })
}

/**
 * One option as a bubble, with what the service generated for it: its plan, its status (an experiment, never an approved plan),
 * what it stands out in, its own highlights word for word, the range of income over the price years, the water it applies and
 * uses, how its irrigation compares with the reference, and its affinity with the priorities (not a chance of success).
 */
export function optionLines(option: RotationOption, ctx: Ctx, rotations: Rotations): string[] {
  const { t, fmt } = ctx
  const lines = [t(`whatsapp.rotations.status.${option.advisoryStatus}`)]
  if (option.highlightObjectives.length > 0) lines.push(t('whatsapp.rotations.stands', { list: option.highlightObjectives.map((objective) => word('whatsapp.rotations.objective', objective, ctx)).join(', ') }))
  lines.push(...option.highlightsEs.map((line) => `• ${highlightText(line, ctx.lang ?? 'es')}`))
  const { gross } = option
  if (gross?.p10 != null && gross?.p90 != null) lines.push(t('whatsapp.rotations.rangeP', { low: money(gross.p10, ctx), high: money(gross.p90, ctx) }))
  if (option.regime === 'rainfed') lines.push(t('whatsapp.rotations.noIrrigation'))
  if (option.evapotranspirationMm !== null) lines.push(t('whatsapp.rotations.consumed', { mm: fmt.number(Math.round(option.evapotranspirationMm)) }))
  if (option.rainfallMm !== null) lines.push(t('whatsapp.rotations.rain', { mm: fmt.number(Math.round(option.rainfallMm)) }))
  const compared = irrigationComparison(option, ctx, rotations)
  if (compared) lines.push(compared)
  if (option.priorityScore !== null) lines.push(t('whatsapp.rotations.affinity', { score: fmt.number(Math.round(option.priorityScore)) }))
  if (option.immatureCampaigns > 0) lines.push(t('whatsapp.rotations.immature', { n: option.immatureCampaigns }))
  if (option.requiresIrrigationConfirmation) lines.push(t('whatsapp.rotations.confirmIrrigation'))
  return lines
}

function optionBubble(head: string, option: RotationOption, ctx: Ctx, rotations: Rotations): BotBubble {
  return { text: [bold(head), describeOption(option, ctx.lang ?? 'es', ctx.fmt), ...optionLines(option, ctx, rotations)].join('\n') }
}

/** The option to show for a regime: the best for the farmer's goal when they gave one, else the service's own pick, else the highest income. */
export const chosen = (rotations: Rotations, regime: Regime, ctx?: Ctx) => (ctx?.goal ? pickForGoal(rotations, regime, ctx.goal) : null) ?? bestOption(rotations, regime) ?? topIncomeOption(rotations, regime)

/** The regime the farmer says they have comes first; both are always shown. */
export const regimesFor = (ctx: Ctx): Regime[] => (ctx.water === 'rain' ? ['rainfed', 'irrigated'] : REGIMES)

export const label = (rotations: Rotations, { t }: Ctx): BotBubble => ({ text: t('whatsapp.rotations.label', { years: years(rotations) }) })
export const caution = (rotations: Rotations, { t }: Ctx): BotBubble => ({ text: t('whatsapp.rotations.caution', { years: years(rotations) }) })
export const regimeName = (regime: Regime, { t }: Ctx) => t(`whatsapp.rotations.regime.${regime}`)

function planting(rotations: Rotations, ctx: Ctx, compare: boolean): BotBubble[] {
  const bubbles: BotBubble[] = [label(rotations, ctx)]
  // a run that found nothing feasible says so: no recommendation is made up
  if (rotations.options.length === 0) return [...bubbles, { text: ctx.t('whatsapp.rotations.noFeasible') }]
  for (const regime of regimesFor(ctx)) {
    const option = chosen(rotations, regime, ctx)
    if (!option) continue
    const head = ctx.goal ? ctx.t('whatsapp.rotations.goalHead', { regime: regimeName(regime, ctx), goal: ctx.t(`farmer.rec.goals.${ctx.goal}`) }) : ctx.t('whatsapp.rotations.bestHead', { regime: regimeName(regime, ctx) })
    bubbles.push(optionBubble(head, option, ctx, rotations))
    // "which crop is best" also names the highest-income option when the priorities picked another
    const top = compare ? topIncomeOption(rotations, regime) : null
    if (top && top.id !== option.id) bubbles.push(optionBubble(ctx.t('whatsapp.rotations.topHead', { regime: regimeName(regime, ctx) }), top, ctx, rotations))
  }
  bubbles.push(caution(rotations, ctx))
  return bubbles
}

function harvest(rotations: Rotations, ctx: Ctx): BotBubble[] {
  const { t, fmt } = ctx
  const bubbles: BotBubble[] = [{ text: t('whatsapp.rotations.harvestHead', { years: years(rotations) }) }]
  for (const regime of regimesFor(ctx)) {
    const option = chosen(rotations, regime, ctx)
    if (!option) continue
    const lines = option.campaigns
      .filter((campaign) => !campaign.fallow)
      .map((campaign) => {
        const amount = campaign.grainTHa === null ? noData(ctx) : campaign.grainTHa < NO_HARVEST_T_HA ? t('whatsapp.rotations.harvestNone') : t('whatsapp.rotations.harvestAmount', { amount: fmt.number(campaign.grainTHa, 2) })
        const gross = campaign.grossMxnHa === null ? '' : ` · ${t('whatsapp.rotations.seasonIncome', { amount: money(campaign.grossMxnHa, ctx) })}`
        return t('whatsapp.rotations.harvestLine', { crop: cropName(campaign.cropEs, ctx.lang ?? 'es'), season: season(campaign, ctx), amount }) + gross
      })
    bubbles.push({ text: `${bold(regimeName(regime, ctx))}\n${lines.length > 0 ? lines.join('\n') : t('whatsapp.rotations.fallowOnly')}` })
  }
  bubbles.push(caution(rotations, ctx))
  return bubbles
}

function earnings(rotations: Rotations, ctx: Ctx): BotBubble[] {
  const bubbles: BotBubble[] = [label(rotations, ctx)]
  for (const regime of regimesFor(ctx)) {
    const option = chosen(rotations, regime, ctx)
    if (option) bubbles.push({ text: `${bold(regimeName(regime, ctx))}\n${incomeLine(option, ctx)}` })
  }
  bubbles.push(caution(rotations, ctx))
  return bubbles
}

function rain(rotations: Rotations, ctx: Ctx): BotBubble[] {
  const { t } = ctx
  const irrigated = chosen(rotations, 'irrigated', ctx)
  const rainfed = chosen(rotations, 'rainfed', ctx)
  const bubbles: BotBubble[] = [{ text: t('whatsapp.rotations.rainHead', { years: years(rotations) }) }]
  const observed = ctx.observed ? observedRain(ctx.observed, ctx) : null
  if (observed) bubbles.push(observed)
  if (irrigated && rainfed) bubbles.push({ text: t('whatsapp.rotations.rainCompare', { irrigated: money(irrigated.gross?.median ?? null, ctx), rainfed: money(rainfed.gross?.median ?? null, ctx) }) })
  const dry = rotations.options.filter((option) => option.regime === 'rainfed')
  if (dry.length > 0) bubbles.push({ text: t('whatsapp.rotations.rainFailed', { n: dry.filter((option) => option.failedHarvests > 0).length, total: dry.length }) })
  bubbles.push(caution(rotations, ctx))
  return bubbles
}

function trust(rotations: Rotations, { t, lang = 'es' }: Ctx): BotBubble[] {
  const { confidence } = rotations
  const lines = [t('whatsapp.rotations.trustHead', { label: confidenceLabelText(confidence.labelEs, lang) }), bullets(confidence.reasonsEs.map((reason) => reasonText(reason, lang)))]
  if (confidence.probabilityOfSuccess === null) lines.push(t('whatsapp.rotations.noProbability'))
  return [{ text: lines.join('\n\n') }]
}

/** The bubbles that answer one topic for a location, from its rotation results. */
export function rotationBubbles(topic: RotationTopic, rotations: Rotations, ctx: Ctx): BotBubble[] {
  switch (topic) {
    case 'plant':
      return planting(rotations, ctx, false)
    case 'compare':
      return planting(rotations, ctx, true)
    case 'harvest':
      return harvest(rotations, ctx)
    case 'money':
      return earnings(rotations, ctx)
    case 'rain':
      return rain(rotations, ctx)
    case 'trust':
      return trust(rotations, ctx)
    case 'fertilizer':
      return [{ text: ctx.t('whatsapp.rotations.noFertilizer') }]
  }
}

/** The one line that confirms a location whose rotation results are loaded. */
export const locatedNote = (name: string, rotations: Rotations, { t }: Ctx): string =>
  t('whatsapp.rotations.located', { name, where: rotations.municipality ? t('whatsapp.rotations.inMunicipality', { municipality: rotations.municipality }) : '' })
