// The English of the rotation service's own Spanish text: every sentence in the published runs has a translation (so a new run
// with a new sentence fails here until it is added), the plan's description is rebuilt exactly, and nothing unknown is guessed.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { makeFormat } from './format.ts'
import { confidenceLabelKnown, confidenceLabelText, cropKnown, cropName, describeCampaign, describeOption, highlightKnown, highlightText, reasonKnown, reasonText } from './rotationText.ts'
import { parseRotations } from './rotations.ts'

const ids = ['guanajuato', 'sinaloa', 'sonora'] as const
const runs = ids.map((id) => parseRotations(JSON.parse(readFileSync(new URL(`../../public/data/rotations/${id}.json`, import.meta.url), 'utf8'))))
const es = makeFormat('es')
const en = makeFormat('en')

describe('every text the published runs contain is covered', () => {
  it('highlight sentences, confidence label and reasons, and crop names all have an English version', () => {
    for (const run of runs) {
      for (const option of run.options) {
        for (const line of option.highlightsEs) expect(highlightKnown(line), line).toBe(true)
        for (const campaign of option.campaigns) if (!campaign.fallow) expect(cropKnown(campaign.cropEs), campaign.cropEs).toBe(true)
      }
      for (const reason of run.confidence.reasonsEs) expect(reasonKnown(reason), reason).toBe(true)
      expect(confidenceLabelKnown(run.confidence.labelEs)).toBe(true)
    }
  })

  it('the English is different from the Spanish, and keeps the numbers', () => {
    const line = 'Ingreso bruto de escenario: 144511 MXN/ha; no es utilidad neta garantizada.'
    expect(highlightText(line, 'en')).toBe('Scenario gross income: 144511 MXN/ha; not a guaranteed net profit.')
    expect(highlightText('Índice de diversidad/suelo: 83/100; es un indicador heurístico.', 'en')).toContain('83/100')
    expect(highlightText('1 campañas con cosecha simulada inferior a 50 kg/ha: escenario de alto riesgo, no plan operativo validado.', 'en')).toMatch(/^1 season\(s\) with a simulated harvest below 50 kg\/ha/)
    expect(confidenceLabelText('Exploratorio: sin calibración local', 'en')).toBe('Exploratory: no local calibration')
    expect(cropName('Garbanzo', 'en')).toBe('Chickpea')
    expect(reasonText(runs[0].confidence.reasonsEs[0], 'en')).not.toBe(runs[0].confidence.reasonsEs[0])
  })

  it('Spanish is the service\'s own text, untouched', () => {
    const run = runs[0]
    expect(highlightText(run.options[0].highlightsEs[0], 'es')).toBe(run.options[0].highlightsEs[0])
    expect(reasonText(run.confidence.reasonsEs[0], 'es')).toBe(run.confidence.reasonsEs[0])
    expect(cropName('Garbanzo', 'es')).toBe('Garbanzo')
    expect(describeOption(run.options[0], 'es', es)).toBe(run.options[0].descriptionEs)
  })

  it('a text that is not a known one is shown as the service wrote it, never guessed', () => {
    expect(highlightText('Una frase nueva del servicio.', 'en')).toBe('Una frase nueva del servicio.')
    expect(reasonText('Otra razón nueva.', 'en')).toBe('Otra razón nueva.')
    expect(cropName('Frijol', 'en')).toBe('Frijol')
  })
})

describe('the plan\'s description', () => {
  it('rebuilt from the campaigns in Spanish is exactly the service\'s description_es, for every option of every run', () => {
    for (const run of runs) for (const option of run.options) expect(option.campaigns.map((campaign) => describeCampaign(campaign, 'es', es)).join(' → '), option.id).toBe(option.descriptionEs)
  })

  it('in English has the same shape, with English crops and months', () => {
    const option = runs[0].options[0]
    expect(describeOption(option, 'en', en)).toMatch(/^year 1: sorghum \(Jun–Oct\) → year 1: chickpea \(Nov–May\) → year 2: fallow \(Jun–Oct\)$/)
    for (const run of runs) for (const o of run.options) expect(describeOption(o, 'en', en), o.id).not.toMatch(/año|maíz|garbanzo|sorgo|trigo|barbecho/i)
  })
})
