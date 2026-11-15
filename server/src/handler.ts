// One incoming WhatsApp message in, the text to send back out. This is a thin adapter: every decision (which location,
// what to ask, which figures to quote, "data unavailable") is made by the same engine the web simulator uses
// (frontend/src/whatsapp/engine.ts), on the same precomputed results. This file only adds what a text channel needs:
// numbered options, a reset word, message length limits and the link to the website.

import { fold } from '../../frontend/src/farmer/places.ts'
import { DICTIONARIES, translate } from '../../frontend/src/i18n/translate.ts'
import { makeFormat } from '../../frontend/src/lib/format.ts'
import type { RotationsByLocation } from '../../frontend/src/lib/rotations.ts'
import type { DashboardData } from '../../frontend/src/lib/types.ts'
import { EMPTY_CHAT, focusOf, greeting, needsLocation, readLocation, reply, type BotBubble, type Env } from '../../frontend/src/whatsapp/engine.ts'
import type { SessionStore } from './sessions.ts'

/** Twilio's limit for one reply message is 1600 characters. */
export const MAX_MESSAGE = 1500

const RESET_WORDS = new Set(['reiniciar', 'reinicio', 'reset', 'inicio', 'empezar', 'menu', 'ayuda'])

export const copy = {
  site: (url: string) => `Más información de YolIA: ${url}`,
  choose: 'Responde con el número o escribe tu respuesta:',
  textOnly: 'Por ahora solo puedo leer mensajes de texto. Escríbeme tu pregunta, o escribe *menu* para empezar de nuevo.',
  failed: 'No pude procesar tu mensaje. Inténtalo de nuevo, o escribe *menu* para empezar de nuevo.',
  restartHint: 'Escribe *menu* para empezar de nuevo.',
}

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
  sessions: SessionStore
  siteUrl: string
}

export function makeEnv(data: DashboardData, rotations: RotationsByLocation = {}): Env {
  const t = (path: string, vars?: Record<string, string | number>) => translate(DICTIONARIES.es, path, vars)
  const fmt = makeFormat('es')
  return { data, rotations, t, fmt, distance: (km) => (km < 1 ? t('where.lessThanOne') : fmt.number(km)) }
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
function render(bubbles: BotBubble[]): { text: string; options: string[] } {
  const options = bubbles[bubbles.length - 1]?.options?.map((o) => o.label) ?? []
  const body = bubbles.map((b) => b.text).join('\n\n')
  const list = options.length > 0 ? `\n\n${copy.choose}\n${options.map((label, i) => `${i + 1}. ${label}`).join('\n')}` : ''
  return { text: body + list, options }
}

/** The messages to send back for one incoming message. Never throws: a failure becomes an apology. */
export async function handleIncoming(message: Incoming, deps: HandlerDeps): Promise<string[]> {
  const { data, rotations, sessions, siteUrl } = deps
  const env = makeEnv(data, rotations)
  const sender = message.from
  const text = message.body.trim()
  try {
    if (!text) return [copy.textOnly]

    const known = sessions.get(sender)
    const reset = RESET_WORDS.has(fold(text))
    // a new conversation (or a restart) opens with who we are and the question of which location, unless the first
    // message already is a question or names a location
    if (reset || (!known && !readLocation(text) && !needsLocation(text) && focusOf(text) === null)) {
      const { text: opening, options } = render(greeting(env.t))
      sessions.set(sender, EMPTY_CHAT, options)
      return [...chunk(opening), copy.site(siteUrl)]
    }

    const state = known?.state ?? EMPTY_CHAT
    // a bare number picks the option offered last
    const picked = /^\d{1,2}$/.test(text) ? known?.options[Number(text) - 1] : undefined
    const turn = await reply(picked ?? text, state, env)
    const { text: out, options } = render(turn.bubbles)
    sessions.set(sender, turn.state, options)

    const messages = chunk(out)
    // the website link goes with each new set of results, and with a location that has none
    const newResult = (turn.state.last !== null && turn.state.last !== state.last) || turn.showsResults === true
    const noData = turn.state.location !== null && out.includes('Datos no disponibles')
    if (newResult || noData) messages.push(copy.site(siteUrl))
    else if (!known) messages.push(copy.restartHint)
    return messages
  } catch (error) {
    console.error('handler failed:', error instanceof Error ? error.message : 'unknown error')
    return [copy.failed]
  }
}
