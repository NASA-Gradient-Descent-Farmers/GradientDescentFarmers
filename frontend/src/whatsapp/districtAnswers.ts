// What the chat says from the SIAP district engine (lib/district.ts): the farmer's current rotation against the alternatives
// built from what their district actually grows. Every figure and sentence of substance is the engine's own text (it formats
// its numbers); this file only chooses which lines to show and wraps them. Shared by WhatsApp and the in-app chat, like
// rotationAnswers.ts is for the WOFOST runs.

import type { Format } from '../lib/format.ts'
import { alternativesOf, bestAlternative, currentOf, incomeDelta, splitName, type DistrictAnswer, type DistrictRotation } from '../lib/district.ts'
import type { BotBubble } from './engine.ts'
import { nearestSentences, sellFacts, sellLinesFor, sellSentences, type FarmSize } from '../lib/market.ts'
import type { NearCentre } from '../lib/acopio.ts'

type T = (path: string, vars?: Record<string, string | number>) => string

export interface DistrictCtx {
  t: T
  fmt: Format
  /** Agricultor: fewer lines, no technical words. */
  simple?: boolean
  /** Farm size, when the farmer said it: whether a guarantee price applies. */
  size?: FarmSize | null
  /** The nearest official collection centres (sell answers), and when their directory was downloaded. */
  near?: NearCentre[]
  downloaded?: string | null
}

export type DistrictTopic = 'summary' | 'why' | 'risks' | 'trends' | 'water' | 'place' | 'money' | 'sell'

const bold = (text: string) => `*${text}*`
const bullets = (lines: string[]) => lines.map((line) => `• ${line}`).join('\n')

const evidenceWord = (level: string, { t }: DistrictCtx) => t(`district.evidence.${level}`)

function head(answer: DistrictAnswer, ctx: DistrictCtx): BotBubble {
  const { t } = ctx
  const { lugar } = answer.result
  return {
    text: [
      bold(t('district.title')),
      t('district.intro', { district: lugar.distrito, state: lugar.estado, regime: t(`district.regime.${lugar.agua}`) }),
      ...(answer.notUsed.length > 0 ? [t('district.notUsed', { list: answer.notUsed.map((key) => t(`district.inputs.${key}`)).join(', ') })] : []),
    ].join('\n'),
  }
}

function currentLine(answer: DistrictAnswer, ctx: DistrictCtx): string {
  const current = currentOf(answer.result)
  const i = current.indicadores
  return ctx.t('district.currentLine', { crops: splitName(current.nombre).crops, income: i.ingreso?.texto ?? ctx.t('district.noData'), risk: i.riesgo?.texto ?? ctx.t('district.noData') })
}

function deltaLine(r: DistrictRotation, ctx: DistrictCtx): string | null {
  const { t, fmt } = ctx
  const d = incomeDelta(r)
  if (d === null || !r.vs_actual_ingreso) return null
  const key = d >= 0 ? 'district.deltaMore' : 'district.deltaLess'
  const clear = r.vs_actual_ingreso.clara ? t('district.clear') : t('district.notClear')
  return t(key, { n: fmt.number(Math.abs(d)), years: r.vs_actual_ingreso.años, clear })
}

/** One alternative as a bubble: why, the income against the current rotation, two benefits, the main risk, the evidence. */
export function alternativeBubble(r: DistrictRotation, ctx: DistrictCtx, lead: string): BotBubble {
  const { t } = ctx
  const { kind, crops } = splitName(r.nombre)
  const card = r.tarjeta
  const delta = deltaLine(r, ctx)
  // the income difference is already said above: the main risk is the first one that is about something else
  const mainRisk = (delta ? card.riesgos.find((risk) => !/^(menos ingreso|diferencia de ingreso)/i.test(risk)) : null) ?? card.riesgos[0]
  const lines = [
    bold(`${lead}: ${crops}`) + (kind ? ` (${kind.toLowerCase()})` : ''),
    card.por_que,
    ...(delta ? [delta] : []),
    ...(card.beneficios.length > 0 ? [t('district.benefits', { list: card.beneficios.slice(0, ctx.simple ? 1 : 2).join('; ') })] : []),
    ...(mainRisk ? [t('district.mainRisk', { risk: mainRisk })] : []),
  ]
  if (!ctx.simple) {
    if (r.puntaje_prioridades !== null) lines.push(t('district.score', { score: r.puntaje_prioridades }))
    lines.push(t('district.evidenceLine', { level: evidenceWord(r.indicadores.ingreso?.evidencia ?? 'media', ctx) }))
    if (r.adopcion.condicional || r.busqueda_ampliada) lines.push(t('district.conditional'))
  }
  return { text: lines.join('\n') }
}

function summary(answer: DistrictAnswer, ctx: DistrictCtx): BotBubble[] {
  const { t } = ctx
  const { result } = answer
  const best = bestAlternative(result)
  const others = alternativesOf(result).filter((r) => r !== best)
  const bubbles: BotBubble[] = [{ text: `${head(answer, ctx).text}\n${currentLine(answer, ctx)}` }]
  if (!best) {
    bubbles.push({ text: result.nota_opciones ?? t('district.none') })
    return bubbles
  }
  bubbles.push(alternativeBubble(best, ctx, result.prioridades.length > 0 ? t('district.bestForYou') : t('district.bestBalanced')))
  if (others.length > 0) {
    bubbles.push({
      text: [t('district.othersHead'), bullets(others.map((r) => {
        const d = deltaLine(r, ctx)
        return `${splitName(r.nombre).crops}${d ? ` — ${d}` : ''}`
      }))].join('\n'),
    })
  }
  if (result.nota_opciones && !ctx.simple) bubbles.push({ text: result.nota_opciones })
  const ask = best.tarjeta.revisar_con_tecnico[0]
  bubbles.push({ text: [ask ? t('district.askTech', { question: ask }) : '', result.aviso].filter(Boolean).join('\n') })
  return bubbles
}

function why(answer: DistrictAnswer, ctx: DistrictCtx): BotBubble[] {
  const best = bestAlternative(answer.result)
  if (!best) return [{ text: answer.result.nota_opciones ?? ctx.t('district.none') }]
  return [
    { text: [bold(ctx.t('district.whyHead', { crops: splitName(best.nombre).crops })), best.tarjeta.por_que].join('\n') },
    { text: [ctx.t('district.evidenceHead'), bullets(best.tarjeta.evidencia.map((e) => `${e.texto} (${e.fuente}; ${evidenceWord(e.evidencia, ctx)})`))].join('\n') },
    { text: ctx.t('district.howToRead', { text: answer.result.como_leer }) },
  ]
}

function risks(answer: DistrictAnswer, ctx: DistrictCtx): BotBubble[] {
  const best = bestAlternative(answer.result)
  if (!best) return [{ text: answer.result.nota_opciones ?? ctx.t('district.none') }]
  const card = best.tarjeta
  return [
    { text: [bold(ctx.t('district.risksHead', { crops: splitName(best.nombre).crops })), bullets(card.riesgos)].join('\n') },
    { text: [bold(ctx.t('district.gapsHead')), bullets(card.vacios.slice(0, ctx.simple ? 1 : 3))].join('\n') },
    { text: [bold(ctx.t('district.techHead')), bullets(card.revisar_con_tecnico)].join('\n') },
  ]
}

function money(answer: DistrictAnswer, ctx: DistrictCtx): BotBubble[] {
  const { t } = ctx
  const lines = answer.result.rotaciones.map((r) => {
    const i = r.indicadores
    return t('district.moneyLine', { crops: splitName(r.nombre).crops, income: i.ingreso?.texto ?? t('district.noData'), bad: i.ingreso_p10?.texto ?? t('district.noData'), breakeven: i.costo_equilibrio?.texto ?? t('district.noData') })
  })
  return [{ text: [bold(t('district.moneyHead')), bullets(lines), t('district.moneyNote'), answer.result.costos.nota].join('\n') }]
}

/** The rotations a sell answer covers: what the farmer grows and the suggested alternative. */
const sellRotations = (answer: DistrictAnswer) => [currentOf(answer.result), ...[bestAlternative(answer.result)].filter((r): r is DistrictRotation => !!r)]

/** Where to sell the current and suggested crops: guarantee prices and eligibility, else where wholesale prices are. */
function sell(answer: DistrictAnswer, ctx: DistrictCtx): BotBubble[] {
  const { t } = ctx
  const { lugar } = answer.result
  const lines = sellLinesFor(sellRotations(answer), lugar.agua, lugar.estado, ctx.size ?? null)
  if (!lines.length) return [{ text: t('whatsapp.district.sellNone') }]
  const guarantee = lines.some((l) => l.kind === 'guarantee')
  const unknownSize = guarantee && !ctx.size
  return [
    { text: [bold(t('campo.answer.sell.title')), bullets(sellSentences(lines, t, ctx.fmt))].join('\n') },
    ...(guarantee && ctx.near?.length ? [{ text: nearestSentences(ctx.near, ctx.downloaded ?? null, t, ctx.fmt).join('\n') }] : []),
    { text: [guarantee ? t('whatsapp.district.sellWhere', { year: 2026 }) : t('whatsapp.district.sellSniim'), unknownSize ? t('whatsapp.district.sellAskSize') : ''].filter(Boolean).join('\n') },
  ]
}

/** The bubbles that answer one topic from the district engine's result. */
export function districtBubbles(topic: DistrictTopic, answer: DistrictAnswer, ctx: DistrictCtx): BotBubble[] {
  const { result } = answer
  switch (topic) {
    case 'summary':
      return summary(answer, ctx)
    case 'why':
      return why(answer, ctx)
    case 'risks':
      return risks(answer, ctx)
    case 'money':
      return money(answer, ctx)
    case 'sell':
      return sell(answer, ctx)
    case 'trends':
      return [{ text: [bold(ctx.t('district.trendsHead')), ...result.tendencias.lineas].join('\n') }]
    case 'water':
      return result.agua_region ? [{ text: [bold(ctx.t('district.waterHead')), ...result.agua_region.lineas].join('\n') }] : [{ text: ctx.t('district.noWater') }]
    case 'place':
      return [{ text: [bold(ctx.t('district.placeHead', { district: result.lugar.distrito })), bullets(result.tu_lugar.slice(0, ctx.simple ? 4 : 8))].join('\n') }]
  }
}

/**
 * The district result as plain fact lines for the language model to summarise (and for the number check). Only the engine's
 * own sentences and figures; nothing is computed here except the rounded income difference, which is also written in the card.
 */
export function districtFacts(answer: DistrictAnswer, ctx: Pick<DistrictCtx, 'fmt'>): string[] {
  const { result } = answer
  const current = currentOf(result)
  const lines = [
    `Lugar: municipio ${result.lugar.municipio ?? '—'}, distrito ${result.lugar.distrito}, ${result.lugar.estado}; ${result.lugar.agua}.`,
    `Prioridades del agricultor: ${result.prioridades.join(', ') || 'ninguna dicha'}.`,
    `Rotación actual: ${splitName(current.nombre).crops}. Valor de la cosecha ${current.indicadores.ingreso?.texto} por ha al año (sin costos); en un año malo ${current.indicadores.ingreso_p10?.texto}; años malos ${current.indicadores.riesgo?.texto}; agua: ${current.indicadores.agua?.texto}.`,
  ]
  for (const r of alternativesOf(result)) {
    const d = incomeDelta(r)
    lines.push(
      `Alternativa "${r.nombre}" (puntaje según prioridades ${r.puntaje_prioridades ?? 'sin dato'} de 100${r.adopcion.condicional ? '; depende de la parcela, pocos datos locales' : ''}): ${r.tarjeta.por_que}` +
        (d !== null && r.vs_actual_ingreso ? ` Ingreso frente a la actual: ${d >= 0 ? '+' : '−'}$${ctx.fmt.number(Math.abs(d))} por ha al año (${r.vs_actual_ingreso.clara ? 'diferencia clara' : 'diferencia no clara'}, ${r.vs_actual_ingreso.años} años).` : '') +
        ` Valor de la cosecha ${r.indicadores.ingreso?.texto}; agua ${r.indicadores.agua?.texto}; nitrógeno ${r.indicadores.nitrogeno?.texto}.` +
        ` Beneficios: ${r.tarjeta.beneficios.join('; ') || 'ninguno claro'}. Riesgos: ${r.tarjeta.riesgos.slice(0, 3).join('; ')}.` +
        ` Revisar con un técnico: ${r.tarjeta.revisar_con_tecnico[0] ?? '—'}`,
    )
  }
  if (result.nota_opciones) lines.push(result.nota_opciones)
  lines.push(...result.tendencias.lineas.slice(0, 4))
  if (result.agua_region?.lineas[0]) lines.push(result.agua_region.lineas[0])
  lines.push(...sellFacts(sellLinesFor(sellRotations(answer), result.lugar.agua, result.lugar.estado, null), ctx.fmt))
  if (answer.notUsed.length > 0) lines.push(`Datos del agricultor que esta respuesta no usó (respuesta precalculada): ${answer.notUsed.join(', ')}.`)
  lines.push(result.aviso)
  return lines
}
