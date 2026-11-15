// The simple farmer view's data layer and its hand-over to the WhatsApp chat: any municipality or GPS point finds its
// district, the demo places keep their richer answers, and the chat answers a place outside the demos from the district
// engine alone.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { data } from '../assistant/testdata.ts'
import { DICTIONARIES, translate } from '../i18n/translate.ts'
import { loadDistrictIndex, type DistrictIndex } from '../lib/district.ts'
import { makeFormat } from '../lib/format.ts'
import { EMPTY_CHAT, reply, type Env } from '../whatsapp/engine.ts'
import { isCampo } from '../whatsapp/route.ts'
import { placeByName, placeByPoint, type MunicipioRow, type NationalIndex } from './national.ts'

const root = new URL('../../public/', import.meta.url)
const diskFetch = (async (url: string) => {
  try {
    return new Response(readFileSync(new URL(String(url).replace(/^\//, ''), root), 'utf8'), { status: 200 })
  } catch {
    return new Response('not found', { status: 404 })
  }
}) as typeof fetch
const rows = (JSON.parse(readFileSync(new URL('data/municipios.json', root), 'utf8')) as { places: MunicipioRow[] }).places
const index = (await loadDistrictIndex('/', diskFetch)) as DistrictIndex
const t = (path: string, vars?: Record<string, string | number>) => translate(DICTIONARIES.es, path, vars)
const fmt = makeFormat('es')
const env: Env = { data, rotations: {}, t, fmt, distance: (km) => fmt.number(km), district: { index, base: '/', fetcher: diskFetch, api: null } }

// a small national index: two municipalities mapped to a district
const national: NationalIndex = {
  version: 1,
  prioridades: ['ingreso'],
  max_prioridades: 1,
  distritos: { '26-148': { state_id: 26, ddr: 148, estado: 'Sonora', distrito: 'Cajeme', lugar: 'Bácum', regimenes: index.lugares.sonora!.regimenes } },
  municipios: rows.map(([s, m]) => (s === 'Sonora' && (m === 'Bácum' || m === 'Cajeme') ? '26-148' : null)),
}

describe('finding the district of a place', () => {
  it('by name, and near a demo point it is marked as such', () => {
    const p = placeByName(rows, national, 'Cajeme', 'Sonora')!
    expect(p).toMatchObject({ municipality: 'Cajeme', districtKey: '26-148', how: 'search' })
    expect(placeByName(rows, national, 'Nowhere', 'Sonora')).toBeNull()
    expect(placeByName(rows, national, 'Ecatepec de Morelos', 'Estado de México')).toMatchObject({ state: 'México', districtKey: null })
  })

  it('by GPS: the closest municipality, nothing outside Mexico', () => {
    expect(placeByPoint(rows, national, { lat: 27.332202, lon: -110.162783 })).toMatchObject({ how: 'gps', demoId: 'sonora' })
    expect(placeByPoint(rows, national, { lat: 40.4, lon: -3.7 })).toBeNull()
  })

  it('the view has its own address', () => {
    expect(isCampo({ pathname: '/campo', hash: '' })).toBe(true)
    expect(isCampo({ pathname: '/', hash: '#campo' })).toBe(true)
    expect(isCampo({ pathname: '/', hash: '#/demo/whatsapp' })).toBe(false)
  })
})

describe('the chat with a place outside the demos', () => {
  const start = { ...EMPTY_CHAT, national: { label: 'Cajeme, Sonora', place: national.distritos['26-148'] as never }, district: { agua: 'riego' as const, rotacion: 'trigo', prioridades: ['ingreso' as const] } }

  it('answers from the district engine alone, with follow-ups and no WOFOST button', async () => {
    const turn = await reply('¿Qué me conviene sembrar?', start, env)
    expect(turn.bubbles[0].text).toMatch(/Historial del distrito Cajeme \(SIAP\)/)
    expect(turn.bubbles[0].text).toMatch(/no hay una corrida/)
    const labels = turn.bubbles.at(-1)!.options!.map((o) => o.label)
    expect(labels).not.toContain('Ver la simulación de suelo y cultivo')
    const why = await reply('¿Por qué esa opción?', turn.state, env)
    expect(why.bubbles.map((b) => b.text).join('\n')).toMatch(/Por qué se propone/)
  })

  it('sends any other message to the model when there is one, and to the summary when not', async () => {
    const asked = await reply('¿y si llueve poco?', start, { ...env, narrate: async () => ({ reply: 'Respuesta del modelo.', followUps: [], model: 'stub' }) })
    expect(asked.bubbles[0].text).toMatch(/^Respuesta del modelo/)
    const written = await reply('¿y si llueve poco?', start, env)
    expect(written.bubbles[0].text).toMatch(/En resumen, para Cajeme, Sonora/)
  })

  it('naming a demo place leaves the national place', async () => {
    const turn = await reply('Sinaloa', start, env)
    expect(turn.state.location).toBe('sinaloa')
    expect(turn.state.national).toBeUndefined()
  })
})
