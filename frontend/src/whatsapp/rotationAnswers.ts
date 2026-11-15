// What the chat says for a location that has real rotation results (Sinaloa and Sonora): the rotations service's
// experimental scenarios, quoted as they are. Nothing is computed beyond rounding for display. Every answer says what the
// numbers are (a crop model run on past weather, with historical prices, not validated in the field) and that income is
// gross per hectare, never profit. Unknown values read "sin datos", never zero.

import type { Format } from '../lib/format.ts'
import { bestOption, topIncomeOption, type Regime, type RotationOption, type Rotations } from '../lib/rotations.ts'
import type { Environment } from '../lib/environment.ts'
import type { BotBubble, Focus } from './engine.ts'
import { observedRain } from './environmentAnswers.ts'

type T = (path: string, vars?: Record<string, string | number>) => string

/** The chat's topics, plus the two the assistant answers about the evidence and the doses. */
export type RotationTopic = Focus | 'trust' | 'fertilizer'

interface Ctx {
  t: T
  fmt: Format
  /** The place's environmental package, when loaded: the rain question adds what was observed there. */
  observed?: Environment | null
}

const REGIMES: Regime[] = ['irrigated', 'rainfed']
/** Below this a simulated harvest counts as none (the service flags campaigns under 50 kg/ha). */
const NO_HARVEST_T_HA = 0.05

const bold = (text: string) => `*${text}*`
const bullets = (lines: string[]) => lines.map((line) => `• ${line}`).join('\n')

const years = ({ weatherYears }: Rotations) => {
  const first = Math.min(...weatherYears)
  const last = Math.max(...weatherYears)
  return first === last ? String(first) : `${first}–${last}`
}

const noData = ({ t }: Ctx) => t('whatsapp.rotations.noData')
/** Money to the nearest thousand: the scenarios are not precise to the peso. */
const money = (value: number | null, ctx: Ctx) => (value === null ? noData(ctx) : ctx.fmt.number(Math.round(value / 1000) * 1000))
const monthOf = (monthDay: string) => Number(monthDay.slice(0, 2)) - 1
const span = (sowing: string, end: string, { fmt }: Ctx) => `${fmt.monthShort(monthOf(sowing))}–${fmt.monthShort(monthOf(end))}`

function incomeLine(option: RotationOption, ctx: Ctx): string {
  const { gross } = option
  const low = gross?.p10 != null ? money(gross.p10, ctx) : null
  const high = gross?.p90 != null ? money(gross.p90, ctx) : null
  // a range that rounds to one figure ("de 2,000 a 2,000") says nothing
  const range = low !== null && high !== null && low !== high ? ctx.t('whatsapp.rotations.range', { low, high }) : ''
  return ctx.t('whatsapp.rotations.income', { amount: money(gross?.median ?? null, ctx), range })
}

/** One option as a bubble: its plan, income, water, and the warnings that go with it. */
function optionBubble(head: string, option: RotationOption, ctx: Ctx): BotBubble {
  const { t, fmt } = ctx
  const lines = [bold(head), option.descriptionEs, incomeLine(option, ctx)]
  if (option.regime === 'irrigated' && option.irrigationM3Ha !== null) lines.push(t('whatsapp.rotations.water', { amount: fmt.number(Math.round(option.irrigationM3Ha / 100) * 100) }))
  if (option.failedHarvests > 0) lines.push(t('whatsapp.rotations.failed', { n: option.failedHarvests }))
  if (option.requiresIrrigationConfirmation) lines.push(t('whatsapp.rotations.confirmIrrigation'))
  return { text: lines.join('\n') }
}

/** The option to show for a regime: the one the service's priorities ranked first, else the highest income. */
const chosen = (rotations: Rotations, regime: Regime) => bestOption(rotations, regime) ?? topIncomeOption(rotations, regime)

const label = (rotations: Rotations, { t }: Ctx): BotBubble => ({ text: t('whatsapp.rotations.label', { years: years(rotations) }) })
const caution = (rotations: Rotations, { t }: Ctx): BotBubble => ({ text: t('whatsapp.rotations.caution', { years: years(rotations) }) })
const regimeName = (regime: Regime, { t }: Ctx) => t(`whatsapp.rotations.regime.${regime}`)

function planting(rotations: Rotations, ctx: Ctx, compare: boolean): BotBubble[] {
  const bubbles: BotBubble[] = [label(rotations, ctx)]
  for (const regime of REGIMES) {
    const option = chosen(rotations, regime)
    if (!option) continue
    bubbles.push(optionBubble(ctx.t('whatsapp.rotations.bestHead', { regime: regimeName(regime, ctx) }), option, ctx))
    // "which crop is best" also names the highest-income option when the priorities picked another
    const top = compare ? topIncomeOption(rotations, regime) : null
    if (top && top.id !== option.id) bubbles.push(optionBubble(ctx.t('whatsapp.rotations.topHead', { regime: regimeName(regime, ctx) }), top, ctx))
  }
  bubbles.push(caution(rotations, ctx))
  return bubbles
}

function harvest(rotations: Rotations, ctx: Ctx): BotBubble[] {
  const { t, fmt } = ctx
  const bubbles: BotBubble[] = [{ text: t('whatsapp.rotations.harvestHead', { years: years(rotations) }) }]
  for (const regime of REGIMES) {
    const option = chosen(rotations, regime)
    if (!option) continue
    const lines = option.campaigns
      .filter((campaign) => !campaign.fallow)
      .map((campaign) => {
        const amount = campaign.grainTHa === null ? noData(ctx) : campaign.grainTHa < NO_HARVEST_T_HA ? t('whatsapp.rotations.harvestNone') : t('whatsapp.rotations.harvestAmount', { amount: fmt.number(campaign.grainTHa, 1) })
        return t('whatsapp.rotations.harvestLine', { crop: campaign.cropEs, year: campaign.planningYear, span: span(campaign.sowing, campaign.end, ctx), amount })
      })
    bubbles.push({ text: `${bold(regimeName(regime, ctx))}\n${lines.length > 0 ? lines.join('\n') : t('whatsapp.rotations.fallowOnly')}` })
  }
  bubbles.push(caution(rotations, ctx))
  return bubbles
}

function earnings(rotations: Rotations, ctx: Ctx): BotBubble[] {
  const bubbles: BotBubble[] = [label(rotations, ctx)]
  for (const regime of REGIMES) {
    const option = chosen(rotations, regime)
    if (option) bubbles.push({ text: `${bold(regimeName(regime, ctx))}\n${incomeLine(option, ctx)}` })
  }
  bubbles.push(caution(rotations, ctx))
  return bubbles
}

function rain(rotations: Rotations, ctx: Ctx): BotBubble[] {
  const { t } = ctx
  const irrigated = chosen(rotations, 'irrigated')
  const rainfed = chosen(rotations, 'rainfed')
  const bubbles: BotBubble[] = [{ text: t('whatsapp.rotations.rainHead', { years: years(rotations) }) }]
  const observed = ctx.observed ? observedRain(ctx.observed, ctx) : null
  if (observed) bubbles.push(observed)
  if (irrigated && rainfed) bubbles.push({ text: t('whatsapp.rotations.rainCompare', { irrigated: money(irrigated.gross?.median ?? null, ctx), rainfed: money(rainfed.gross?.median ?? null, ctx) }) })
  const dry = rotations.options.filter((option) => option.regime === 'rainfed')
  if (dry.length > 0) bubbles.push({ text: t('whatsapp.rotations.rainFailed', { n: dry.filter((option) => option.failedHarvests > 0).length, total: dry.length }) })
  bubbles.push(caution(rotations, ctx))
  return bubbles
}

function trust(rotations: Rotations, { t }: Ctx): BotBubble[] {
  const { confidence } = rotations
  const lines = [t('whatsapp.rotations.trustHead', { label: confidence.labelEs }), bullets(confidence.reasonsEs)]
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
