// The rotation service writes some of its text in Spanish (the option description, its highlights, the confidence label and its
// reasons, the crop names). In English they are translated here, and only from patterns known to be the service's own: a text
// that matches none is shown as the service wrote it, never guessed. `rotationText.test.ts` checks that every such text in the
// published runs is covered, so a new run with a new sentence fails there until it is added.

import type { Lang } from './format.ts'
import type { RotationCampaign, RotationOption } from './rotations.ts'

const CROPS: Record<string, string> = { Maíz: 'Maize', Garbanzo: 'Chickpea', Sorgo: 'Sorghum', Trigo: 'Wheat', Barbecho: 'Fallow' }

/** The crop's name in the language: the service's Spanish label, or its English equivalent. */
export const cropName = (cropEs: string, lang: Lang): string => (lang === 'en' ? (CROPS[cropEs] ?? cropEs) : cropEs)

const REASONS: Record<string, string> = {
  'Variedades de referencia sin calibración ni validación independiente en estas parcelas.': 'Reference varieties without calibration or independent validation on these plots.',
  'Clima histórico 2024–2025: los resultados no son un pronóstico meteorológico o de cosecha.': 'Historical weather 2024–2025: the results are not a weather or harvest forecast.',
  'Profundidad efectiva, drenaje, agua inicial y manejo de riego incluyen supuestos.': 'Effective depth, drainage, initial water and irrigation management include assumptions.',
  'No se simulan salinidad, nutrientes, plagas ni cambios medidos del carbono del suelo.': 'Salinity, nutrients, pests and measured changes in soil carbon are not simulated.',
  'Se excluyen campañas sin madurez con este calendario y parámetros; no demuestra que el cultivo sea inviable en la región.': 'Seasons that do not reach maturity with this calendar and these parameters are excluded; this does not show the crop is unviable in the region.',
}
const LABELS: Record<string, string> = { 'Exploratorio: sin calibración local': 'Exploratory: no local calibration' }

/** The confidence reason in the language (the service's own sentence in Spanish). */
export const reasonText = (reasonEs: string, lang: Lang): string => (lang === 'en' ? (REASONS[reasonEs] ?? reasonEs) : reasonEs)
export const confidenceLabelText = (labelEs: string, lang: Lang): string => (lang === 'en' ? (LABELS[labelEs] ?? labelEs) : labelEs)

/** The service's highlight sentences, as patterns with the numbers they carry. */
const HIGHLIGHTS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Ingreso bruto de escenario: (\d+) MXN\/ha; no es utilidad neta garantizada\.$/, (m) => `Scenario gross income: ${m[1]} MXN/ha; not a guaranteed net profit.`],
  [/^Riego aplicado de escenario: (\d+) m³\/ha en el horizonte\.$/, (m) => `Scenario irrigation applied: ${m[1]} m³/ha over the horizon.`],
  [/^Índice de diversidad\/suelo: (\d+)\/(\d+); es un indicador heurístico\.$/, (m) => `Diversity/soil index: ${m[1]}/${m[2]}; it is a heuristic indicator.`],
  [/^(\d+) campañas con cosecha simulada inferior a (\d+) kg\/ha: escenario de alto riesgo, no plan operativo validado\.$/, (m) => `${m[1]} season(s) with a simulated harvest below ${m[2]} kg/ha: a high-risk scenario, not a validated operational plan.`],
]

/** One of the service's highlight sentences in the language, or as the service wrote it when it is not a known one. */
export function highlightText(lineEs: string, lang: Lang): string {
  if (lang !== 'en') return lineEs
  for (const [pattern, translate] of HIGHLIGHTS) {
    const match = lineEs.match(pattern)
    if (match) return translate(match)
  }
  return lineEs
}

/** True when the language has a translation for the sentence (always true in Spanish, which is the service's own). */
export const highlightKnown = (lineEs: string): boolean => HIGHLIGHTS.some(([pattern]) => pattern.test(lineEs))
export const reasonKnown = (reasonEs: string): boolean => reasonEs in REASONS
export const confidenceLabelKnown = (labelEs: string): boolean => labelEs in LABELS
export const cropKnown = (cropEs: string): boolean => cropEs in CROPS

const monthOf = (monthDay: string) => Number(monthDay.slice(0, 2)) - 1

interface Fmt {
  monthShort: (index: number) => string
}

/**
 * The option's plan in words: "año 1: maíz (jun–oct) → año 1: garbanzo (nov–may) → año 2: barbecho (jun–oct)". In Spanish it is
 * the service's own `description_es`; in English it is built from the same campaigns, in the same shape (the test checks that
 * the Spanish rebuilt this way equals `description_es`).
 */
export function describeOption(option: RotationOption, lang: Lang, fmt: Fmt): string {
  if (lang !== 'en') return option.descriptionEs
  return option.campaigns.map((campaign) => describeCampaign(campaign, 'en', fmt)).join(' → ')
}

/** One season of the plan in the shape the service uses; exported for the check against `description_es`. */
export function describeCampaign(campaign: RotationCampaign, lang: Lang, fmt: Fmt): string {
  const crop = cropName(campaign.cropEs, lang).toLowerCase()
  const word = lang === 'en' ? 'year' : 'año'
  return `${word} ${campaign.planningYear}: ${crop} (${fmt.monthShort(monthOf(campaign.sowing))}–${fmt.monthShort(monthOf(campaign.end))})`
}
