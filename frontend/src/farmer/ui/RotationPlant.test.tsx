import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../../i18n/index.tsx'
import { bestOption, nearRotationSite, parseRotations, type RotationsByLocation } from '../../lib/rotations.ts'
import { RotationPlant } from './RotationPlant.tsx'

const load = (id: string) => parseRotations(JSON.parse(readFileSync(new URL(`../../../public/data/rotations/${id}.json`, import.meta.url), 'utf8')))
const rotations: RotationsByLocation = { sinaloa: load('sinaloa'), sonora: load('sonora') }
const words = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('which parcels get the rotation results', () => {
  it.each([
    ['the Sonora run point itself', { lat: 27.332202, lon: -110.162783 }, 'sonora'],
    ['the centre of Bácum, the municipality it falls in (the pin the municipality search gives)', { lat: 27.52, lon: -110.12 }, 'sonora'],
    ['the Sinaloa run point', { lat: 25.763611, lon: -108.861389 }, 'sinaloa'],
  ])('%s', (_name, point, id) => {
    expect(nearRotationSite(point, rotations)?.id).toBe(id)
  })

  it('not a parcel in Texcoco, Guanajuato, or 60 km from a run: the results say nothing about it', () => {
    for (const point of [{ lat: 19.5, lon: -98.85 }, { lat: 20.4243195, lon: -101.1466639 }, { lat: 27.9, lon: -110.16 }]) expect(nearRotationSite(point, rotations)).toBeNull()
  })

  it('only when that location\'s file loaded', () => {
    expect(nearRotationSite({ lat: 27.332202, lon: -110.162783 }, { sinaloa: rotations.sinaloa })).toBeNull()
    expect(nearRotationSite({ lat: 27.332202, lon: -110.162783 }, {})).toBeNull()
  })
})

describe('Qué sembrar for a parcel near a run', () => {
  const site = nearRotationSite({ lat: 27.52, lon: -110.12 }, rotations)!
  const html = renderToStaticMarkup(
    <I18nProvider initial="es">
      <RotationPlant site={site} onAsk={() => {}} />
    </I18nProvider>,
  )
  const text = words(html)

  it('shows the service\'s options for both water regimes, as exploratory and gross', () => {
    for (const regime of ['irrigated', 'rainfed'] as const) for (const campaign of bestOption(site.rotations, regime)!.campaigns.filter((c) => !c.fallow)) expect(text).toContain(campaign.cropEs)
    expect(text).toContain('Con riego')
    expect(text).toContain('Solo con lluvia (sin riego)')
    expect(text).toContain('Confianza baja')
    expect(text).toContain('no es ganancia')
    expect(text).toMatch(/Ingreso bruto: ≈ [\d,]+ MXN\/ha/)
    expect(text).not.toContain('fuera de la zona')
  })

  it('lists every option and the reasons behind the confidence, and claims no success rate', () => {
    expect(text).toContain(`Ver las ${site.rotations.options.length} opciones`)
    for (const reason of site.rotations.confidence.reasonsEs) expect(text).toContain(reason)
    expect(text).toContain('No hay un porcentaje de éxito calibrado')
    expect(text).not.toMatch(/\d\s?%/)
  })

  it('says the results do not depend on the parcel questions', () => {
    expect(text).toContain('no cambian con tus respuestas')
  })
})
