// The chat's summary of both engines: the WOFOST rotation run ("modelo de suelo y cultivo") and the SIAP district engine
// ("historial del distrito"). A language model may phrase it (llm/), but only from the fact lines built here, and only with
// numbers found in them; without it, or when it fails, the written summary below is used. The follow-up buttons are the
// questions the tools can answer.

import type { DemoLocation } from '../lib/demoLocations.ts'
import { bestAlternative, currentOf, incomeDelta, splitName, type DistrictAnswer } from '../lib/district.ts'
import type { Format } from '../lib/format.ts'
import { bestOption, pickForGoal, topIncomeOption, type Regime, type RotationGoal, type RotationOption, type Rotations } from '../lib/rotations.ts'
import type { FollowUp, NarrateRequest } from '../llm/prompt.ts'
import { districtFacts } from './districtAnswers.ts'
import { optionLines } from './rotationAnswers.ts'

type T = (path: string, vars?: Record<string, string | number>) => string

export interface SummaryCtx {
  t: T
  fmt: Format
  goal?: RotationGoal | null
}

/** The WOFOST regime that matches the district answer's water regime. */
export const regimeOf = (agua: 'temporal' | 'riego'): Regime => (agua === 'temporal' ? 'rainfed' : 'irrigated')

/** The WOFOST option shown for a regime: as the WOFOST answers pick it (goal, then the service's pick, then top income). */
export function wofostPick(rotations: Rotations, regime: Regime, goal?: RotationGoal | null): RotationOption | null {
  return (goal ? pickForGoal(rotations, regime, goal) : null) ?? bestOption(rotations, regime) ?? topIncomeOption(rotations, regime)
}

const years = ({ weatherYears }: Rotations) => {
  const first = Math.min(...weatherYears)
  const last = Math.max(...weatherYears)
  return first === last ? String(first) : `${first}–${last}`
}

/** WOFOST fact lines for the farmer's regime (and the other one, briefly): the run's own sentences and figures. */
export function wofostFacts(rotations: Rotations | undefined, regime: Regime, ctx: SummaryCtx): string[] {
  if (!rotations) return []
  const lines = [
    `Escenarios de un modelo de cultivo (WOFOST) con clima de ${years(rotations)} y precios de SIAP; ingreso bruto por hectárea en todo el plan, no ganancia. Confianza: ${rotations.confidence.labelEs}. ${rotations.confidence.reasonsEs.slice(0, 2).join(' ')}`,
  ]
  if (rotations.options.length === 0) return [...lines, ctx.t('whatsapp.rotations.noFeasible')]
  for (const r of [regime, regime === 'irrigated' ? 'rainfed' : 'irrigated'] as Regime[]) {
    const option = wofostPick(rotations, r, ctx.goal)
    if (!option) continue
    const name = ctx.t(`whatsapp.rotations.regime.${r}`)
    const detail = r === regime ? optionLines(option, ctx, rotations).map((l) => l.replace(/^• /, '')) : []
    const median = option.gross?.median
    lines.push(`${r === regime ? 'Opción para su régimen' : 'Como referencia, en el otro régimen'} (${name}): ${option.descriptionEs}.` + (median != null ? ` Ingreso bruto mediano ≈ $${ctx.fmt.number(Math.round(median))} por ha.` : ' Sin datos de ingreso.') + (detail.length ? ` ${detail.join(' ')}` : ''))
  }
  return lines
}

/** Which follow-ups make sense now. */
export function availableFollowUps(answer: DistrictAnswer | null, rotations: Rotations | undefined): FollowUp[] {
  const out: FollowUp[] = []
  if (rotations) out.push('wofost')
  if (answer) {
    out.push('district', 'why', 'risks', 'money', 'sell', 'trends')
    if (answer.result.agua_region) out.push('water')
  }
  out.push('trust')
  if (answer) out.push('rotation', 'priority', 'regime')
  return out
}

/** The default buttons after a summary, in order of usefulness, when no model chose them. */
export const DEFAULT_FOLLOW_UPS: FollowUp[] = ['wofost', 'why', 'sell', 'risks', 'priority', 'rotation', 'money']

export const followUpLabel = (id: FollowUp, t: T) => t(`whatsapp.district.followUps.${id}`)

export function narrateRequest(
  mode: NarrateRequest['mode'],
  question: string,
  place: DemoLocation,
  answer: DistrictAnswer | null,
  rotations: Rotations | undefined,
  ctx: SummaryCtx & { language: 'es' | 'en' },
): NarrateRequest {
  const regime = answer ? regimeOf(answer.inputs.agua) : 'irrigated'
  const context = answer
    ? `${place.name} (municipio ${answer.result.lugar.municipio ?? '—'}, distrito ${answer.result.lugar.distrito}), ${answer.inputs.agua}, rotación actual: ${answer.option.etiqueta}; prioridades: ${answer.result.prioridades.join(', ') || 'no dichas'}`
    : `${place.name}; sin respuesta del historial del distrito`
  return {
    mode,
    language: ctx.language,
    question,
    context,
    facts: { wofost: wofostFacts(rotations, regime, ctx), district: answer ? districtFacts(answer, ctx) : [] },
    followUps: availableFollowUps(answer, rotations).map((id) => ({ id, label: followUpLabel(id, ctx.t) })),
  }
}

/** The written summary, used when no language model answered. Every figure is one of the engines'. */
export function writtenSummary(place: DemoLocation, answer: DistrictAnswer | null, rotations: Rotations | undefined, ctx: SummaryCtx): string {
  const { t, fmt } = ctx
  const lines = [`*${t('whatsapp.district.summaryHead', { place: place.name })}*`]
  const regime: Regime = answer ? regimeOf(answer.inputs.agua) : 'irrigated'
  const option = rotations ? wofostPick(rotations, regime, ctx.goal) : null
  if (option && rotations) {
    const median = option.gross?.median
    lines.push(
      t('whatsapp.district.wofostLine', {
        regime: t(`whatsapp.rotations.regime.${regime}`).toLowerCase(),
        plan: option.descriptionEs,
        income: median != null ? fmt.number(Math.round(median)) : t('whatsapp.rotations.noData'),
        confidence: rotations.confidence.labelEs.toLowerCase(),
      }),
    )
  } else lines.push(t('whatsapp.district.wofostNone'))
  if (answer) {
    const current = currentOf(answer.result)
    const best = bestAlternative(answer.result)
    lines.push(t('whatsapp.district.currentLine', { district: answer.result.lugar.distrito, regime: t(`district.regime.${answer.inputs.agua}`), crops: splitName(current.nombre).crops, income: current.indicadores.ingreso?.texto ?? t('whatsapp.rotations.noData') }))
    if (best) {
      const d = incomeDelta(best)
      lines.push(
        t(answer.result.prioridades.length > 0 ? 'whatsapp.district.bestLine' : 'whatsapp.district.bestLineBalanced', { crops: splitName(best.nombre).crops, why: best.tarjeta.por_que }) +
          (d !== null ? ` ${t(d >= 0 ? 'district.deltaMore' : 'district.deltaLess', { n: fmt.number(Math.abs(d)), years: best.vs_actual_ingreso!.años, clear: best.vs_actual_ingreso!.clara ? t('district.clear') : t('district.notClear') })}` : ''),
      )
    } else lines.push(answer.result.nota_opciones ?? t('district.none'))
    if (answer.notUsed.length > 0) lines.push(t('district.notUsed', { list: answer.notUsed.map((key) => t(`district.inputs.${key}`)).join(', ') }))
  } else lines.push(t('whatsapp.district.districtNone'))
  lines.push(t('whatsapp.district.closing'))
  return lines.join('\n\n')
}
