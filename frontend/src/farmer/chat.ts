// The farmer's conversation with YoliA. The reply is decided here, from the question and what we already know: a
// question about planting asks first for whatever is missing (the parcel, then the four answers), then runs the
// planner; everything else is answered from the models' own results or declined honestly. Nothing is invented:
// there is no text here that states an agricultural fact, only questions, pointers and the cards the models fill.

import { newId } from '../assistant/history.ts'
import { fold } from './places.ts'
import type { Recommendation, Zone } from './recommend.ts'
import type { DemoLocationId } from '../lib/demoLocations.ts'
import type { Water } from '../lib/farm.ts'
import type { EnvironmentTopic } from '../whatsapp/environmentAnswers.ts'
import type { RotationTopic } from '../whatsapp/rotationAnswers.ts'
import { FIELDS, missing, type Field, type Goal, type Previous, type Situation } from './state.ts'
import { scopedKey } from '../account/storage.ts'

export type Intent = 'plant' | 'money' | 'rain' | 'trust' | 'fertilizer' | 'hello' | 'unknown'

/** What a question is about, from plain words in Spanish or English. The order matters: the narrower topics come first. */
export function classify(text: string): Intent {
  const q = fold(text)
  const has = (pattern: RegExp) => pattern.test(q)
  if (has(/\b(abono|abonar|fertiliz\w*|nitrogeno|fertilizer|nitrogen)\b/)) return 'fertilizer'
  if (has(/\b(llueve poco|sequia|seca|poca lluvia|helada|heladas|canicula|riesgo|riesgos|mal ano|drought|frost|risk|rains little)\b/)) return 'rain'
  if (has(/\b(seguro|seguros|segura|seguras|confi\w*|cierto|ciertos|garantia|garantiza\w*|certeza|funciona|datos|trust|sure|reliable|accurate)\b/)) return 'trust'
  if (has(/\b(ganar|gano|ganancia|ganancias|ingreso|ingresos|dinero|rentable|cuanto voy|earn|income|profit|money)\b/)) return 'money'
  if (has(/\b(sembr\w*|cultiv\w*|rotacion|conviene|recomiend\w*|plant|rotation|grow|crop)\b/)) return 'plant'
  if (has(/^(hola|buenas|buenos dias|buenas tardes|buenas noches|hello|hi)\b/)) return 'hello'
  return 'unknown'
}

const CROP_WORDS: Record<string, Previous> = { maiz: 'maize', corn: 'maize', maize: 'maize', cebada: 'barley', barley: 'barley', haba: 'fababean', habas: 'fababean', fava: 'fababean', faba: 'fababean' }

/** "¿Qué me conviene sembrar después del maíz?": the crop the farmer names as last season's. */
export function extractPrevious(text: string): Previous | null {
  const match = fold(text).match(/\b(?:despues|tras|luego|after)\s+(?:del|de la|de los|de las|de|of|the)?\s*(maiz|cebada|habas?|corn|maize|barley|fava|faba)\b/)
  return match ? (CROP_WORDS[match[1]] ?? null) : null
}

export interface Context {
  hasParcel: boolean
  situation: Situation
  zone: Zone | null
  /** The latest recommendation in this conversation or among the saved ones, for questions about its numbers. */
  last: Recommendation | null
}

/** The next thing to ask: the parcel first, then the first unanswered question, or nothing. */
export const nextAsk = (hasParcel: boolean, situation: Situation): 'parcel' | Field | null => (!hasParcel ? 'parcel' : (missing(situation)[0] ?? null))

export type Body =
  | { kind: 'greeting' }
  /** A question with its answer buttons; `lead` adds the sentence that opens the questions. */
  | { kind: 'ask'; field: 'parcel' | Field; lead: boolean }
  | { kind: 'recommendation'; rec: Recommendation; focus: 'plant' | 'money' | 'rain' }
  /** An answer built from what the data service published for the parcel's place; `km` is the distance to that place. */
  | { kind: 'zone'; topic: RotationTopic | EnvironmentTopic; place: DemoLocationId; km: number; goal?: Goal; water?: Water }
  | { kind: 'outside'; km: number }
  | { kind: 'fertilizer'; rec: Recommendation | null }
  | { kind: 'trust' }
  | { kind: 'unknown' }
  | { kind: 'error'; message: string }

/** A user message. `key` (a dictionary path, with its `vars`) is kept for what a button said, so it is shown in the language chosen now. */
export type Turn = { id: string; at: number; role: 'user'; text: string; key?: string; vars?: Record<string, string | number> } | { id: string; at: number; role: 'bot'; body: Body }

export const userTurn = (text: string, said?: { key: string; vars?: Record<string, string | number> }, at = Date.now()): Turn => ({ id: newId(), at, role: 'user', text, ...(said ?? {}) })
export const botTurn = (body: Body, at = Date.now()): Turn => ({ id: newId(), at, role: 'bot', body })

export type Plan =
  /** Answer now with these. */
  | { kind: 'say'; bodies: Body[] }
  /** Run the planner, then answer with the recommendation (or, outside the zone, the warning). */
  | { kind: 'recommend'; focus: 'plant' | 'money' | 'rain' }

export interface Reply {
  /** Answers read from the question itself (the crop named as last season's). */
  patch: Situation
  /** What a planting question was about, kept while the missing answers are asked for; null for the other topics. */
  focus: 'plant' | 'money' | 'rain' | null
  plan: Plan
}

export function planReply(text: string, context: Context): Reply {
  const intent = classify(text)
  const previous = extractPrevious(text)
  const patch: Situation = previous ? { previous } : {}
  const focus = intent === 'plant' || intent === 'money' || intent === 'rain' ? intent : null
  const situation = { ...context.situation, ...patch }

  if (intent === 'hello') return { patch, focus, plan: { kind: 'say', bodies: [{ kind: 'greeting' }] } }
  if (intent === 'fertilizer') return { patch, focus, plan: { kind: 'say', bodies: [{ kind: 'fertilizer', rec: context.last }] } }
  if (intent === 'trust') return { patch, focus, plan: { kind: 'say', bodies: [{ kind: 'trust' }] } }
  if (intent === 'unknown') return { patch, focus, plan: { kind: 'say', bodies: [{ kind: 'unknown' }] } }

  // planting, money and rain all need the same: the parcel, the four answers, and a parcel the model was fitted for
  const ask = nextAsk(context.hasParcel, situation)
  if (ask) return { patch, focus, plan: { kind: 'say', bodies: [{ kind: 'ask', field: ask, lead: true }] } }
  if (context.zone?.status === 'outside') return { patch, focus, plan: { kind: 'say', bodies: [{ kind: 'outside', km: context.zone.km }] } }
  return { patch, focus, plan: { kind: 'recommend', focus: intent } }
}

// ---- keeping the conversation on this phone ----

const STORAGE_KEY = 'yolia-chat'
export const MAX_TURNS = 40

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
// answers from the old Texcoco planner ('recommendation', 'outside') are not kept: they are not what the app answers with now
const KINDS = ['greeting', 'ask', 'zone', 'fertilizer', 'trust', 'unknown', 'error'] as const

function isTurn(value: unknown): value is Turn {
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.at !== 'number') return false
  if (value.role === 'user') return typeof value.text === 'string' && (value.key === undefined || typeof value.key === 'string')
  if (value.role !== 'bot' || !isObject(value.body)) return false
  const { kind, field } = value.body
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) return false
  if (kind === 'ask') return field === 'parcel' || (FIELDS as readonly unknown[]).includes(field)
  if (kind === 'zone') return typeof value.body.topic === 'string' && typeof value.body.place === 'string' && typeof value.body.km === 'number'
  return true
}

export function parseChat(text: string | null): Turn[] {
  if (!text) return []
  try {
    const raw = JSON.parse(text) as unknown
    return Array.isArray(raw) ? raw.filter(isTurn).slice(-MAX_TURNS) : []
  } catch {
    return []
  }
}

export function loadChat(): Turn[] {
  try {
    return parseChat(localStorage.getItem(scopedKey(STORAGE_KEY)))
  } catch {
    return []
  }
}

export function storeChat(turns: Turn[]): void {
  try {
    localStorage.setItem(scopedKey(STORAGE_KEY), JSON.stringify(turns.slice(-MAX_TURNS)))
  } catch {
    // storage blocked or full: the conversation lasts for this visit only
  }
}

