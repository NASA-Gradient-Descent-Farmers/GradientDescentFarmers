// The SIAP district engine in the chat, on the real exported files (public/data/district/): loading and unpacking, the
// farmer's inputs, the summary of both engines (written, or phrased by a stubbed model), the follow-up buttons, and that
// without the district data the chat answers exactly as before.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { data } from '../assistant/testdata.ts'
import { DICTIONARIES, translate } from '../i18n/translate.ts'
import { districtAnswer, effectiveInputs, loadDistrictIndex, parseInputs, priorityKey, unpack, type DistrictIndex } from '../lib/district.ts'
import { makeFormat } from '../lib/format.ts'
import { parseRotations, type RotationsByLocation } from '../lib/rotations.ts'
import type { Narrator } from '../llm/client.ts'
import { EMPTY_CHAT, reply, type BotBubble, type ChatState, type Env } from './engine.ts'
import { districtBubbles, districtFacts } from './districtAnswers.ts'
import { checkNumbers } from '../llm/guard.ts'
import { resetCentres } from '../lib/acopio.ts'

const root = new URL('../../public/', import.meta.url)
/** A fetch that reads the app's own public/ folder. */
const diskFetch = (async (url: string) => {
  const path = String(url).replace(/^\//, '')
  try {
    const text = readFileSync(new URL(path, root), 'utf8')
    return new Response(text, { status: 200 })
  } catch {
    return new Response('not found', { status: 404 })
  }
}) as typeof fetch

const rotationFile = (id: string) => parseRotations(JSON.parse(readFileSync(new URL(`data/rotations/${id}.json`, root), 'utf8')))
const rotations: RotationsByLocation = { guanajuato: rotationFile('guanajuato'), sinaloa: rotationFile('sinaloa'), sonora: rotationFile('sonora') }
const t = (path: string, vars?: Record<string, string | number>) => translate(DICTIONARIES.es, path, vars)
const fmt = makeFormat('es')
const flat = (bubbles: BotBubble[]) => bubbles.map((b) => b.text).join('\n')
const index = (await loadDistrictIndex('/', diskFetch)) as DistrictIndex
const base: Env = { data, rotations, t, fmt, distance: (km) => fmt.number(km) }
const withDistrict = (extra: Partial<Env> = {}): Env => ({ ...base, district: { index, base: '/', fetcher: diskFetch, api: null }, ...extra })

async function talk(env: Env, ...messages: string[]): Promise<{ state: ChatState; bubbles: BotBubble[] }> {
  let state = EMPTY_CHAT
  let bubbles: BotBubble[] = []
  for (const message of messages) {
    const turn = await reply(message, state, env)
    state = turn.state
    bubbles = turn.bubbles
  }
  return { state, bubbles }
}

describe('the exported district answers', () => {
  it('cover the three demo places, both water regimes where SIAP has them, with at least two alternatives each', () => {
    expect(Object.keys(index.lugares).sort()).toEqual(['guanajuato', 'sinaloa', 'sonora'])
    for (const place of Object.values(index.lugares)) {
      expect(place!.regimenes.riego!.length).toBeGreaterThan(0)
      for (const options of Object.values(place!.regimenes)) for (const o of options!) expect(o.alternativas).toBeGreaterThanOrEqual(2)
    }
  })

  it('unpack every priority set into a full engine result', async () => {
    const option = index.lugares.sonora!.regimenes.riego![0]
    const packed = JSON.parse(readFileSync(new URL(`data/district/${option.archivo}`, root), 'utf8'))
    expect(Object.keys(packed.variants)).toHaveLength(29)
    for (const key of ['none', 'agua', 'ingreso+suelo']) {
      const result = unpack(packed, key)!
      expect(result.rotaciones[0].id).toBe('actual')
      expect(result.rotaciones.length).toBeGreaterThanOrEqual(3)
      expect(result.aviso).toMatch(/no reemplaza/)
    }
    expect(unpack(packed, 'nope')).toBeNull()
  })
})

describe('the farmer inputs for the district engine', () => {
  it('drop anything odd from storage and keep at most two priorities', () => {
    expect(parseInputs('{"agua":"riego","rotacion":"maiz","prioridades":["agua","suelo","ingreso","x"],"pendiente":"fuerte","mesSiembra":13}')).toEqual({ agua: 'riego', rotacion: 'maiz', prioridades: ['agua', 'suelo'], pendiente: 'fuerte' })
    expect(parseInputs('not json')).toEqual({})
  })

  it('fall back to the app answers, then to the most common rotation', () => {
    const place = index.lugares.guanajuato!
    expect(effectiveInputs(place, {}, {})).toMatchObject({ agua: 'riego', rotacion: 'maiz', prioridades: [] })
    expect(effectiveInputs(place, {}, { water: 'rain', goal: 'soil' })).toMatchObject({ agua: 'temporal', prioridades: ['suelo'] })
    expect(effectiveInputs(place, {}, { previous: 'barley' })).toMatchObject({ rotacion: 'maiz_cebada' })
    expect(effectiveInputs(place, { rotacion: 'sorgo', prioridades: ['agua'] }, { goal: 'earn' })).toMatchObject({ rotacion: 'sorgo', prioridades: ['agua'] })
    // Sonora has only sorghum under rainfed
    expect(effectiveInputs(index.lugares.sonora!, { agua: 'temporal' })).toMatchObject({ agua: 'temporal', rotacion: 'sorgo' })
    expect(priorityKey(['suelo', 'agua'])).toBe('agua+suelo')
  })

  it('say which inputs a precomputed answer did not use, and use the live engine when it answers', async () => {
    const pre = await districtAnswer('sinaloa', index, { pendiente: 'fuerte', animales: true }, {}, '/', { fetcher: diskFetch, api: null })
    expect(pre!.source).toBe('precomputed')
    expect(pre!.notUsed).toEqual(['pendiente', 'animales'])
    const live = (async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('http://engine')) {
        const body = JSON.parse(String(init!.body))
        expect(body).toMatchObject({ lugar: 'Ahome', estado: 'Sinaloa', pendiente: 'fuerte', tiene_animales: true })
        return new Response(JSON.stringify({ ...pre!.result, lugar: { ...pre!.result.lugar, notas: ['live'] } }), { status: 200 })
      }
      return diskFetch(url as string)
    }) as typeof fetch
    const answer = await districtAnswer('sinaloa', index, { pendiente: 'fuerte', animales: true }, {}, '/', { fetcher: live, api: 'http://engine' })
    expect(answer!.source).toBe('live')
    expect(answer!.notUsed).toEqual([])
    const down = (async (url: string) => (String(url).startsWith('http://engine') ? Promise.reject(new Error('offline')) : diskFetch(url))) as typeof fetch
    const fallback = await districtAnswer('sinaloa', index, { pendiente: 'fuerte' }, {}, '/', { fetcher: down, api: 'http://engine' })
    expect(fallback).toMatchObject({ source: 'precomputed', liveError: 'offline', notUsed: ['pendiente'] })
  })
})

describe('the chat with both engines', () => {
  it('answers "what to plant" with one summary of both engines and follow-up buttons', async () => {
    const { bubbles } = await talk(withDistrict(), 'Sonora', '¿Qué me conviene sembrar?')
    expect(bubbles).toHaveLength(1)
    const [summary] = bubbles
    expect(summary.text).toMatch(/Modelo de suelo y cultivo \(WOFOST\)/)
    expect(summary.text).toMatch(/Historial del distrito Cajeme \(SIAP\)/)
    expect(summary.text).toMatch(/no una garantía/)
    expect(summary.options!.map((o) => o.label)).toEqual(['Ver las rotaciones del modelo de cultivo', '¿Por qué esa opción?', '¿Dónde vender?', '¿Qué riesgos tiene?'])
  })

  it('says where to sell: the guarantee price and who qualifies, then the farm size typed in passing', async () => {
    const env = withDistrict()
    const asked = await talk(env, 'Sinaloa', '¿Qué me conviene sembrar?', '¿Dónde vender?')
    const text = flat(asked.bubbles)
    expect(text).toMatch(/¿Dónde vender\?/)
    expect(text).toMatch(/gob\.mx\/alimentacionparaelbienestar/)
    expect(text).toMatch(/cuántas hectáreas/)
    const typed = await talk(env, 'Sinaloa', '¿Dónde puedo vender mi cosecha?')
    expect(flat(typed.bubbles)).toMatch(/¿Dónde vender\?/)
    const sized = await reply('siembro 2.5 hectáreas', asked.state, env)
    expect(sized.state.situation.hectares).toBe(2.5)
    expect(flat(sized.bubbles)).not.toMatch(/cuántas hectáreas/)
  })

  it('names the nearest official collection centre in the same state when the directory is there', async () => {
    resetCentres()
    const directory = { source: 'test', url: '', downloaded: '2026-11-15', located: 'municipio', columns: [], centros: [['Guanajuato', 'Salvatierra', 'Salvatierra', '11 CA SALVATIERRA', 'Calle Prueba S/N', 20.2138, -100.8806, 'B-11-028-0001-001'], ['Jalisco', 'La Barca', 'El Carmen', '08 CA EL CARMEN', 'Km 10', 20.29, -102.55, 'B-14-018-0009-004']] }
    const fetcher = (async (url: string) => (String(url).endsWith('data/acopio.json') ? new Response(JSON.stringify(directory)) : diskFetch(url))) as typeof fetch
    const env = withDistrict({ district: { index, base: '/', fetcher, api: null } })
    const { bubbles } = await talk(env, 'Guanajuato', '¿Dónde vendo mi maíz?')
    const text = flat(bubbles)
    expect(text).toMatch(/Centro de acopio Salvatierra/)
    expect(text).not.toMatch(/El Carmen/)
    expect(text).toMatch(/no dice qué grano recibe/)
    resetCentres()
  })

  it('gives the model the sell facts, with only the engines\' figures', async () => {
    const answer = await districtAnswer('sinaloa', index, {}, {}, '/', { fetcher: diskFetch })
    const facts = districtFacts(answer!, { fmt })
    expect(facts.some((f) => f.startsWith('Dónde vender'))).toBe(true)
  })

  it('keeps the WOFOST answer word for word one tap away', async () => {
    const plain = await talk(base, 'Sonora', '¿Qué me conviene sembrar?')
    const tapped = await talk(withDistrict(), 'Sonora', '¿Qué me conviene sembrar?', 'Ver las rotaciones del modelo de cultivo')
    expect(tapped.bubbles.map((b) => b.text)).toEqual(plain.bubbles.map((b) => b.text))
    expect(tapped.bubbles.at(-1)!.options!.length).toBeGreaterThan(0)
  })

  it('changes the current rotation and the priority through buttons, and answers again', async () => {
    const env = withDistrict()
    const asked = await talk(env, 'Guanajuato', '¿Qué me conviene sembrar?', 'Cambiar mi rotación actual')
    expect(asked.state.pending).toBe('districtRotation')
    expect(asked.bubbles[0].options!.map((o) => o.label)).toContain('Maíz en verano y trigo en invierno')
    const changed = await reply('Maíz en verano y trigo en invierno', asked.state, env)
    expect(changed.state.district).toMatchObject({ rotacion: 'maiz_trigo' })
    expect(changed.bubbles[0].text).toMatch(/maíz – trigo|maíz y trigo|trigo/)
    const priority = await reply('Cambiar lo que más me importa', changed.state, env)
    const set = await reply('Ahorrar o aprovechar el agua', priority.state, env)
    expect(set.state.district).toMatchObject({ rotacion: 'maiz_trigo', prioridades: ['agua'] })
    const regime = await reply('Cambiar riego o temporal', set.state, env)
    const rainfed = await reply('Temporal', regime.state, env)
    expect(rainfed.state.district).toMatchObject({ agua: 'temporal' })
    expect(rainfed.bubbles[0].text).toMatch(/temporal|Temporal/)
  })

  it('answers the district follow-ups from the engine text', async () => {
    const env = withDistrict()
    const start = await talk(env, 'Sinaloa', '¿Qué me conviene sembrar?')
    for (const [label, pattern] of [['¿Por qué esa opción?', /Por qué se propone/], ['¿Qué riesgos tiene?', /Riesgos de/], ['¿Cómo ha cambiado el clima aquí?', /NASA POWER/], ['Ver el historial del distrito', /Lo que ha funcionado en tu distrito/]] as const) {
      const turn = await reply(label, start.state, env)
      expect(flat(turn.bubbles)).toMatch(pattern)
      expect(turn.bubbles.at(-1)!.options!.map((o) => o.label)).not.toContain(label)
    }
  })

  it('uses the language model when it answers, and the written summary when it does not', async () => {
    let seen: Parameters<Narrator>[0] | null = null
    const narrate: Narrator = async (request) => {
      seen = request
      return { reply: 'Resumen de prueba.', followUps: ['trends', 'money'], model: 'stub' }
    }
    const { bubbles } = await talk(withDistrict({ narrate }), 'Sonora', '¿Qué me conviene sembrar?')
    expect(bubbles[0].text).toMatch(/^Resumen de prueba\./)
    expect(bubbles[0].text).toMatch(/redactado por IA/)
    expect(bubbles[0].options!.slice(0, 2).map((o) => o.label)).toEqual(['¿Cómo ha cambiado el clima aquí?', '¿Cuánto podría ganar?'])
    expect(seen!.facts.wofost.length).toBeGreaterThan(0)
    expect(seen!.facts.district.join('\n')).toMatch(/Alternativa/)
    const failing: Narrator = async () => null
    const written = await talk(withDistrict({ narrate: failing }), 'Sonora', '¿Qué me conviene sembrar?')
    expect(written.bubbles[0].text).toMatch(/En resumen, para Sonora/)
  })

  it('sends a question the rules cannot place to the model, and keeps the old answer when there is none', async () => {
    const narrate: Narrator = async (request) => (request.mode === 'question' ? { reply: 'No lo sé con estos datos.', followUps: [], model: 'stub' } : null)
    const asked = await talk(withDistrict({ narrate }), 'Sonora', '¿y los coyotes?')
    expect(asked.bubbles[0].text).toMatch(/No lo sé con estos datos/)
    const old = await talk(base, 'Sonora', '¿y los coyotes?')
    const none = await talk(withDistrict({ narrate: async () => null }), 'Sonora', '¿y los coyotes?')
    expect(none.bubbles.map((b) => b.text)).toEqual(old.bubbles.map((b) => b.text))
  })
})

describe('the facts and the number check', () => {
  it('pass the engine figures through, so a reply quoting them passes and an invented one does not', async () => {
    const answer = (await districtAnswer('sonora', index, {}, {}, '/', { fetcher: diskFetch, api: null }))!
    const facts = districtFacts(answer, { fmt }).join('\n')
    const income = answer.result.rotaciones[0].indicadores.ingreso.texto
    expect(checkNumbers(`Tu rotación vale ${income} por hectárea.`, facts).ok).toBe(true)
    expect(checkNumbers('Ganarías 987,654 pesos.', facts)).toEqual({ ok: false, unsupported: [987654] })
    expect(checkNumbers('Hay 2 opciones y 1 de cada 10 años es malo.', facts).ok).toBe(true)
    expect(flat(districtBubbles('summary', answer, { t, fmt }))).toContain(income)
  })
})

describe('English for the engines\' Spanish text', () => {
  it('translates display text and keeps identifiers, enums and figures', async () => {
    const { translateData } = await import('../lib/dataI18n.ts')
    const map = new Map([['Tu rotación actual: maíz', 'Your current rotation: maize'], ['maíz', 'maize'], ['alta', 'high']])
    const value = { id: 'actual', nombre: 'Tu rotación actual: maíz', rotacion: 'maíz', evidencia: 'alta', etiqueta: 'maíz', valor: 3, lista: ['Tu rotación actual: maíz'] }
    expect(translateData(value, map)).toEqual({ id: 'actual', nombre: 'Your current rotation: maize', rotacion: 'maíz', evidencia: 'alta', etiqueta: 'maize', valor: 3, lista: ['Your current rotation: maize'] })
    expect(translateData(value, null)).toBe(value)
  })

  it('has a translation for every engine string, with the same figures', () => {
    const file = new URL('data/i18n/en.json', root)
    const strings = JSON.parse(readFileSync(file, 'utf8')).strings as Record<string, string>
    const figures = (text: string) => [...text.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => m[0].replace(/,/g, '')).sort().join('|')
    for (const [es, en] of Object.entries(strings)) expect(figures(en)).toBe(figures(es))
    expect(Object.keys(strings).length).toBeGreaterThan(900)
  })

  it('answers in English end to end with the translated data', async () => {
    const { translateData } = await import('../lib/dataI18n.ts')
    const map = new Map(Object.entries(JSON.parse(readFileSync(new URL('data/i18n/en.json', root), 'utf8')).strings as Record<string, string>))
    const tEn = (path: string, vars?: Record<string, string | number>) => translate(DICTIONARIES.en, path, vars)
    const tr = <T,>(value: T) => translateData(value, map)
    const env: Env = { ...base, t: tEn, rotations: tr(rotations), lang: 'en', district: { index: tr(index), base: '/', fetcher: diskFetch, api: null, translate: tr } }
    const { bubbles } = await talk(env, 'Sonora', 'What should I plant?')
    expect(bubbles[0].text).toMatch(/District history Cajeme \(SIAP\)/)
    expect(bubbles[0].text).not.toMatch(/\b(tu rotación|cultivo|leguminosa|garbanzo)\b/i)
    const why = await reply('Why that option?', (await talk(env, 'Sonora', 'What should I plant?')).state, env)
    expect(flat(why.bubbles)).toMatch(/Why .* is proposed/)
  })
})
