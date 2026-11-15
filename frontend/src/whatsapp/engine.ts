// The brain of the WhatsApp simulator. Pure functions: a message goes in, the bot's text bubbles come out. Nothing
// here is a language model or a network call. The decisions come from the farmer assistant's own rules (farmer/chat.ts),
// the numbers from the planner and the stored rain-risk results (farmer/recommend.ts), the sentences from the existing
// Spanish dictionary. What this file adds is only the shape of a text chat: bubbles, quick-reply buttons and reading
// a typed answer ("2 hectáreas", "solo de la lluvia") where the app has big buttons.

import { classify, planReply, type Body, type Context } from '../farmer/chat.ts'
import { environmentTopicOf } from '../farmer/topics.ts'
import { evidenceFor, yearsText } from '../farmer/evidence.ts'
import { fold } from '../farmer/places.ts'
import { confidenceOf, DRY_SCENARIOS, nextCrop, recommend, roundMoney, type Recommendation, type Zone } from '../farmer/recommend.ts'
import { FIELDS, GOALS, PREVIOUS, validHectares, type Field, type Goal, type Previous, type Situation } from '../farmer/state.ts'
import type { Format, Lang } from '../lib/format.ts'
import { WATER, type Water } from '../lib/farm.ts'
import { DEMO_LOCATIONS, demoLocation, type DemoLocation, type DemoLocationId } from '../lib/demoLocations.ts'
import { distanceKm } from '../lib/geo.ts'
import type { EnvironmentByLocation } from '../lib/environment.ts'
import type { RotationsByLocation } from '../lib/rotations.ts'
import type { DashboardData } from '../lib/types.ts'
import { environmentBubbles, type EnvironmentTopic } from './environmentAnswers.ts'
import { locatedNote, rotationBubbles, type RotationTopic } from './rotationAnswers.ts'
import { districtAnswer, type DistrictAnswer, type DistrictIndex, type DistrictInputs, type PriorityId } from '../lib/district.ts'
import type { Narrator } from '../llm/client.ts'
import type { FollowUp } from '../llm/prompt.ts'
import { districtBubbles } from './districtAnswers.ts'
import { availableFollowUps, DEFAULT_FOLLOW_UPS, followUpLabel, narrateRequest, writtenSummary } from './summary.ts'

type T = (path: string, vars?: Record<string, string | number>) => string

/** The chat's topics: the assistant's three plus the two questions the simulator's suggestions add. */
export type Focus = 'plant' | 'money' | 'rain' | 'harvest' | 'compare'

/** What the conversation remembers between messages. Plain data, so a reset is just the empty state. */
export interface ChatState {
  situation: Situation
  /** The question the farmer is being asked, whose answer the next message is read as. */
  pending: Field | 'location' | DistrictQuestion | null
  /** What they originally asked, answered once the questions are done. */
  focus: Focus | EnvironmentTopic | null
  last: Recommendation | null
  /** The demonstration location chosen, used for every answer until another is chosen. */
  location: DemoLocationId | null
  /** What the farmer told the district engine in this chat (current rotation, water, priority). Only that engine reads it. */
  district?: DistrictInputs
}

/** The questions only the district engine asks. */
export type DistrictQuestion = 'districtRotation' | 'districtPriority' | 'districtRegime'
const DISTRICT_QUESTIONS: readonly string[] = ['districtRotation', 'districtPriority', 'districtRegime']

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
  /** The language of the conversation (the dictionary `t` and the formatter `fmt` already follow it). Spanish when not given. */
  lang?: Lang
  distance: (km: number) => string
  /** The rotation results loaded for the locations that have them; a location missing here has none. */
  rotations?: RotationsByLocation
  /** The environmental packages loaded for the places that have them (climate, soil, satellite series, sources). */
  environment?: EnvironmentByLocation
  /** For tests: what a place answers with, overriding its configuration (the planner flow has no configured place now). */
  kinds?: Partial<Record<DemoLocationId, 'experimental' | 'rotations' | null>>
  /** Injected so tests can run without the planner. */
  run?: typeof recommend
  now?: () => number
  /**
   * The SIAP district engine's precomputed answers (lib/district.ts). When given, a planting question gets one summary of both
   * engines with follow-up buttons, and the WOFOST details are one tap away; without it the chat answers as before.
   */
  district?: { index: DistrictIndex; base: string; fetcher?: typeof fetch; api?: string | null; translate?: <T>(value: T) => T }
  /** The language model that phrases the summary (llm/client.ts); null or failing means the written summary. */
  narrate?: Narrator | null
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
  if (/\b(agua|riego|optimizar|ahorrar|ahorro|litro|litros|water)\b/.test(q)) return 'water'
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

const HARVEST = /\b(cosech\w*|rendimiento|rendir\w*|produc\w*|toneladas|harvest\w*|yield\w*|tonnes?|tons?)\b/
const COMPARE = /\b(cultivo|cultivos)\b.*\b(mas|mejor)\b|\b(mejor|mejores) (cultivo|cultivos|opcion|opciones)\b|\b(best|better) (crop|crops|option|options)\b|\bwhich crop\b|\bcrop\b.*\b(best|better)\b/

/** What a question is about. The assistant's own classifier first; the two simulator topics only where it has no answer. */
export function focusOf(text: string): Focus | null {
  const q = fold(text)
  const base = classify(text)
  if (base === 'unknown' && HARVEST.test(q)) return 'harvest'
  if (base === 'plant' && COMPARE.test(q)) return 'compare'
  return base === 'plant' || base === 'money' || base === 'rain' ? base : null
}

// ---- reading a question about the place's data ----

export { environmentTopicOf } from '../farmer/topics.ts'
const ENVIRONMENT_TOPICS: readonly string[] = ['climate', 'soil', 'satellite', 'sources']
const isEnvironmentTopic = (topic: string | null): topic is EnvironmentTopic => topic !== null && ENVIRONMENT_TOPICS.includes(topic)

// ---- the sentences ----

const lowerFirst = (text: string) => text.replace(/^(¿?)(.)/, (_, mark: string, letter: string) => mark + letter.toLowerCase())
const upperFirst = (text: string) => text.replace(/^(¿?)(.)/, (_, mark: string, letter: string) => mark + letter.toUpperCase())
const bold = (text: string) => `*${text}*`


const coords = (place: DemoLocation) => `${place.latitude}, ${place.longitude}`

/** The opening of the chat: who we are, what the locations are, and the first question, which location. */
export const greeting = (t: T): BotBubble[] => [{ text: t('whatsapp.welcome') }, { text: t('whatsapp.demoParcel') }, locationAsk(t)]

function locationAsk(t: T): BotBubble {
  return { text: t('whatsapp.askLocation'), options: DEMO_LOCATIONS.map((place) => ({ label: place.name })) }
}

/**
 * What exists for a location right now: the bundled experimental results, the rotation results (only when they were
 * loaded), or nothing. Nothing is never filled in with another location's results.
 */
export function resultsKind(place: DemoLocation, env: Pick<Env, 'rotations' | 'kinds'>): 'experimental' | 'rotations' | null {
  if (env.kinds && place.id in env.kinds) return env.kinds[place.id] ?? null
  if (place.results === 'rotations') return env.rotations?.[place.id] ? 'rotations' : null
  return place.results
}

/** Confirms the location, and says what exists for it: rotation results, experimental data, or none. */
function locationBubbles(place: DemoLocation, env: Env): BotBubble[] {
  const { t } = env
  const head = t('whatsapp.locationSet', { name: place.name, coords: coords(place) })
  const kind = resultsKind(place, env)
  const note = kind === 'rotations' ? locatedNote(place.name, env.rotations![place.id]!, env) : kind === 'experimental' ? t('whatsapp.experimental') : t('whatsapp.unavailable', { name: place.name })
  const hint = env.environment?.[place.id] ? [{ text: t('whatsapp.envHint') }] : []
  return [{ text: `${head}\n${t('whatsapp.referencePoint')}` }, { text: note }, ...hint]
}

/** The question is about the place's own data: answered from its environmental package, with nothing left to ask. */
function environmentTurn(state: ChatState, topic: EnvironmentTopic, place: DemoLocation, env: Env): Turn {
  const environment = env.environment?.[place.id]
  if (!environment) return { state, bubbles: [unavailableBubble(place, env.t)] }
  // the question being asked (if any) stays pending: the next message still answers it
  return { state, bubbles: environmentBubbles(topic, place.name, environment, env), showsResults: true }
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
    case 'zone':
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
  /** True when the bubbles carry a set of results, so a channel can add its link to the website. */
  showsResults?: true
}

/** Topics that need a location: everything about the models' results. */
export const needsLocation = (text: string) => focusOf(text) !== null || ['trust', 'fertilizer'].includes(classify(text)) || environmentTopicOf(text) !== null

/** What a question about the results is about, in the rotation answers' terms, or null. */
function topicOf(text: string): RotationTopic | null {
  const focus = focusOf(text)
  if (focus) return focus
  const intent = classify(text)
  return intent === 'trust' || intent === 'fertilizer' ? intent : null
}

/** A location with rotation results: the question is answered from them, with nothing left to ask. */
async function rotationTurn(state: ChatState, topic: RotationTopic, place: DemoLocation, env: Env, text = ''): Promise<Turn> {
  // with the district engine on, "what to plant" is answered by one summary of both engines (the WOFOST details are a button away)
  if (env.district && (topic === 'plant' || topic === 'compare')) return summaryTurn({ ...state, pending: null, focus: null }, place, env, 'summary', text)
  const turn: Turn = { state: { ...state, pending: null, focus: null }, bubbles: rotationBubbles(topic, env.rotations![place.id]!, { ...env, observed: env.environment?.[place.id] ?? null }), showsResults: true }
  return env.district ? withFollowUps(turn, await districtFor(state, place, env), env, []) : turn
}

// ---- the district engine and the summary of both engines ----

/** The district engine's answer for this chat's place and answers, or null (no index, no place, a file missing). */
async function districtFor(state: ChatState, place: DemoLocation, env: Env): Promise<DistrictAnswer | null> {
  if (!env.district) return null
  try {
    const { water, goal, previous } = state.situation
    return await districtAnswer(place.id, env.district.index, state.district ?? {}, { water, goal, previous }, env.district.base, { fetcher: env.district.fetcher, api: env.district.api, translate: env.district.translate })
  } catch {
    return null
  }
}

/** Puts follow-up buttons under the last bubble: the ones given, else the defaults, without those just answered. */
function withFollowUps(turn: Turn, answer: DistrictAnswer | null, env: Env, skip: FollowUp[], chosen?: FollowUp[]): Turn {
  const possible = availableFollowUps(answer, env.rotations?.[turn.state.location!])
  const ids = [...(chosen?.length ? chosen : []), ...DEFAULT_FOLLOW_UPS].filter((id, i, all) => possible.includes(id) && !skip.includes(id) && all.indexOf(id) === i).slice(0, 4)
  if (turn.bubbles.length === 0 || ids.length === 0) return turn
  const bubbles = [...turn.bubbles]
  const last = bubbles[bubbles.length - 1]
  bubbles[bubbles.length - 1] = { ...last, options: ids.map((id) => ({ label: followUpLabel(id, env.t) })) }
  return { ...turn, bubbles }
}

/** One message that sums up both engines for the farmer: phrased by the language model when it can, else written. */
async function summaryTurn(state: ChatState, place: DemoLocation, env: Env, mode: 'summary' | 'question', question: string): Promise<Turn> {
  const answer = await districtFor(state, place, env)
  const rotations = env.rotations?.[place.id]
  const ctx = { t: env.t, fmt: env.fmt, goal: state.situation.goal ?? null }
  const narrated = env.narrate ? await env.narrate(narrateRequest(mode, question || env.t('whatsapp.district.summaryQuestion'), place, answer, rotations, { ...ctx, language: env.lang ?? 'es' })) : null
  if (mode === 'question' && !narrated) return { state, bubbles: [] }
  const text = narrated ? `${narrated.reply}

_${env.t('whatsapp.district.byModel')}_` : writtenSummary(place, answer, rotations, ctx)
  return withFollowUps({ state, bubbles: [{ text }], showsResults: true }, answer, env, [], narrated?.followUps)
}

const FOLLOW_UP_IDS: readonly FollowUp[] = ['wofost', 'district', 'why', 'risks', 'money', 'trends', 'water', 'trust', 'rotation', 'priority', 'regime']

/** The follow-up a message is (a tapped button, or the same words typed), or null. */
export function followUpOf(text: string, t: T): FollowUp | null {
  const q = fold(text)
  return FOLLOW_UP_IDS.find((id) => fold(followUpLabel(id, t)) === q) ?? null
}

const PRIORITY_ORDER: PriorityId[] = ['ingreso', 'riesgo', 'agua', 'suelo', 'erosion', 'plagas', 'forraje']

function districtAsk(question: DistrictQuestion, answer: DistrictAnswer, place: DemoLocation, env: Env): BotBubble {
  const { t } = env
  if (question === 'districtRotation') {
    const options = env.district!.index.lugares[place.id]?.regimenes[answer.inputs.agua] ?? []
    return { text: t('whatsapp.district.askRotation', { regime: t(`district.regime.${answer.inputs.agua}`) }), options: options.map((o) => ({ label: o.etiqueta })) }
  }
  if (question === 'districtPriority') {
    return { text: t('whatsapp.district.askPriority'), options: [...PRIORITY_ORDER.map((id) => ({ label: t(`district.priority.${id}`) })), { label: t('whatsapp.district.noPriority') }] }
  }
  return { text: t('whatsapp.district.askRegime'), options: [{ label: t('whatsapp.district.regimeRiego') }, { label: t('whatsapp.district.regimeTemporal') }] }
}

/** Reads the answer to a district question; undefined when the text does not answer it. */
function readDistrictAnswer(question: DistrictQuestion, text: string, state: ChatState, place: DemoLocation, env: Env): DistrictInputs | undefined {
  const q = fold(text)
  const { t } = env
  const own = state.district ?? {}
  if (question === 'districtRotation') {
    const regimes = env.district!.index.lugares[place.id]?.regimenes ?? {}
    for (const options of Object.values(regimes)) {
      const hit = options?.find((o) => fold(o.etiqueta) === q || fold(o.rotacion) === q)
      if (hit) return { ...own, rotacion: hit.id }
    }
    return undefined
  }
  if (question === 'districtPriority') {
    if (q === fold(t('whatsapp.district.noPriority'))) return { ...own, prioridades: [] }
    const hit = PRIORITY_ORDER.find((id) => fold(t(`district.priority.${id}`)) === q)
    return hit ? { ...own, prioridades: [hit] } : undefined
  }
  if (q === fold(t('whatsapp.district.regimeRiego')) || /\briego\b/.test(q)) return { ...own, agua: 'riego', rotacion: undefined }
  if (q === fold(t('whatsapp.district.regimeTemporal')) || /\b(temporal|lluvia)\b/.test(q)) return { ...own, agua: 'temporal', rotacion: undefined }
  return undefined
}

/** A tapped follow-up (or the same words typed) at a place with results. */
async function followUpTurn(id: FollowUp, state: ChatState, place: DemoLocation, env: Env): Promise<Turn> {
  const answer = await districtFor(state, place, env)
  const rotations = env.rotations?.[place.id]
  const base: ChatState = { ...state, pending: null, focus: null }
  const ctx = { t: env.t, fmt: env.fmt }
  const wofost = (topic: RotationTopic) => (rotations ? rotationBubbles(topic, rotations, { ...env, observed: env.environment?.[place.id] ?? null, goal: state.situation.goal ?? null, water: state.situation.water ?? null }) : [unavailableBubble(place, env.t)])
  const none = [{ text: env.t('whatsapp.district.districtNone') }]
  let bubbles: BotBubble[]
  switch (id) {
    case 'wofost':
      bubbles = wofost('plant')
      break
    case 'district':
      bubbles = answer ? districtBubbles('summary', answer, ctx) : none
      break
    case 'why':
    case 'risks':
    case 'trends':
    case 'water':
      bubbles = answer ? districtBubbles(id, answer, ctx) : none
      break
    case 'money':
      bubbles = [...(rotations ? wofost('money') : []), ...(answer ? districtBubbles('money', answer, ctx) : [])]
      break
    case 'trust':
      bubbles = [...(rotations ? wofost('trust') : []), ...(answer ? [{ text: answer.result.como_leer }] : [])]
      break
    case 'rotation':
    case 'priority':
    case 'regime': {
      if (!answer) return { state: base, bubbles: none }
      const question: DistrictQuestion = id === 'rotation' ? 'districtRotation' : id === 'priority' ? 'districtPriority' : 'districtRegime'
      return { state: { ...base, pending: question }, bubbles: [districtAsk(question, answer, place, env)] }
    }
  }
  return withFollowUps({ state: base, bubbles, showsResults: true }, answer, env, [id])
}

/** The bot's answer to one message. `text` is what the farmer typed, or the label of the button they tapped. */
export async function reply(text: string, state: ChatState, env: Env): Promise<Turn> {
  const { t } = env
  if (env.district) {
    const turn = await districtReply(text, state, env)
    if (turn) return turn
  }
  const named = readLocation(text)

  // choosing (or changing) the location: what was answered for another place is dropped, never carried over
  if (named) {
    const changed = named.id !== state.location
    const chosen: ChatState = { ...state, location: named.id, last: changed ? null : state.last }
    const confirm = changed ? locationBubbles(named, env) : []
    const kind = resultsKind(named, env)
    const hasEnvironment = Boolean(env.environment?.[named.id])
    if (kind === null && !hasEnvironment) return { state: { ...chosen, pending: null, focus: null }, bubbles: confirm.length ? confirm : [unavailableBubble(named, t)] }
    // a question left waiting for a location is answered now
    if (state.pending === 'location' && state.focus) {
      if (isEnvironmentTopic(state.focus)) {
        const turn = environmentTurn({ ...chosen, pending: null, focus: null }, state.focus, named, env)
        return { ...turn, bubbles: [...confirm, ...turn.bubbles] }
      }
      if (kind === null) return { state: { ...chosen, pending: null, focus: null }, bubbles: confirm.length ? confirm : [unavailableBubble(named, t)] }
      const turn = kind === 'rotations' ? await rotationTurn(chosen, state.focus, named, env) : await continueWith({ ...chosen, pending: null }, state.focus, env)
      return { ...turn, bubbles: [...confirm, ...turn.bubbles] }
    }
    // the same message may carry the question ("¿qué sembrar en Sonora?")
    if (needsLocation(text)) {
      const turn = await answer(text, { ...chosen, pending: null, focus: null }, env)
      return { ...turn, bubbles: [...confirm, ...turn.bubbles] }
    }
    return { state: { ...chosen, pending: null, focus: null }, bubbles: [...(confirm.length ? confirm : locationBubbles(named, env).slice(0, 1)), { text: t('whatsapp.nextStep') }] }
  }

  if (state.location === null && (needsLocation(text) || state.pending === 'location')) {
    return { state: { ...state, pending: 'location', focus: focusOf(text) ?? environmentTopicOf(text) ?? state.focus ?? 'plant' }, bubbles: [locationAsk(t)] }
  }
  // no location chosen and nothing that needs one ("hola" again, a message with no topic): start from the greeting
  if (state.location === null) return { state, bubbles: greeting(t) }
  return answer(text, state, env)
}

/** The district engine's part of a reply: a follow-up button, or the answer to a district question. Null when it is neither. */
async function districtReply(text: string, state: ChatState, env: Env): Promise<Turn | null> {
  const place = state.location ? demoLocation(state.location) : null
  if (place && state.pending && DISTRICT_QUESTIONS.includes(state.pending)) {
    const inputs = readDistrictAnswer(state.pending as DistrictQuestion, text, state, place, env)
    if (inputs) return summaryTurn({ ...state, pending: null, focus: null, district: inputs }, place, env, 'summary', '')
  }
  const id = followUpOf(text, env.t)
  if (!id) return null
  if (!place) return { state: { ...state, pending: 'location', focus: 'plant' }, bubbles: [locationAsk(env.t)] }
  return followUpTurn(id, state, place, env)
}

/** A free question the rules cannot place, at a place with results: the language model answers from the facts, or null. */
async function freeQuestion(text: string, state: ChatState, place: DemoLocation, env: Env): Promise<Turn | null> {
  if (!env.district || !env.narrate) return null
  const turn = await summaryTurn(state, place, env, 'question', text)
  return turn.bubbles.length > 0 ? turn : null
}

/** A message with a location already chosen. */
async function answer(text: string, state: ChatState, env: Env): Promise<Turn> {
  const { t } = env
  const place = demoLocation(state.location!)
  const kind = resultsKind(place, env)
  // an answer to the question just asked ("cuidar el suelo") is an answer, not a question about the soil
  // the district engine's own questions are read in districtReply; here only the four parcel questions count
  const field: Field | null = state.pending !== null && (FIELDS as readonly string[]).includes(state.pending) ? (state.pending as Field) : null
  const answersPending = field !== null && readAnswer(field, text) !== undefined
  const dataTopic = answersPending ? null : environmentTopicOf(text)
  if (dataTopic) return environmentTurn(state, dataTopic, place, env)
  if (kind === null && needsLocation(text)) return { state, bubbles: [unavailableBubble(place, t)] }
  if (kind === 'rotations') {
    const topic = topicOf(text)
    if (topic) return rotationTurn(state, topic, place, env, text)
    // a question the rules cannot place (and that answers nothing pending): the language model may answer it from the facts
    if (!answersPending && classify(text) === 'unknown') {
      const free = await freeQuestion(text, { ...state, pending: null, focus: null }, place, env)
      if (free) return free
    }
  }

  // an answer to the question just asked
  if (field) {
    const value = readAnswer(field, text)
    if (value !== undefined) return afterAnswer({ ...state, situation: { ...state.situation, [field]: value } }, env)
    // not an answer: a new question moves on; anything else is asked again, kindly
    if (focusOf(text) === null && classify(text) === 'unknown') {
      return { state, bubbles: [{ text: t('whatsapp.notUnderstood') }, askBubble(field, false, t)] }
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
  const focus: Focus = state.focus && !isEnvironmentTopic(state.focus) ? state.focus : 'plant'
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
