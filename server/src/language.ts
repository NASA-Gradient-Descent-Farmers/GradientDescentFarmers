// Which language a WhatsApp conversation is in. It starts from the first message (Spanish unless it is clearly English),
// changes when the sender asks ("english", "español") and, conservatively, when a message is clearly in the other language.
// Short messages that carry no language ("Sonora", "1", "ok") never change it.

import { fold } from '../../frontend/src/farmer/places.ts'
import type { Lang } from '../../frontend/src/lib/format.ts'

export type { Lang }

const TO_ENGLISH = new Set(['english', 'ingles', 'in english', 'en ingles', 'switch to english', 'speak english', 'habla ingles', 'cambiar a ingles'])
const TO_SPANISH = new Set(['espanol', 'spanish', 'in spanish', 'en espanol', 'switch to spanish', 'speak spanish', 'habla espanol', 'cambiar a espanol'])

/** The language the sender asked for, when the whole message is such a request. */
export function languageRequest(text: string): Lang | null {
  const q = fold(text).trim()
  if (TO_ENGLISH.has(q)) return 'en'
  if (TO_SPANISH.has(q)) return 'es'
  return null
}

// words that belong to one language only (accents are folded away before matching)
const ENGLISH = new Set(['the', 'what', 'how', 'which', 'where', 'who', 'why', 'should', 'could', 'would', 'can', 'do', 'does', 'is', 'are', 'was', 'my', 'me', 'i', 'you', 'your', 'plant', 'crop', 'crops', 'earn', 'harvest', 'income', 'climate', 'soil', 'rain', 'rains', 'little', 'much', 'many', 'need', 'about', 'please', 'hello', 'hi', 'hey', 'help', 'tell', 'data', 'come', 'from', 'with', 'for', 'best', 'there', 'this', 'that', 'it', 'if', 'of', 'to', 'and', 'on', 'field', 'farm'])
const SPANISH = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'que', 'como', 'cual', 'cuales', 'donde', 'cuando', 'cuanto', 'cuanta', 'por', 'para', 'con', 'mi', 'mis', 'tu', 'es', 'son', 'esta', 'este', 'sembrar', 'siembra', 'cultivo', 'cultivos', 'ganar', 'cosecha', 'cosechar', 'ingreso', 'clima', 'suelo', 'lluvia', 'llueve', 'poco', 'necesito', 'sobre', 'hola', 'buenas', 'ayuda', 'datos', 'salen', 'mejor', 'parcela', 'si', 'del', 'de', 'en', 'y', 'o', 'se', 'me', 'lo'])

function score(text: string): { en: number; es: number } {
  const words = fold(text).split(/[^a-z]+/).filter(Boolean)
  return { en: words.filter((word) => ENGLISH.has(word) && !SPANISH.has(word)).length, es: words.filter((word) => SPANISH.has(word) && !ENGLISH.has(word)).length }
}

/**
 * The language of a message when it is clear, else null. `margin` is how many more words of one language than the other it
 * takes: one is enough to open a conversation, two to change one that is under way.
 */
export function detectLanguage(text: string, margin = 1): Lang | null {
  const { en, es } = score(text)
  if (en >= margin && en > es) return 'en'
  if (es >= margin && es > en) return 'es'
  return null
}
