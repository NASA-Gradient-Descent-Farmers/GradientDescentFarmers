// The three demonstration locations: exact coordinates, recognition in the chat, and what each may answer with.
import { describe, expect, it } from 'vitest'
import { data } from '../assistant/testdata.ts'
import { DICTIONARIES, translate } from '../i18n/translate.ts'
import { DEMO_LOCATIONS, demoLocation } from '../lib/demoLocations.ts'
import { makeFormat } from '../lib/format.ts'
import { EMPTY_CHAT, greeting, readLocation, reply, type BotBubble, type ChatState, type Env } from './engine.ts'

const t = (path: string, vars?: Record<string, string | number>) => translate(DICTIONARIES.es, path, vars)
const fmt = makeFormat('es')
const env: Env = { data, kinds: { guanajuato: 'experimental' }, t, fmt, distance: (km) => fmt.number(km) }
const flat = (bubbles: BotBubble[]) => bubbles.map((b) => b.text).join('\n')
const FULL = { previous: 'maize' as const, hectares: 2, water: 'rain' as const, goal: 'earn' as const }

describe('the shared configuration', () => {
  it('has exactly the three locations, with the exact coordinates', () => {
    expect(DEMO_LOCATIONS.map(({ id, name, latitude, longitude }) => ({ id, name, latitude, longitude }))).toEqual([
      { id: 'guanajuato', name: 'Guanajuato', latitude: 20.4243195, longitude: -101.1466639 },
      { id: 'sinaloa', name: 'Sinaloa', latitude: 25.7636111, longitude: -108.8613889 },
      { id: 'sonora', name: 'Sonora', latitude: 27.332202, longitude: -110.162783 },
    ])
  })

  it('all three places have published rotation results', () => {
    expect(DEMO_LOCATIONS.map((place) => place.results)).toEqual(['rotations', 'rotations', 'rotations'])
  })
})

describe('recognizing a location in the conversation', () => {
  it.each([
    ['Guanajuato', 'guanajuato'],
    ['quiero sembrar en sinaloa', 'sinaloa'],
    ['¿Qué me conviene sembrar en SONORA?', 'sonora'],
    ['mi parcela está en Guanajuato, Gto.', 'guanajuato'],
  ])('%s', (text, id) => {
    expect(readLocation(text)?.id).toBe(id)
  })

  it('does not take other places or words for one', () => {
    for (const text of ['Texcoco', 'Jalisco', 'sonoramente', '¿Qué me conviene sembrar?']) expect(readLocation(text), text).toBeNull()
  })

  it.each(DEMO_LOCATIONS.map((place) => [place.name, place.id] as const))('selecting %s names its exact coordinates', async (name, id) => {
    const turn = await reply(name, EMPTY_CHAT, env)
    const place = demoLocation(id)
    expect(turn.state.location).toBe(id)
    expect(flat(turn.bubbles)).toContain(`${place.latitude}, ${place.longitude}`)
    expect(flat(turn.bubbles)).toContain(t('whatsapp.referencePoint'))
  })
})

describe('a question before any location is chosen', () => {
  it('asks for one of the three, and answers the question once it is named', async () => {
    const first = await reply('¿Qué me conviene sembrar?', { ...EMPTY_CHAT, situation: FULL }, env)
    expect(first.state.pending).toBe('location')
    expect(first.bubbles[0].options?.map((o) => o.label)).toEqual(['Guanajuato', 'Sinaloa', 'Sonora'])
    const second = await reply('Guanajuato', first.state, env)
    expect(second.state.last?.place).toBe('Guanajuato')
    expect(flat(second.bubbles)).toContain(t('whatsapp.experimental'))
  })

  it('takes the question and the place from one message', async () => {
    const turn = await reply('¿Qué me conviene sembrar en Guanajuato?', { ...EMPTY_CHAT, situation: FULL }, env)
    expect(turn.state.location).toBe('guanajuato')
    expect(turn.state.last?.point).toEqual({ lat: 20.4243195, lon: -101.1466639 })
  })
})

describe('Guanajuato: experimental demonstration data', () => {
  it('uses its own coordinates and labels every answer as experimental', async () => {
    for (const question of ['¿Qué me conviene sembrar?', '¿Y si llueve poco?', '¿Cuánto podría cosechar?', '¿Qué tan seguros son estos datos?']) {
      const turn = await reply(question, { ...EMPTY_CHAT, location: 'guanajuato', situation: FULL }, env)
      expect(flat(turn.bubbles), question).toContain(t('whatsapp.experimental'))
    }
  })

  it('never claims the model was checked in Guanajuato', async () => {
    const turn = await reply('¿Y si llueve poco?', { ...EMPTY_CHAT, location: 'guanajuato', situation: FULL }, env)
    const text = flat(turn.bubbles)
    expect(text).toContain(t('farmer.rec.risks.zoneNear'))
    expect(text).not.toContain(t('farmer.rec.confidence.low') + '.')
  })
})

// the rotation results of these two are tested in rotations.test.ts; here none is loaded, so they must say so
describe.each(['sinaloa', 'sonora'] as const)('%s: rotation results not loaded, data unavailable', (id) => {
  const place = demoLocation(id)
  const unavailable = t('whatsapp.unavailable', { name: place.name })

  it('says so when chosen, and shows no model result', async () => {
    const turn = await reply(place.name, EMPTY_CHAT, env)
    expect(turn.state.location).toBe(id)
    expect(flat(turn.bubbles)).toContain(unavailable)
    expect(turn.state.last).toBeNull()
  })

  it.each(['¿Qué me conviene sembrar?', '¿Qué pasa si llueve poco?', '¿Cuánto podría cosechar?', '¿Qué cultivo me conviene más?', '¿Cuánto podría ganar?', '¿Qué tan seguros son estos datos?', '¿Cuánto abono necesito?'])('answers "%s" with the unavailable state, not a prediction', async (question) => {
    const turn = await reply(question, { ...EMPTY_CHAT, location: id, situation: FULL }, env)
    expect(flat(turn.bubbles)).toBe(unavailable)
    expect(turn.state.last).toBeNull()
  })

  it('does not reuse Guanajuato\'s predictions when switching from it', async () => {
    const gto = await reply('¿Qué me conviene sembrar?', { ...EMPTY_CHAT, location: 'guanajuato', situation: FULL }, env)
    expect(gto.state.last).not.toBeNull()
    const moved = await reply(place.name, gto.state, env)
    expect(moved.state.last).toBeNull()
    const fertilizer = await reply('¿Cuánto abono necesito?', moved.state, env)
    expect(flat(fertilizer.bubbles)).toBe(unavailable)
    const question = await reply(`¿Qué me conviene sembrar en ${place.name}?`, gto.state, env)
    expect(flat(question.bubbles)).not.toContain(t('farmer.rec.title'))
    expect(question.state.last).toBeNull()
  })
})

describe('the chosen location is used throughout', () => {
  it('stays selected across questions, and changing it drops the old answer', async () => {
    let state: ChatState = { ...EMPTY_CHAT, location: 'guanajuato', situation: FULL }
    for (const question of ['¿Qué me conviene sembrar?', '¿Y si llueve poco?', '¿Cuánto podría cosechar?']) {
      state = (await reply(question, state, env)).state
      expect(state.location).toBe('guanajuato')
      expect(state.last?.place).toBe('Guanajuato')
    }
    state = (await reply('Sonora', state, env)).state
    expect(state.location).toBe('sonora')
    expect(state.last).toBeNull()
    state = (await reply('Guanajuato', state, env)).state
    expect(state.location).toBe('guanajuato')
  })
})

describe('the opening of the conversation', () => {
  it('asks which of the three locations, with a button for each, and says they are reference points', () => {
    const bubbles = greeting(t)
    expect(bubbles[bubbles.length - 1].options?.map((o) => o.label)).toEqual(['Guanajuato', 'Sinaloa', 'Sonora'])
    expect(flat(bubbles)).toContain(t('whatsapp.askLocation'))
    expect(flat(bubbles)).toContain('no parcelas verificadas')
  })

  it('invites a question once a location with results is chosen, and not for one without', async () => {
    expect(flat((await reply('Guanajuato', EMPTY_CHAT, env)).bubbles)).toContain(t('whatsapp.nextStep'))
    expect(flat((await reply('Sonora', EMPTY_CHAT, env)).bubbles)).not.toContain(t('whatsapp.nextStep'))
  })
})
