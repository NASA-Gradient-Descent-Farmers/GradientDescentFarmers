// Questions about a place's own data (climate, soil, satellite series, sources) answered from the published environmental
// packages: the topics are recognised, every figure is the file's, and nothing is claimed beyond what the data is.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { data } from '../assistant/testdata.ts'
import { DICTIONARIES, translate } from '../i18n/translate.ts'
import { demoLocation, type DemoLocationId } from '../lib/demoLocations.ts'
import { parseEnvironment, passing, soilValue, stats, type EnvironmentByLocation } from '../lib/environment.ts'
import { makeFormat } from '../lib/format.ts'
import { parseRotations, type RotationsByLocation } from '../lib/rotations.ts'
import { EMPTY_CHAT, environmentTopicOf, reply, type BotBubble, type Env } from './engine.ts'

const read = (kind: string, id: string): unknown => JSON.parse(readFileSync(new URL(`../../public/data/${kind}/${id}.json`, import.meta.url), 'utf8'))
const ids: DemoLocationId[] = ['guanajuato', 'sinaloa', 'sonora']
const environment: EnvironmentByLocation = Object.fromEntries(ids.map((id) => [id, parseEnvironment(read('environment', id))]))
const rotations: RotationsByLocation = { guanajuato: parseRotations(read('rotations', 'guanajuato')), sinaloa: parseRotations(read('rotations', 'sinaloa')), sonora: parseRotations(read('rotations', 'sonora')) }

const t = (path: string, vars?: Record<string, string | number>) => translate(DICTIONARIES.es, path, vars)
const fmt = makeFormat('es')
const env: Env = { data, rotations, environment, t, fmt, distance: (km) => fmt.number(km) }
const flat = (bubbles: BotBubble[]) => bubbles.map((b) => b.text).join('\n')
const ask = async (question: string, id: DemoLocationId, e: Env = env) => flat((await reply(question, { ...EMPTY_CHAT, location: id }, e)).bubbles)

describe('recognising a question about the place\'s data', () => {
  it.each([
    ['¿Cómo es el clima?', 'climate'],
    ['¿Cuánto llueve al año?', 'climate'],
    ['¿Qué temperatura hace?', 'climate'],
    ['¿Cómo es el suelo?', 'soil'],
    ['¿Qué pH tiene la tierra?', 'soil'],
    ['¿Cuánta arcilla hay?', 'soil'],
    ['¿Qué dicen los satélites?', 'satellite'],
    ['¿Cómo está la vegetación?', 'satellite'],
    ['¿De dónde salen los datos?', 'sources'],
    ['¿Qué fuentes usan?', 'sources'],
  ])('"%s" is about %s', (question, topic) => {
    expect(environmentTopicOf(question)).toBe(topic)
  })

  it('leaves the rain-risk, fertilizer, planting and harvest questions to their own answers', () => {
    for (const question of ['¿Qué pasa si llueve poco?', '¿Cuánto abono necesito?', '¿Qué cultivo me conviene más?', '¿Cuánto podría cosechar?', '¿Qué me conviene sembrar?', 'Hola']) expect(environmentTopicOf(question), question).toBeNull()
  })
})

describe.each(ids)('%s: answers from its environmental package', (id) => {
  const e = environment[id]!
  const place = demoLocation(id).name

  it('says what the data is, every time: satellite and model grids, not the parcel', async () => {
    for (const question of ['¿Cómo es el clima?', '¿Cómo es el suelo?', '¿Qué dicen los satélites?', '¿De dónde salen los datos?']) {
      const text = await ask(question, id)
      expect(text, question).toContain(`Datos de ${place}`)
      expect(text, question).toContain('no miden tu parcela')
      expect(text, question).not.toContain('Datos no disponibles')
    }
  })

  it('climate: each year\'s rain and dry spell are the file\'s', async () => {
    const text = await ask('¿Cómo es el clima?', id)
    for (const row of e.climate.annual) {
      expect(text).toContain(`${row.year}: ${fmt.number(row.rainMm!, 0)} mm de lluvia`)
      expect(text).toContain(`racha seca más larga de ${row.longestDryRunDays} días`)
    }
    expect(text).toContain('NASA POWER')
  })

  it('soil: pH, clay and sand at 0–5 cm, and the elevation, are the file\'s', async () => {
    const text = await ask('¿Cómo es el suelo?', id)
    expect(text).toContain(`pH ${fmt.number(soilValue(e, 'phh2o', '0-5cm')!.value!, 1)}`)
    expect(text).toContain(`arcilla ${fmt.number(soilValue(e, 'clay', '0-5cm')!.value!, 0)} %`)
    expect(text).toContain(`Altitud ${fmt.number(e.terrain.elevationM!, 0)} m`)
    expect(text).toContain('no un análisis de laboratorio')
  })

  it('satellite: the NDVI range counts only readings that passed quality control', async () => {
    const text = await ask('¿Qué dicen los satélites?', id)
    const s = stats(passing(e.vegetation).map((row) => row.ndvi))!
    expect(text).toContain(`NDVI entre ${fmt.number(s.min, 2)} y ${fmt.number(s.max, 2)}`)
    expect(text).toContain(`${s.count} lecturas`)
    expect(text).toContain('cubren muy poco tiempo')
  })

  it('sources: the ones that gave data and what they support, without listing what is missing', async () => {
    const text = await ask('¿De dónde salen los datos?', id)
    expect(text).toMatch(/Se usaron: .*NASA POWER/)
    expect(text).toMatch(/MODIS/)
    expect(text).toMatch(/Con estos datos se puede: .*explorar el clima/)
    for (const gap of ['Sin datos:', 'Todavía no', 'Qué falta', 'Parciales', 'Calibración con observaciones']) expect(text, gap).not.toContain(gap)
    expect(text).not.toMatch(/\d\s?% de éxito/)
  })
})

describe('in a conversation', () => {
  it('asks for the location first, then answers the climate question that was waiting', async () => {
    const asked = await reply('¿Cómo es el clima?', EMPTY_CHAT, env)
    expect(asked.state.pending).toBe('location')
    const answered = await reply('Sonora', asked.state, env)
    expect(flat(answered.bubbles)).toContain('*Clima*')
    expect(answered.state.pending).toBeNull()
  })

  it('answers the question in the same message as the location', async () => {
    const turn = await reply('¿Cómo es el suelo en Sinaloa?', EMPTY_CHAT, env)
    expect(turn.state.location).toBe('sinaloa')
    expect(flat(turn.bubbles)).toContain('*Suelo*')
  })

  it('does not interrupt the planner\'s four questions: they carry on after a data question', async () => {
    const planner: Env = { ...env, kinds: { guanajuato: 'experimental' } }
    const first = await reply('¿Qué me conviene sembrar?', { ...EMPTY_CHAT, location: 'guanajuato' }, planner)
    expect(first.state.pending).toBe('previous')
    const aside = await reply('¿Cómo es el clima?', first.state, planner)
    expect(flat(aside.bubbles)).toContain('*Clima*')
    expect(aside.state.pending).toBe('previous')
    const next = await reply('Maíz', aside.state, planner)
    expect(next.state.pending).toBe('hectares')
  })

  it('"cuidar el suelo", as the answer to the goal question, is an answer and not a soil question', async () => {
    const turn = await reply('Cuidar el suelo', { ...EMPTY_CHAT, location: 'guanajuato', pending: 'goal', situation: { previous: 'maize', hectares: 2, water: 'rain' } }, env)
    expect(flat(turn.bubbles)).not.toContain('*Suelo*')
    expect(turn.state.last).not.toBeNull()
  })

  it('the rain question for Sinaloa and Sonora adds what was observed there', async () => {
    for (const id of ['sinaloa', 'sonora'] as const) {
      const text = await ask('¿Qué pasa si llueve poco?', id)
      expect(text).toContain('Lo que se observó en la zona')
      expect(text).toContain(`${environment[id]!.climate.annual[0].year}: ${fmt.number(environment[id]!.climate.annual[0].rainMm!, 0)} mm de lluvia`)
    }
  })

  it('the location confirmation tells the farmer these questions exist', async () => {
    const turn = await reply('Sonora', EMPTY_CHAT, env)
    expect(flat(turn.bubbles)).toContain('el clima, el suelo, los datos de satélite')
  })
})

describe('a place whose package did not load', () => {
  it('says "data unavailable" and shows nothing from another place', async () => {
    const without: Env = { ...env, environment: { sinaloa: environment.sinaloa } }
    const text = await ask('¿Cómo es el clima?', 'sonora', without)
    expect(text).toBe(t('whatsapp.unavailable', { name: 'Sonora' }))
  })
})
