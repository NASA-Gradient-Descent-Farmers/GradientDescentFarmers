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

  it('shows the climate table, the soil table with its depths, and the sources that gave data', () => {
    expect(text).toContain('Racha seca más larga (días)')
    expect(text).toContain('0–5 cm')
    expect(text).toContain('Agua en el punto de marchitez')
    expect(text).toContain('NASA POWER (clima diario)')
    expect(text).toContain('SoilGrids (suelo)')
    expect(text).toContain('MODIS MOD13Q1 (vegetación)')
  })

  it('lists what the data supports and the limits that apply to any result, and nothing about what is missing', () => {
    expect(text).toContain('Qué se puede hacer con estos datos')
    expect(text).toContain('Explorar el clima')
    expect(text).toContain('Prototipo de apoyo a decisiones; no es una recomendación agronómica validada en campo.')
    for (const gap of ['Faltante', 'No solicitada', 'Todavía no', 'Sin datos todavía', 'Qué falta', 'Modelo WOFOST validado', 'Parámetros de cultivo validados', 'Precios locales']) expect(text, gap).not.toContain(gap)
  })

  it('draws the charts with labels for assistive technology', () => {
    expect((html.match(/role="img"/g) ?? []).length).toBeGreaterThanOrEqual(5)
    expect(html).toContain('aria-label="Lluvia por mes (mm): 2024:')
  })

  it('claims no success rate', () => {
    expect(text).not.toMatch(/\d\s?% de éxito|probabilidad de éxito/i)
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
