import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../../i18n/index.tsx'
import { parseEnvironment, type Zone } from '../../lib/environment.ts'
import { EnvironmentPanel } from './EnvironmentPanel.tsx'

const environment = (id: string) => parseEnvironment(JSON.parse(readFileSync(new URL(`../../../public/data/environment/${id}.json`, import.meta.url), 'utf8')))
const render = (id: string, name: string, lang: 'es' | 'en' = 'es') => {
  const zone: Zone = { id: id as Zone['id'], name, km: 0, rotations: null, environment: environment(id) }
  const html = renderToStaticMarkup(
    <I18nProvider initial={lang}>
      <EnvironmentPanel zone={zone} />
    </I18nProvider>,
  )
  return { html, text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') }
}

describe('the environmental data panel', () => {
  const { html, text } = render('sonora', 'Sonora')

  it('opens with the main facts, and says these are satellite and model grids, not the parcel', () => {
    expect(text).toContain('Datos de tu zona: Sonora')
    expect(text).toContain('no miden tu parcela')
    expect(text).toContain('2024: 308 mm')
    expect(text).toContain('2025: 414 mm')
    expect(text).toMatch(/pH 8,0|pH 8\.0/)
    expect(text).toMatch(/9 m/)
  })

  it('has a section for each family of data Daniel\'s profile holds', () => {
    for (const title of ['Clima', 'Suelo', 'Terreno', 'Vegetación vista por satélite', 'Agua: evapotranspiración, humedad y lluvia satelital', 'Temperatura de la superficie', 'Contexto de México', 'Fuentes, calidad y límites']) expect(text).toContain(title)
  })

  it('shows the climate table, the soil table with its depths, and every source with its status', () => {
    expect(text).toContain('Racha seca más larga (días)')
    expect(text).toContain('0–5 cm')
    expect(text).toContain('Agua en el punto de marchitez')
    expect(text).toContain('NASA POWER (clima diario)')
    expect(text).toContain('Faltante')
    expect(text).toContain('Parámetros de cultivo validados')
  })

  it('says what is not ready and what is missing, in plain words', () => {
    expect(text).toContain('Todavía no')
    expect(text).toContain('Sin datos todavía de: parámetros de cultivo validados')
    expect(text).toContain('Prototipo de apoyo a decisiones; no es una recomendación agronómica validada en campo.')
  })

  it('draws the charts with labels for assistive technology', () => {
    expect((html.match(/role="img"/g) ?? []).length).toBeGreaterThanOrEqual(5)
    expect(html).toContain('aria-label="Lluvia por mes (mm): 2024:')
  })

  it('claims no success rate, and every gate that is not ready says "Todavía no"', () => {
    expect(text).not.toMatch(/\d\s?% de éxito|probabilidad de éxito/i)
    const gates = environment('sonora').readiness
    const notReady = gates.filter((gate) => !gate.ready).length
    expect(notReady).toBeGreaterThan(0)
    expect((text.match(/Todavía no/g) ?? []).length).toBe(notReady)
    expect((text.match(/Listo/g) ?? []).length).toBe(gates.length - notReady)
  })

  it('has an English version', () => {
    const en = render('sonora', 'Sonora', 'en').text
    expect(en).toContain('Data for your area: Sonora')
    expect(en).toContain('does not measure your parcel')
    expect(en).toContain('Decision support prototype; not field-validated crop advice.')
  })

  it('works the same for Guanajuato and Sinaloa', () => {
    expect(render('guanajuato', 'Guanajuato').text).toContain('Datos de tu zona: Guanajuato')
    expect(render('sinaloa', 'Sinaloa').text).toContain('Datos de tu zona: Sinaloa')
  })
})
