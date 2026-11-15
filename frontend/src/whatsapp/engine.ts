// The brain of the WhatsApp simulator. Pure functions: a message goes in, the bot's text bubbles come out. Nothing
// here is a language model or a network call. The decisions come from the farmer assistant's own rules (farmer/chat.ts),
// the numbers from the planner and the stored rain-risk results (farmer/recommend.ts), the sentences from the existing
// Spanish dictionary. What this file adds is only the shape of a text chat: bubbles, quick-reply buttons and reading
// a typed answer ("2 hectáreas", "solo de la lluvia") where the app has big buttons.

import { classify, planReply, type Body, type Context } from '../farmer/chat.ts'
import { evidenceFor, yearsText } from '../farmer/evidence.ts'
import { fold } from '../farmer/places.ts'
import { confidenceOf, DRY_SCENARIOS, nextCrop, recommend, roundMoney, type Recommendation, type Zone } from '../farmer/recommend.ts'
import { FIELDS, GOALS, PREVIOUS, validHectares, type Field, type Goal, type Previous, type Situation } from '../farmer/state.ts'
import type { Format } from '../lib/format.ts'
import { WATER, type Water } from '../lib/farm.ts'
import { DEMO_LOCATIONS, demoLocation, type DemoLocation, type DemoLocationId } from '../lib/demoLocations.ts'
import { distanceKm } from '../lib/geo.ts'
import type { DashboardData } from '../lib/types.ts'

type T = (path: string, vars?: Record<string, string | number>) => string

/** The chat's topics: the assistant's three plus the two questions the simulator's suggestions add. */
export type Focus = 'plant' | 'money' | 'rain' | 'harvest' | 'compare'

/** What the conversation remembers between messages. Plain data, so a reset is just the empty state. */
export interface ChatState {
  situation: Situation
  /** The question the farmer is being asked, whose answer the next message is read as. */
  pending: Field | 'location' | null
  /** What they originally asked, answered once the questions are done. */
  focus: Focus | null
  last: Recommendation | null
  /** The demonstration location chosen, used for every answer until another is chosen. */
  location: DemoLocationId | null
}

export const EMPTY_CHAT: ChatState = { situation: {}, pending: null, focus: null, last: null, location: null }

export interface QuickReply {
  label: string
}

/** One bot bubble. `options` are the quick-reply buttons under it. */
export interface BotBubble {
  text: string
  options?: QuickReply[]
}

export interface Env {
  data: DashboardData
  t: T
  fmt: Format
  distance: (km: number) => string
  /** Injected so tests can run without the planner. */
  run?: typeof recommend
  now?: () => number
}

/**
 * Where the parcel sits against the model's one fitted place is unknown for a demo point, so the zone is "unknown": the
 * confidence is the lowest the app has ("muy baja") and the risk line says the model was not checked here. The app's
 * "outside" refusal is not applied: the demo shows the bundled results, labelled experimental, on purpose.
 */
export function demoZone(location: DemoLocation, data: DashboardData): Zone {
  return { status: 'unknown', key: null, km: distanceKm({ lat: location.latitude, lon: location.longitude }, { lat: data.meta.site.latitude, lon: data.meta.site.longitude }) }
}

// ---- reading a location ----

/** The demonstration location a message names ("en Sonora", "guanajuato"), or null. */
export function readLocation(text: string): DemoLocation | null {
  const q = fold(text)
  return DEMO_LOCATIONS.find((place) => new RegExp(`\\b${fold(place.name)}\\b`).test(q)) ?? null
}

// ---- reading a typed answer ----

const WORD_NUMBERS: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 }

/** `raw` keeps the decimal point or comma (folding turns "2.5" into "2 5"); `q` is the folded text for number words. */
function readHectares(raw: string, q: string): number | undefined {
  const digits = raw.match(/\d+(?:[.,]\d+)?/)
  const n = digits ? Number(digits[0].replace(',', '.')) : (q.split(' ').map((w) => WORD_NUMBERS[w]).find((v) => v !== undefined) ?? (/\bmedia\b/.test(q) ? 0.5 : undefined))
  return n !== undefined && validHectares(n) ? n : undefined
}

function readPrevious(q: string): Previous | undefined {
  if (/\b(no sembre|descanso|nada|ninguno|ninguna|vacia|vacio)\b/.test(q)) return 'none'
  if (/\b(maiz|maize|corn)\b/.test(q)) return 'maize'
  if (/\b(cebada|barley)\b/.test(q)) return 'barley'
  if (/\b(habas?|fava|faba)\b/.test(q)) return 'fababean'
  if (/\b(otro|otra|frijol|trigo|avena|calabaza|jitomate|nopal)\b/.test(q)) return 'other'
  return undefined
}

function readWater(q: string): Water | undefined {
  if (/\b(a veces|auxilio|de vez en cuando)\b/.test(q)) return 'some'
  if (/\b(lluvia|temporal|llueve)\b/.test(q) && !/\briego\b/.test(q)) return 'rain'
  if (/\b(riego|regar|riegan|agua)\b/.test(q)) return /\b(no|sin)\b/.test(q) ? 'rain' : 'regular'
  return undefined
}

function readGoal(q: string): Goal | undefined {
  if (/\b(ganar|gano|ganancia|ingreso|ingresos|dinero)\b/.test(q)) return 'earn'
  if (/\b(riesgo|riesgos|seguro|seguridad|reducir)\b/.test(q)) return 'safe'
  if (/\b(suelo|tierra|cuidar|conservar)\b/.test(q)) return 'soil'
  return undefined
}

/** The answer to `field` hidden in free text, or undefined when the text does not answer it. */
export function readAnswer(field: Field, text: string): Situation[Field] | undefined {
  const q = fold(text)
  switch (field) {
    case 'previous':
      return readPrevious(q)
    case 'hectares':
      return readHectares(text, q)
    case 'water':
      return readWater(q)
    case 'goal':
      return readGoal(q)
  }
}

// ---- reading the topic ----

const HARVEST = /\b(cosech\w*|rendimiento|rendir\w*|produc\w*|toneladas)\b/
const COMPARE = /\b(cultivo|cultivos)\b.*\b(mas|mejor)\b|\b(mejor|mejores) (cultivo|cultivos|opcion|opciones)\b/

/** What a question is about. The assistant's own classifier first; the two simulator topics only where it has no answer. */
export function focusOf(text: string): Focus | null {
  const q = fold(text)
  const base = classify(text)
  if (base === 'unknown' && HARVEST.test(q)) return 'harvest'
  if (base === 'plant' && COMPARE.test(q)) return 'compare'
  return base === 'plant' || base === 'money' || base === 'rain' ? base : null
}

// ---- the sentences ----

const lowerFirst = (text: string) => text.replace(/^(¿?)(.)/, (_, mark: string, letter: string) => mark + letter.toLowerCase())
const upperFirst = (text: string) => text.replace(/^(¿?)(.)/, (_, mark: string, letter: string) => mark + letter.toUpperCase())
const bold = (text: string) => `*${text}*`

export const greeting = (t: T): BotBubble[] => [{ text: t('whatsapp.welcome') }, { text: t('whatsapp.demoParcel') }]

const coords = (place: DemoLocation) => `${place.latitude}, ${place.longitude}`

function locationAsk(t: T): BotBubble {
  return { text: t('whatsapp.askLocation'), options: DEMO_LOCATIONS.map((place) => ({ label: place.name })) }
}

/** Confirms the location, and says what exists for it: experimental data, or none. */
function locationBubbles(place: DemoLocation, t: T): BotBubble[] {
  const head = t('whatsapp.locationSet', { name: place.name, coords: coords(place) })
  const note = place.results === 'experimental' ? t('whatsapp.experimental') : t('whatsapp.unavailable', { name: place.name })
  return [{ text: `${head}\n${t('whatsapp.referencePoint')}` }, { text: note }]
}

const unavailableBubble = (place: DemoLocation, t: T): BotBubble => ({ text: t('whatsapp.unavailable', { name: place.name }) })

function askBubble(field: Field, lead: boolean, t: T): BotBubble {
  const question = t(`farmer.parcel.steps.${field}.q`)
  const text = lead ? `${t('farmer.chat.ask.lead')} ${lowerFirst(question)}` : upperFirst(question)
  const labels: Record<Field, string[]> = {
    previous: PREVIOUS.map((v) => t(`farmer.parcel.previous.${v}`)),
    hectares: [1, 2, 5, 10].map((n) => t('farmer.parcel.hectares.quick', { n })),
    water: WATER.map((v) => t(`farmer.parcel.water.${v}.label`)),
    goal: GOALS.map((v) => t(`farmer.parcel.goal.${v}.label`)),
  }
  return { text, options: labels[field].map((label) => ({ label })) }
}

const bullets = (lines: string[]) => lines.map((line) => `• ${line}`).join('\n')

function evidenceLines(env: Env): string[] {
  const { t, fmt, data } = env
  const evidence = evidenceFor(data.models)
  const lines: string[] = []
  if (evidence.level) {
    lines.push(t('farmer.rec.confidence.evidenceLevel', { sim: fmt.number(evidence.level.sim, 1), obs: fmt.number(evidence.level.obs, 1), years: yearsText(evidence.level.years) }))
  }
  if (evidence.holdoutWorse) lines.push(t('farmer.rec.confidence.evidenceYears', { holdout: yearsText(evidence.holdoutWorse) }))
  lines.push(t('farmer.rec.confidence.evidenceSource'))
  return lines
}

/** How far to trust the numbers: always written, never above "low". */
function confidenceBubble(rec: Recommendation, env: Env): BotBubble {
  const { t } = env
  const level = confidenceOf(rec.zone)
  return { text: [`${bold(t('farmer.rec.confidence.title'))}: ${t(`farmer.rec.confidence.${level}`)}.`, t('farmer.rec.confidence.use'), t('farmer.rec.notGuarantee')].join('\n') }
}

function bodyBubbles(body: Body, env: Env): BotBubble[] {
  const { t, distance } = env
  switch (body.kind) {
    case 'greeting':
      return [{ text: t('farmer.chat.hello') }]
    case 'ask':
      return [askBubble(body.field === 'parcel' ? 'previous' : body.field, body.lead, t)]
    case 'outside':
      return [{ text: t('farmer.chat.outside', { km: distance(body.km) }) }]
    case 'trust':
      return [{ text: t('farmer.chat.trust.intro') }, { text: bullets(evidenceLines(env)) }, { text: t('farmer.chat.trust.outro') }]
    case 'fertilizer': {
      const bubbles = [{ text: t('farmer.chat.fertilizer.general') }, { text: t('farmer.chat.fertilizer.advice') }]
      if (body.rec) {
        const doses = Object.entries(body.rec.result.strategy.doses).filter(([, kg]) => kg > 0)
        bubbles.push({
          text: doses.length === 0 ? t('farmer.chat.fertilizer.none') : doses.map(([crop, kg]) => t('farmer.chat.fertilizer.yours', { kg: env.fmt.number(kg), crops: t(`crops.${crop}`).toLowerCase() })).join(' '),
        })
      }
      return bubbles
    }
    case 'unknown':
      return [{ text: t('farmer.chat.unknown') }]
    case 'error':
      return [{ text: t('farmer.chat.error', { message: body.message }) }]
    case 'recommendation':
      return []
  }
}

/** The recommendation as chat bubbles. Every figure is the planner's or the stored risk results', rounded as in the app's card. */
export function recommendationBubbles(rec: Recommendation, focus: Focus, env: Env): BotBubble[] {
  const { t, fmt, distance, data } = env
  const { result, situation } = rec
  const pick = result.strategy
  const meta = data.meta
  const crops = [...new Set(meta.rotations[pick.rotation])]
  const ha = situation.hectares
  const haText = ha === undefined ? '' : Number.isInteger(ha) ? fmt.number(ha) : fmt.number(ha, 1)
  const money = (value: number) => fmt.number(roundMoney(value))
  const moneyLine = (value: number, gain: string, loss: string) => (roundMoney(value) < 0 ? t(loss, { n: money(-value) }) : t(gain, { n: money(value) }))
  const intro = t(`farmer.chat.recommendation.${focus === 'harvest' || focus === 'compare' ? 'plant' : focus}`)

  const next = nextCrop(pick.rotation, situation.previous, meta)
  const knownPrevious = situation.previous && situation.previous !== 'other' && situation.previous !== 'none'
  const withFertilizer = crops.filter((crop) => (pick.doses[crop] ?? 0) > 0)

  const crop: BotBubble = {
    text: [
      bold(t(`rotations.${pick.rotation}`)),
      crops.length > 1 ? t('farmer.rec.kind.alternate') : t('farmer.rec.kind.single'),
      situation.goal ? t('farmer.rec.forGoal', { goal: t(`farmer.rec.goals.${situation.goal}`) }) : '',
      ...(next ? [t('farmer.rec.thisSeason', { crop: t(`crops.${next}`) }), t('farmer.rec.thisSeasonWhy', { previous: t(`crops.${situation.previous}`).toLowerCase() })] : knownPrevious ? [t('farmer.rec.noMatch')] : []),
    ]
      .filter(Boolean)
      .join('\n'),
  }

  const income: BotBubble = {
    text: [
      `${bold(t('farmer.rec.net.label'))}: ${moneyLine(pick.values.net_mxn_ha, 'farmer.rec.net.value', 'farmer.rec.net.loss')}`,
      ...(ha !== undefined ? [`${bold(t('farmer.rec.total.label', { ha: haText }))}: ${moneyLine(pick.values.net_mxn_ha * ha, 'farmer.rec.total.value', 'farmer.rec.total.loss')}`] : []),
      `${bold(t('farmer.rec.bad.label'))}: ${moneyLine(pick.values.cvar_net_mxn_ha, 'farmer.rec.bad.value', 'farmer.rec.bad.loss')}`,
      t('farmer.rec.net.hint'),
      ...(meta.placeholders.length > 0 ? [t('farmer.rec.risks.costs')] : []),
    ].join('\n'),
  }

  const riskRows = rec.risk?.rows ?? []
  const failed = (scenario: string) => riskRows.find((row) => row.scenario === scenario)?.failedHarvestFraction
  const failedLine = (scenario: string, some: string, none: string) => {
    const share = failed(scenario) ?? 0
    const scenarioName = t(`farmer.rec.risks.scenarios.${scenario}`)
    return Math.round(share * 100) === 0 ? t(none, { scenario: scenarioName }) : t(some, { scenario: scenarioName, n: fmt.number(Math.round(share * 100)) })
  }
  const risks: BotBubble = {
    text: [
      bold(t('farmer.rec.risks.title')),
      bullets([
        moneyLine(pick.values.cvar_net_mxn_ha, 'farmer.rec.risks.badYear', 'farmer.rec.risks.badYearLoss'),
        ...(failed('baseline') !== undefined ? [failedLine('baseline', 'farmer.rec.risks.dryBase', 'farmer.rec.risks.dryBaseNone')] : []),
        ...DRY_SCENARIOS.filter((scenario) => failed(scenario) !== undefined).map((scenario) => failedLine(scenario, 'farmer.rec.risks.dry', 'farmer.rec.risks.dryNone')),
        ...(situation.water && situation.water !== 'rain' ? [t('farmer.rec.risks.irrigation')] : []),
        rec.zone.status === 'inside' ? t('farmer.rec.risks.zone', { km: distance(rec.zone.km) }) : t('farmer.rec.risks.zoneNear'),
      ]),
    ].join('\n'),
  }

  const todo: BotBubble = {
    text: [
      bold(t('farmer.rec.todo.title')),
      bullets([
        t('farmer.rec.todo.rotation', { rotation: t(`rotations.${pick.rotation}`).toLowerCase() }),
        ...(withFertilizer.length === 0 ? [t('farmer.rec.todo.fertilizerNone')] : withFertilizer.map((c) => t('farmer.rec.todo.fertilizer', { kg: fmt.number(pick.doses[c]), crops: t(`crops.${c}`).toLowerCase() }))),
        pick.retention > 0 ? t('farmer.rec.todo.stover', { pct: fmt.number(Math.round(pick.retention * 100)) }) : t('farmer.rec.todo.stoverNone'),
      ]),
      ...(withFertilizer.length > 0 ? [t('farmer.rec.todo.fertilizerWarn')] : []),
    ].join('\n'),
  }

  const others: BotBubble = {
    text: [
      t('farmer.rec.others.intro'),
      bullets(
        (['profit', 'sustainability'] as const).map((preset) => {
          const view = result.picks[preset]
          const same = view.rotation === pick.rotation && view.nScale === pick.nScale && view.retention === pick.retention
          if (same) return `${bold(t(`farmer.rec.others.${preset}`))}: ${t('farmer.rec.others.same')}`
          const loss = roundMoney(view.values.net_mxn_ha) < 0
          return `${bold(t(`farmer.rec.others.${preset}`))}: ${t(loss ? 'farmer.rec.others.lineLoss' : 'farmer.rec.others.line', { rotation: t(`rotations.${view.rotation}`), n: money(Math.abs(view.values.net_mxn_ha)) })}`
        }),
      ),
    ].join('\n'),
  }

  const harvest: BotBubble = {
    text: [t('farmer.rec.details.yield', { n: fmt.number(pick.values.yield_t_ha, 1) }), t('farmer.rec.details.note')].join('\n'),
  }

  const sure = confidenceBubble(rec, env)
  const lead: BotBubble = { text: intro }
  switch (focus) {
    case 'plant':
      return [lead, crop, todo, sure]
    case 'compare':
      return [lead, crop, others, sure]
    case 'money':
      return [lead, income, sure]
    case 'rain':
      return [lead, risks, sure]
    case 'harvest':
      return [lead, harvest, crop, sure]
  }
}

// ---- one turn of the conversation ----

export interface Turn {
  state: ChatState
  bubbles: BotBubble[]
}

/** Topics that need a location: everything about the models' results. */
const needsLocation = (text: string) => focusOf(text) !== null || ['trust', 'fertilizer'].includes(classify(text))

/** The bot's answer to one message. `text` is what the farmer typed, or the label of the button they tapped. */
export async function reply(text: string, state: ChatState, env: Env): Promise<Turn> {
  const { t } = env
  const named = readLocation(text)

  // choosing (or changing) the location: what was answered for another place is dropped, never carried over
  if (named) {
    const changed = named.id !== state.location
    const chosen: ChatState = { ...state, location: named.id, last: changed ? null : state.last }
    const confirm = changed ? locationBubbles(named, t) : []
    if (named.results === null) return { state: { ...chosen, pending: null, focus: null }, bubbles: confirm.length ? confirm : [unavailableBubble(named, t)] }
    // a question left waiting for a location is answered now
    if (state.pending === 'location' && state.focus) {
      const turn = await continueWith({ ...chosen, pending: null }, state.focus, env)
      return { state: turn.state, bubbles: [...confirm, ...turn.bubbles] }
    }
    // the same message may carry the question ("¿qué sembrar en Sonora?")
    if (needsLocation(text)) {
      const turn = await answer(text, { ...chosen, pending: null, focus: null }, env)
      return { state: turn.state, bubbles: [...confirm, ...turn.bubbles] }
    }
    return { state: { ...chosen, pending: null, focus: null }, bubbles: confirm.length ? confirm : locationBubbles(named, t).slice(0, 1) }
  }

  if (state.location === null && (needsLocation(text) || state.pending === 'location')) {
    return { state: { ...state, pending: 'location', focus: focusOf(text) ?? state.focus ?? 'plant' }, bubbles: [locationAsk(t)] }
  }
  return answer(text, state, env)
}

/** A message with a location already chosen. */
async function answer(text: string, state: ChatState, env: Env): Promise<Turn> {
  const { t } = env
  const place = demoLocation(state.location!)
  if (place.results === null && needsLocation(text)) return { state, bubbles: [unavailableBubble(place, t)] }

  // an answer to the question just asked
  if (state.pending && state.pending !== 'location') {
    const value = readAnswer(state.pending, text)
    if (value !== undefined) return afterAnswer({ ...state, situation: { ...state.situation, [state.pending]: value } }, env)
    // not an answer: a new question moves on; anything else is asked again, kindly
    if (focusOf(text) === null && classify(text) === 'unknown') {
      return { state, bubbles: [{ text: t('whatsapp.notUnderstood') }, askBubble(state.pending, false, t)] }
    }
  }

  const focus = focusOf(text)
  const context: Context = { hasParcel: true, situation: state.situation, zone: null, last: state.last }
  // the assistant decides what is missing; the two simulator topics are gated as a planting question
  const planned = planReply(focus === 'harvest' ? `${text} sembrar` : text, context)
  const situation = { ...state.situation, ...planned.patch }
  const base: ChatState = { ...state, situation, pending: null, focus: null }

  if (planned.plan.kind === 'recommend') return recommendNow({ ...base, focus: focus ?? 'plant' }, env)
  const bodies = planned.plan.bodies
  // what is said about the model's evidence or doses comes from the same experimental results
  const experimental = bodies.some((body) => body.kind === 'trust' || body.kind === 'fertilizer') ? [{ text: t('whatsapp.experimental') }] : []
  const asked = bodies.find((body) => body.kind === 'ask')
  return {
    state: asked && asked.kind === 'ask' && asked.field !== 'parcel' ? { ...base, pending: asked.field, focus: focus ?? 'plant' } : base,
    bubbles: [...experimental, ...bodies.flatMap((body) => bodyBubbles(body, env))],
  }
}

/** A planting-type question whose location has just been chosen: ask what is missing, or answer. */
function continueWith(state: ChatState, focus: Focus, env: Env): Promise<Turn> | Turn {
  const next = FIELDS.find((field) => state.situation[field] === undefined)
  if (next) return { state: { ...state, pending: next, focus }, bubbles: [askBubble(next, true, env.t)] }
  return recommendNow({ ...state, focus }, env)
}

function afterAnswer(state: ChatState, env: Env): Promise<Turn> | Turn {
  const next = FIELDS.find((field) => state.situation[field] === undefined)
  if (next) return { state: { ...state, pending: next }, bubbles: [askBubble(next, false, env.t)] }
  return recommendNow({ ...state, pending: null }, env)
}

async function recommendNow(state: ChatState, env: Env): Promise<Turn> {
  const { data, t } = env
  const focus = state.focus ?? 'plant'
  const place = demoLocation(state.location!)
  try {
    const rec = await (env.run ?? recommend)({
      data,
      point: { lat: place.latitude, lon: place.longitude },
      place: place.name,
      situation: state.situation,
      zone: demoZone(place, data),
      now: env.now?.(),
    })
    return { state: { ...state, focus: null, last: rec }, bubbles: [{ text: t('whatsapp.experimental') }, ...recommendationBubbles(rec, focus, env)] }
  } catch (error) {
    return { state: { ...state, focus: null }, bubbles: [{ text: t('farmer.chat.error', { message: error instanceof Error ? error.message : String(error) }) }] }
  }
}
