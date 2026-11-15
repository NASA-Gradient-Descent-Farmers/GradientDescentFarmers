// Reading a question about a place's own data (its climate, soil and terrain, satellite series, or where the data comes from)
// from plain words in Spanish or English. Shared by the chat in the app and the WhatsApp chat.

import type { EnvironmentTopic } from '../whatsapp/environmentAnswers.ts'
import { classify } from './chat.ts'
import { fold } from './places.ts'

const SOURCES = /\b(fuente|fuentes|de donde (salen|vienen|sacan)|origen de (los )?datos|que datos|calidad de (los )?datos|nasa|sources?|where does the data|data (come|comes) from|origin of the data|which data|data quality)\b/
const SATELLITE = /\b(satelite|satelites|satelital|vegetacion|ndvi|evi|evapotranspiracion|humedad del suelo|temperatura de la superficie|satellites?|vegetation|evapotranspiration|soil moisture|surface temperature)\b/
const SOIL = /\b(suelo|ph|arcilla|arena|textura|carbono organico|altitud|elevacion|pendiente|terreno|soil|clay|sand|texture|organic carbon|altitude|elevation|slope|terrain)\b/
const CLIMATE = /\b(clima|temperatura|calor|caluroso|frio|lluvia|lluvias|llueve|precipitacion|meses|climate|temperature|hot|cold|rain|rainfall|precipitation|weather|months)\b/

/**
 * A question about the place's own data. The assistant's rain-risk ("¿y si llueve poco?"), fertilizer and planting questions
 * keep their own answers.
 */
export function environmentTopicOf(text: string): EnvironmentTopic | null {
  const q = fold(text)
  const base = classify(text)
  if (base === 'fertilizer' || base === 'rain') return null
  if (SOURCES.test(q)) return 'sources'
  if (SATELLITE.test(q)) return 'satellite'
  if (SOIL.test(q)) return 'soil'
  if (CLIMATE.test(q)) return 'climate'
  return null
}
