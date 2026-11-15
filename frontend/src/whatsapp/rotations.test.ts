// Real rotation results (the rotations service's published runs for Sinaloa and Sonora): the file check, the answers
// the chat builds from them, and the promises they must keep: exploratory, gross income, nothing borrowed.
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { data } from '../assistant/testdata.ts'
import { DICTIONARIES, translate } from '../i18n/translate.ts'
import { makeFormat } from '../lib/format.ts'
import { bestOption, loadRotations, parseRotations, topIncomeOption, type Rotations, type RotationsByLocation } from '../lib/rotations.ts'
import { EMPTY_CHAT, reply, resultsKind, type BotBubble, type Env } from './engine.ts'
import { demoLocation } from '../lib/demoLocations.ts'

const file = (id: string): unknown => JSON.parse(readFileSync(new URL(`../../public/data/rotations/${id}.json`, import.meta.url), 'utf8'))
const sinaloa = parseRotations(file('sinaloa'))
const sonora = parseRotations(file('sonora'))
const guanajuato = parseRotations(file('guanajuato'))
const rotations: RotationsByLocation = { guanajuato, sinaloa, sonora }

const t = (path: string, vars?: Record<string, string | number>) => translate(DICTIONARIES.es, path, vars)
const fmt = makeFormat('es')
const env: Env = { data, rotations, t, fmt, distance: (km) => fmt.number(km) }
const flat = (bubbles: BotBubble[]) => bubbles.map((b) => b.text).join('\n')
const QUESTIONS = ['¿Qué me conviene sembrar?', '¿Qué pasa si llueve poco?', '¿Cuánto podría cosechar?', '¿Qué cultivo me conviene más?', '¿Cuánto podría ganar?', '¿Qué tan seguros son estos datos?', '¿Cuánto abono necesito?']
const exact = (n: number) => fmt.number(Math.round(n))

describe('the published rotation files', () => {
  it('pass the check, with the runs the service reported', () => {
    expect(sinaloa).toMatchObject({ farmId: 'mexico_norte_01', sourceRunId: 'b50bfdf0a58240aa', rotationRunId: 'be357172bae941c1', municipality: 'Juan José Ríos' })
    expect(sonora).toMatchObject({ farmId: 'mexico_norte_02', sourceRunId: '9849d2f76f944625', rotationRunId: '5abb561d6ead496b', municipality: 'Bácum' })
    for (const r of [sinaloa, sonora]) {
      expect(r.status).toBe('exploratory_options')
      expect(r.confidence).toMatchObject({ overall: 'low', fieldValidated: false, probabilityOfSuccess: null })
    }
  })

  it('name an option for each water regime, and the top-income option is a real one', () => {
    for (const r of [sinaloa, sonora]) {
      for (const regime of ['irrigated', 'rainfed'] as const) {
        expect(bestOption(r, regime)?.regime).toBe(regime)
        const top = topIncomeOption(r, regime)!
        const incomes = r.options.filter((o) => o.regime === regime).map((o) => o.gross!.median!)
        expect(top.gross!.median).toBe(Math.max(...incomes))
      }
    }
  })

  it('refuse a file that is not what the answers rely on, naming the field', () => {
    const base = file('sinaloa') as Record<string, unknown>
    const broken = (change: Record<string, unknown>) => parseRotations({ ...base, ...change })
    expect(() => parseRotations(null)).toThrow(/not an object/)
    expect(() => broken({ version: 2 })).toThrow(/unsupported version/)
    expect(() => broken({ options: [] })).toThrow(/no options/)
    expect(() => broken({ best: { irrigated: 'nope', rainfed: null } })).toThrow(/best\.irrigated/)
    expect(() => broken({ confidence: undefined })).toThrow(/confidence/)
    const options = (base.options as Record<string, unknown>[]).map((option, i) => (i === 0 ? { ...option, regime: 'dry' } : option))
    expect(() => broken({ options })).toThrow(/options\[0\]\.regime/)
  })
})

describe.each([
  ['sinaloa', sinaloa],
  ['sonora', sonora],
] as const)('%s: the chat answers from its rotation results', (id, r: Rotations) => {
  const place = demoLocation(id)
  const start = { ...EMPTY_CHAT, location: id }

  it('is chosen with a note that says what it has, and the municipality the point falls in', async () => {
    const turn = await reply(place.name, EMPTY_CHAT, env)
    expect(resultsKind(place, env)).toBe('rotations')
    expect(flat(turn.bubbles)).toContain(r.municipality)
    expect(flat(turn.bubbles)).toContain('no están validados en campo')
    expect(flat(turn.bubbles)).not.toContain(t('whatsapp.unavailable', { name: place.name }))
  })

  it.each(QUESTIONS)('answers "%s" from the file, with no question asked back and no planner result', async (question) => {
    const turn = await reply(question, start, env)
    expect(turn.state.pending).toBeNull()
    expect(turn.state.last).toBeNull()
    expect(turn.showsResults).toBe(true)
    expect(flat(turn.bubbles)).not.toContain('Datos no disponibles')
    expect(flat(turn.bubbles)).not.toContain(t('whatsapp.experimental'))
    // the only mention of validation is the disclaimer that there is none
    expect(flat(turn.bubbles).replace(/(ni está|no están|sin|operativo) validad[oa]s?( en campo)?/gi, '')).not.toMatch(/validad/i)
  })

  it('quotes the planting options as the service gave them, in each water regime', async () => {
    const text = flat((await reply('¿Qué me conviene sembrar?', start, env)).bubbles)
    for (const regime of ['irrigated', 'rainfed'] as const) {
      const option = bestOption(r, regime)!
      expect(text).toContain(option.descriptionEs)
      expect(text).toContain(`${Math.round(option.gross!.median!)} MXN/ha`)
    }
    expect(text).toContain('Confirma que tienes infraestructura de riego')
    expect(text).toContain('no es ganancia')
    expect(text).toContain('2024–2025')
  })

  it('says income is gross, with the whole plan as its basis, whenever it quotes money', async () => {
    for (const question of ['¿Cuánto podría ganar?', '¿Qué cultivo me conviene más?']) {
      const text = flat((await reply(question, start, env)).bubbles)
      expect(text).toMatch(/Ingreso bruto(?: de escenario)?: (?:≈ )?[\d,]+ MXN\/ha/)
      expect(text).toContain('no es ganancia')
      // the service's own highlight says "no es utilidad neta garantizada"; nothing may claim net profit
      expect(text).not.toMatch(/(?<!no es )utilidad neta|ganancia de/i)
    }
  })

  it('"which crop is best" also shows the highest-income option when the priorities chose another', async () => {
    const text = flat((await reply('¿Qué cultivo me conviene más?', start, env)).bubbles)
    for (const regime of ['irrigated', 'rainfed'] as const) {
      const top = topIncomeOption(r, regime)!
      if (top.id !== bestOption(r, regime)!.id) expect(text).toContain(top.descriptionEs)
    }
  })

  it('harvest figures are the per-campaign grain of the recommended options, and zero is said as no harvest', async () => {
    const text = flat((await reply('¿Cuánto podría cosechar?', start, env)).bubbles)
    for (const regime of ['irrigated', 'rainfed'] as const) {
      for (const campaign of bestOption(r, regime)!.campaigns.filter((c) => !c.fallow)) {
        expect(text).toContain(campaign.cropEs)
        expect(text).toContain(campaign.grainTHa! < 0.05 ? 'casi sin cosecha' : `${fmt.number(campaign.grainTHa!, 2)} t/ha`)
      }
    }
    expect(text).toContain('no es una predicción')
  })

  it('does not invent a dry-year scenario: it compares irrigated with rain only, and counts failed harvests', async () => {
    const text = flat((await reply('¿Qué pasa si llueve poco?', start, env)).bubbles)
    expect(text).toContain('no simula un año seco aparte')
    const rainfed = r.options.filter((o) => o.regime === 'rainfed')
    expect(text).toContain(`${rainfed.filter((o) => o.failedHarvests > 0).length} de ${rainfed.length} opciones sin riego`)
  })

  it('gives the confidence label and every reason, and never a success percentage', async () => {
    const text = flat((await reply('¿Qué tan seguros son estos datos?', start, env)).bubbles)
    expect(text).toContain(r.confidence.labelEs)
    for (const reason of r.confidence.reasonsEs) expect(text).toContain(reason)
    expect(text).toContain('No hay un porcentaje de éxito calibrado')
    expect(text).not.toMatch(/\d\s?%/)
  })

  it('does not make up fertilizer doses', async () => {
    const text = flat((await reply('¿Cuánto abono necesito?', start, env)).bubbles)
    expect(text).toContain('probar en un pedazo de tu parcela')
  })

  it('answers a question asked in the same message as the location, and one that waited for a location', async () => {
    const same = await reply(`¿Qué me conviene sembrar en ${place.name}?`, EMPTY_CHAT, env)
    expect(flat(same.bubbles)).toContain(bestOption(r, 'irrigated')!.descriptionEs)
    const waiting = await reply('¿Cuánto podría cosechar?', EMPTY_CHAT, env)
    expect(waiting.state.pending).toBe('location')
    const chosen = await reply(place.name, waiting.state, env)
    expect(flat(chosen.bubbles)).toContain('Cosecha simulada')
    expect(chosen.state.pending).toBeNull()
  })
})

describe('results are never borrowed between locations', () => {
  it('Sinaloa and Sonora quote their own file, not each other\'s or Guanajuato\'s', async () => {
    const a = flat((await reply('¿Cuánto podría ganar?', { ...EMPTY_CHAT, location: 'sinaloa' }, env)).bubbles)
    const b = flat((await reply('¿Cuánto podría ganar?', { ...EMPTY_CHAT, location: 'sonora' }, env)).bubbles)
    expect(a).not.toBe(b)
    expect(a).toContain(exact(bestOption(sinaloa, 'irrigated')!.gross!.median!))
    expect(b).toContain(exact(bestOption(sonora, 'irrigated')!.gross!.median!))
  })

  it('switching from Guanajuato drops its answer, and its experimental label is not attached to rotation answers', async () => {
    const gto = await reply('¿Qué me conviene sembrar?', { ...EMPTY_CHAT, location: 'guanajuato', situation: { previous: 'maize', hectares: 2, water: 'rain', goal: 'earn' } }, { ...env, kinds: { guanajuato: 'experimental' } })
    expect(gto.state.last).not.toBeNull()
    const moved = await reply('Sonora', gto.state, env)
    expect(moved.state.last).toBeNull()
    expect(flat((await reply('¿Cuánto podría ganar?', moved.state, env)).bubbles)).not.toContain(t('whatsapp.experimental'))
  })

  it('a location whose file did not load says "data unavailable" and shows nothing from the other', async () => {
    const onlySinaloa: Env = { ...env, rotations: { sinaloa } }
    expect(resultsKind(demoLocation('sonora'), onlySinaloa)).toBeNull()
    const turn = await reply('¿Qué me conviene sembrar?', { ...EMPTY_CHAT, location: 'sonora' }, onlySinaloa)
    expect(flat(turn.bubbles)).toBe(t('whatsapp.unavailable', { name: 'Sonora' }))
  })
})

describe('loading the files in the browser', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps a good file, and leaves out one that is missing or fails the check', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bodies: Record<string, unknown> = { 'data/rotations/sinaloa.json': file('sinaloa'), 'data/rotations/sonora.json': { version: 9 } }
    vi.stubGlobal('fetch', async (url: string) => (url in bodies ? { ok: true, status: 200, json: async () => bodies[url] } : { ok: false, status: 404, json: async () => ({}) }))
    expect(Object.keys(await loadRotations(['sinaloa', 'sonora', 'guanajuato'], ''))).toEqual(['sinaloa'])
  })
})
