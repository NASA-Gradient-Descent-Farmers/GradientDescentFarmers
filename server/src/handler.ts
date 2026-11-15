// One incoming WhatsApp message in, the text to send back out. This is a thin adapter: every decision (which location,
// what to ask, which figures to quote, "data unavailable") is made by the same engine the web simulator uses
// (frontend/src/whatsapp/engine.ts), on the same precomputed results. This file only adds what a text channel needs:
// numbered options, a reset word, message length limits and the link to the website.

import { fold } from '../../frontend/src/farmer/places.ts'
import { DICTIONARIES, translate } from '../../frontend/src/i18n/translate.ts'
import { makeFormat, type Lang } from '../../frontend/src/lib/format.ts'
import type { EnvironmentByLocation } from '../../frontend/src/lib/environment.ts'
import type { RotationsByLocation } from '../../frontend/src/lib/rotations.ts'
import type { DashboardData } from '../../frontend/src/lib/types.ts'
import { EMPTY_CHAT, focusOf, greeting, needsLocation, readLocation, reply, type BotBubble, type Env } from '../../frontend/src/whatsapp/engine.ts'
import { detectLanguage, languageRequest } from './language.ts'
import type { SessionStore } from './sessions.ts'

/** Twilio's limit for one reply message is 1600 characters. */
export const MAX_MESSAGE = 1500

const RESET_WORDS = new Set(['reiniciar', 'reinicio', 'reset', 'inicio', 'empezar', 'menu', 'ayuda', 'restart', 'start over', 'start', 'begin', 'help'])

/** The words the server itself writes (everything else comes from the shared engine), in the sender's language. */
export const copyFor = (lang: Lang) =>
  lang === 'en'
    ? {
        site: (url: string) => `More about YoliA: ${url}`,
        choose: 'Reply with the number or type your answer:',
        textOnly: 'For now I can only read text messages. Write your question, or type *menu* to start over.',
        failed: 'I could not process your message. Try again, or type *menu* to start over.',
        restartHint: 'Type *menu* to start over.',
        languageHint: 'Prefer Spanish? Type *español*.',
        switched: 'Okay, I will continue in English.',
      }
    : {
        site: (url: string) => `Más información de YoliA: ${url}`,
        choose: 'Responde con el número o escribe tu respuesta:',
        textOnly: 'Por ahora solo puedo leer mensajes de texto. Escríbeme tu pregunta, o escribe *menu* para empezar de nuevo.',
        failed: 'No pude procesar tu mensaje. Inténtalo de nuevo, o escribe *menu* para empezar de nuevo.',
        restartHint: 'Escribe *menu* para empezar de nuevo.',
        languageHint: 'Si prefieres inglés, escribe *english*.',
        switched: 'Listo, seguiré en español.',
      }

/** Spanish, the original wording; kept for callers that do not choose a language. */
export const copy = copyFor('es')

export interface Incoming {
  /** The sender's WhatsApp address, e.g. "whatsapp:+521234567890". */
  from: string
  body: string
  /** Number of attached files (photos, voice notes): not read. */
  media: number
}

export interface HandlerDeps {
  data: DashboardData
  /** Rotation results for the locations that have them; a location without an entry answers "data unavailable". */
  rotations: RotationsByLocation
  /** Environmental packages for the places that have them (climate, soil, satellite series, sources). */
  environment?: EnvironmentByLocation
  sessions: SessionStore
  siteUrl: string
}

export function makeEnv(data: DashboardData, rotations: RotationsByLocation = {}, environment: EnvironmentByLocation = {}, lang: Lang = 'es'): Env {
  const t = (path: string, vars?: Record<string, string | number>) => translate(DICTIONARIES[lang], path, vars)
  const fmt = makeFormat(lang)
  return { data, rotations, environment, lang, t, fmt, distance: (km) => (km < 1 ? t('where.lessThanOne') : fmt.number(km)) }
}

/** Splits text into messages no longer than `max`, breaking between paragraphs where it can. */
export function chunk(text: string, max = MAX_MESSAGE): string[] {
  const parts: string[] = []
  let current = ''
  for (const paragraph of text.split('\n\n')) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph
    if (next.length <= max) {
      current = next
      continue
    }
    if (current) parts.push(current)
    let rest = paragraph
    while (rest.length > max) {
      const newline = rest.lastIndexOf('\n', max)
      const cut = newline > max / 2 ? newline : max
      parts.push(rest.slice(0, cut).trimEnd())
      rest = rest.slice(cut).trimStart()
    }
    current = rest
  }
  if (current) parts.push(current)
  return parts
}

/** The bubbles as one WhatsApp text: paragraphs, and the last bubble's quick replies as a numbered list. */
function render(bubbles: BotBubble[], lang: Lang): { text: string; options: string[] } {
  const options = bubbles[bubbles.length - 1]?.options?.map((o) => o.label) ?? []
  const body = bubbles.map((b) => b.text).join('\n\n')
  const list = options.length > 0 ? `\n\n${copyFor(lang).choose}\n${options.map((label, i) => `${i + 1}. ${label}`).join('\n')}` : ''
  return { text: body + list, options }
}

/** The messages to send back for one incoming message. Never throws: a failure becomes an apology. */
export async function handleIncoming(message: Incoming, deps: HandlerDeps): Promise<string[]> {
  const { data, rotations, environment, sessions, siteUrl } = deps
  const sender = message.from
  const text = message.body.trim()
  const known = sessions.get(sender)
  // the language: asked for, else clear from the message (one word opens a conversation, two change one under way), else kept
  const requested = languageRequest(text)
  const lang: Lang = requested ?? detectLanguage(text, known ? 2 : 1) ?? known?.lang ?? 'es'
  const words = copyFor(lang)
  try {
    if (!text) return [words.textOnly]

    const env = makeEnv(data, rotations, environment, lang)
    const reset = RESET_WORDS.has(fold(text)) || requested !== null
    // a new conversation (or a restart, or a change of language) opens with who we are and the question of which location,
    // unless the first message already is a question or names a location
    if (reset || (!known && !readLocation(text) && !needsLocation(text) && focusOf(text) === null)) {
      const { text: opening, options } = render(greeting(env.t), lang)
      sessions.set(sender, EMPTY_CHAT, options, lang)
      return [...(requested ? [words.switched] : []), ...chunk(opening), words.languageHint, words.site(siteUrl)]
    }

    const state = known?.state ?? EMPTY_CHAT
    // a bare number picks the option offered last
    const picked = /^\d{1,2}$/.test(text) ? known?.options[Number(text) - 1] : undefined
    const turn = await reply(picked ?? text, state, env)
    const { text: out, options } = render(turn.bubbles, lang)
    sessions.set(sender, turn.state, options, lang)

    const messages = chunk(out)
    // the website link goes with each new set of results, and with a location that has none
    const newResult = (turn.state.last !== null && turn.state.last !== state.last) || turn.showsResults === true
    const noData = turn.state.location !== null && /Datos no disponibles|Data unavailable/.test(out)
    if (newResult || noData) messages.push(words.site(siteUrl))
    else if (!known) messages.push(words.restartHint)
    return messages
  } catch (error) {
    console.error('handler failed:', error instanceof Error ? error.message : 'unknown error')
    return [words.failed]
  }
}
