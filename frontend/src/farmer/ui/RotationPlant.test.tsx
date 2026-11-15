import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../../i18n/index.tsx'
import { nearZone, parseEnvironment, type EnvironmentByLocation } from '../../lib/environment.ts'
import { bestOption, parseRotations, type RotationsByLocation } from '../../lib/rotations.ts'
import { RotationPlant } from './RotationPlant.tsx'

const read = (kind: string, id: string): unknown => JSON.parse(readFileSync(new URL(`../../../public/data/${kind}/${id}.json`, import.meta.url), 'utf8'))
const rotations: RotationsByLocation = { sinaloa: parseRotations(read('rotations', 'sinaloa')), sonora: parseRotations(read('rotations', 'sonora')) }
const environment: EnvironmentByLocation = { guanajuato: parseEnvironment(read('environment', 'guanajuato')), sinaloa: parseEnvironment(read('environment', 'sinaloa')), sonora: parseEnvironment(read('environment', 'sonora')) }
const published = { rotations, environment }
const words = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('which parcels get the published data', () => {
  it.each([
    ['the Sonora run point itself', { lat: 27.332202, lon: -110.162783 }, 'sonora'],
    ['the centre of Bácum, the municipality it falls in (the pin the municipality search gives)', { lat: 27.52, lon: -110.12 }, 'sonora'],
    ['the Sinaloa run point', { lat: 25.763611, lon: -108.861389 }, 'sinaloa'],
    ['the Guanajuato point, which has an environmental package but no rotation results', { lat: 20.4243195, lon: -101.1466639 }, 'guanajuato'],
  ])('%s', (_name, point, id) => {
    expect(nearZone(point, published)?.id).toBe(id)
  })

  it('Guanajuato has the environment but not rotation results; Sinaloa and Sonora have both', () => {
    expect(nearZone({ lat: 20.4243195, lon: -101.1466639 }, published)).toMatchObject({ rotations: null })
    expect(nearZone({ lat: 20.4243195, lon: -101.1466639 }, published)?.environment).not.toBeNull()
    for (const point of [{ lat: 25.7636, lon: -108.8614 }, { lat: 27.3322, lon: -110.1628 }]) {
      const zone = nearZone(point, published)!
      expect(zone.rotations).not.toBeNull()
      expect(zone.environment).not.toBeNull()
    }
  })

  it('not a parcel in Texcoco, or 60 km from a run: the data says nothing about it', () => {
    for (const point of [{ lat: 19.5, lon: -98.85 }, { lat: 27.9, lon: -110.16 }]) expect(nearZone(point, published)).toBeNull()
  })

  it('only what loaded: no files, no zone', () => {
    expect(nearZone({ lat: 27.332202, lon: -110.162783 }, { rotations: {}, environment: {} })).toBeNull()
    expect(nearZone({ lat: 27.332202, lon: -110.162783 }, { rotations: { sinaloa: rotations.sinaloa }, environment: { sinaloa: environment.sinaloa } })).toBeNull()
  })
})

describe('a run that found nothing feasible', () => {
  const none = parseRotations({ ...(read('rotations', 'sonora') as Record<string, unknown>), status: 'no_feasible_options', options: [], best: { irrigated: null, rainfed: null } })
  const zone = { id: 'sonora' as const, name: 'Sonora', km: 0, rotations: none, environment: null }
  const html = renderToStaticMarkup(
    <I18nProvider initial="es">
      <RotationPlant zone={zone} rotations={none} onAsk={() => {}} />
    </I18nProvider>,
  )

  it('says so, and recommends nothing', () => {
    const text = words(html)
    expect(text).toContain('no encontró opciones factibles')
    expect(text).not.toContain('Con riego')
    expect(text).not.toMatch(/Ingreso bruto/)
  })
})

describe('Qué sembrar for a parcel near a run', () => {
  const zone = nearZone({ lat: 27.52, lon: -110.12 }, published)!
  const html = renderToStaticMarkup(
    <I18nProvider initial="es">
      <RotationPlant zone={zone} rotations={zone.rotations!} onAsk={() => {}} />
    </I18nProvider>,
  )
  const text = words(html)

  it('shows the service\'s options for both water regimes, as exploratory and gross', () => {
    for (const regime of ['irrigated', 'rainfed'] as const) for (const campaign of bestOption(zone.rotations!, regime)!.campaigns.filter((c) => !c.fallow)) expect(text).toContain(campaign.cropEs)
    expect(text).toContain('Con riego')
    expect(text).toContain('Solo con lluvia (sin riego)')
    expect(text).toContain('Confianza baja')
    expect(text).toContain('no es ganancia')
    expect(text).toMatch(/Ingreso bruto: ≈ [\d,]+ MXN\/ha/)
    expect(text).not.toContain('fuera de la zona')
  })

  it('lists every option and the reasons behind the confidence, and claims no success rate', () => {
    expect(text).toContain(`Ver las ${zone.rotations!.options.length} opciones`)
    for (const reason of zone.rotations!.confidence.reasonsEs) expect(text).toContain(reason)
    expect(text).toContain('No hay un porcentaje de éxito calibrado')
  })

  it('explains how the options were calculated: settings, soil model, the prices used, what was discarded', () => {
    expect(text).toContain('Cómo se calcularon estas opciones')
    expect(text).toContain('Cultivos probados: Trigo, Garbanzo, Maíz, Sorgo')
    expect(text).toContain('SIAP vía DataMX')
    expect(text).toContain('no son precios locales')
    expect(text).toMatch(/\d+ simulaciones se descartaron/)
  })

  it('puts the place\'s environmental data below, with the same honesty about what it is', () => {
    expect(text).toContain('Datos de tu zona: Sonora')
    expect(text).toContain('no miden tu parcela')
  })

  it('draws each highlight with one bullet, not two', () => {
    expect(html).not.toContain('• ')
  })

  it('says the results are per hectare and ordered by what matters most', () => {
    expect(text).toContain('Se ordenan según lo que más te importa')
  })
})
