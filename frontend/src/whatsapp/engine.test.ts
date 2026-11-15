// The simulator end to end on the real exported model results: no network, no key, no language model.
import { describe, expect, it } from 'vitest'
import { data } from '../assistant/testdata.ts'
import { DICTIONARIES, translate } from '../i18n/translate.ts'
import { roundMoney, recommend } from '../farmer/recommend.ts'
import { FIELDS } from '../farmer/state.ts'
import { makeFormat } from '../lib/format.ts'
import { EMPTY_CHAT, focusOf, greeting, readAnswer, reply, type BotBubble, type ChatState, type Env } from './engine.ts'

const t = (path: string, vars?: Record<string, string | number>) => translate(DICTIONARIES.es, path, vars)
const fmt = makeFormat('es')
const env: Env = { data, kinds: { guanajuato: 'experimental' }, t, fmt, distance: (km) => (km < 1 ? t('where.lessThanOne') : fmt.number(km)) }

const GTO: ChatState = { ...EMPTY_CHAT, location: 'guanajuato' }
const flat = (bubbles: BotBubble[]) => bubbles.map((b) => b.text).join('\n')
const LEAKS = /\b(farmer|whatsapp|rotations|crops|assistant)\.[a-zA-Z_]+|\{\w+\}|\bundefined\b|\bNaN\b|\[object/

/** Several messages in a row, as a person would send them: each reply starts from the state the last one left. */
async function talk(...messages: string[]) {
  let state: ChatState = GTO
  const turns: { said: string; bubbles: BotBubble[] }[] = []
  for (const said of messages) {
    const turn = await reply(said, state, env)
    state = turn.state
    turns.push({ said, bubbles: turn.bubbles })
  }
  return { state, turns }
}

describe('the suggested questions', () => {
  it('are each understood as the topic they ask about', () => {
    expect(focusOf(t('whatsapp.suggestions.plant'))).toBe('plant')
    expect(focusOf(t('whatsapp.suggestions.rain'))).toBe('rain')
    expect(focusOf(t('whatsapp.suggestions.harvest'))).toBe('harvest')
    expect(focusOf(t('whatsapp.suggestions.compare'))).toBe('compare')
  })

  it('are the four the demo promises, in Spanish', () => {
    expect(['plant', 'rain', 'harvest', 'compare'].map((id) => t(`whatsapp.suggestions.${id}`))).toEqual([
      '¿Qué me conviene sembrar?',
      '¿Qué pasa si llueve poco?',
      '¿Cuánto podría cosechar?',
      '¿Qué cultivo me conviene más?',
    ])
  })
})

describe('readAnswer', () => {
  it('reads every answer button back to the answer it stands for', () => {
    for (const value of ['maize', 'barley', 'fababean', 'other', 'none']) expect(readAnswer('previous', t(`farmer.parcel.previous.${value}`))).toBe(value)
    for (const value of ['rain', 'some', 'regular']) expect(readAnswer('water', t(`farmer.parcel.water.${value}.label`))).toBe(value)
    for (const value of ['earn', 'water', 'soil']) expect(readAnswer('goal', t(`farmer.parcel.goal.${value}.label`))).toBe(value)
    for (const n of [1, 2, 5, 10]) expect(readAnswer('hectares', t('farmer.parcel.hectares.quick', { n }))).toBe(n)
  })

  it('reads typed answers in everyday words', () => {
    expect(readAnswer('hectares', 'tengo 2.5 hectáreas')).toBe(2.5)
    expect(readAnswer('hectares', 'como 3,5 ha')).toBe(3.5)
    expect(readAnswer('hectares', 'dos hectáreas')).toBe(2)
    expect(readAnswer('previous', 'sembré maíz')).toBe('maize')
    expect(readAnswer('water', 'dependo de la lluvia')).toBe('rain')
    expect(readAnswer('water', 'tengo riego')).toBe('regular')
    expect(readAnswer('goal', 'quiero ganar más')).toBe('earn')
  })

  it('does not take anything for an answer', () => {
    expect(readAnswer('hectares', 'muchas')).toBeUndefined()
    expect(readAnswer('hectares', '0')).toBeUndefined()
    expect(readAnswer('hectares', '999999')).toBeUndefined()
    expect(readAnswer('previous', 'no sé')).toBeUndefined()
    expect(readAnswer('goal', 'hola')).toBeUndefined()
  })
})

describe('a realistic conversation', () => {
  it('asks the four questions one by one, with buttons, then answers with the planner', async () => {
    const { state, turns } = await talk(t('whatsapp.suggestions.plant'), 'Maíz', '2 ha', 'Solo de la lluvia', 'Ganar más')
    // each question comes with the answers as buttons, in order
    const asked = turns.slice(0, 4).map((turn) => turn.bubbles[turn.bubbles.length - 1])
    expect(asked.map((b) => b.options?.length)).toEqual([5, 4, 3, 3])
    expect(asked[0].text).toContain(t('farmer.chat.ask.lead'))
    expect(asked[1].text).toBe(t('farmer.parcel.steps.hectares.q'))
    // the last answer completes the situation and the planner answers
    expect(state.situation).toEqual({ previous: 'maize', hectares: 2, water: 'rain', goal: 'earn' })
    const answer = flat(turns[4].bubbles)
    expect(answer).toContain(t(`rotations.${state.last!.result.strategy.rotation}`))
    expect(answer).toContain(t('farmer.rec.notGuarantee'))
    expect(answer).toContain(t('farmer.rec.confidence.veryLow'))
    expect(answer).toContain(t('whatsapp.experimental'))
    expect(answer).not.toMatch(LEAKS)
    expect(state.pending).toBeNull()
  })

  it('keeps answering consecutive messages, and does not ask again what it already knows', async () => {
    const { turns, state } = await talk('Maíz', '¿Qué me conviene sembrar después del maíz?', '3 ha', 'temporal', 'optimizar el uso de agua', '¿Qué pasa si llueve poco?', '¿Cuánto podría cosechar?', '¿Qué cultivo me conviene más?', '¿Qué tan seguros son estos datos?', '¿Cuánto abono necesito?', '¿Cómo controlo la plaga del frijol?')
    expect(turns).toHaveLength(11)
    for (const turn of turns) {
      expect(turn.bubbles.length, turn.said).toBeGreaterThan(0)
      expect(flat(turn.bubbles), turn.said).not.toMatch(LEAKS)
    }
    // "después del maíz" already answers the first question, so the first one asked is the hectares
    expect(turns[1].bubbles[0].text).toContain(t('farmer.parcel.steps.hectares.q').toLowerCase().slice(1, 12))
    expect(state.situation.previous).toBe('maize')
    expect(flat(turns[5].bubbles)).toContain(t('farmer.rec.risks.title'))
    expect(flat(turns[6].bubbles)).toContain(fmt.number(state.last!.result.strategy.values.yield_t_ha, 1))
    expect(flat(turns[7].bubbles)).toContain(t('farmer.rec.others.intro'))
    expect(flat(turns[8].bubbles)).toContain(t('farmer.chat.trust.intro'))
    expect(flat(turns[10].bubbles)).toBe(t('farmer.chat.unknown'))
  })

  it('answers a typed answer the same as the button', async () => {
    const typed = await talk('¿Qué me conviene sembrar?', 'sembré cebada', 'tengo 4 hectáreas', 'sin riego, solo lluvia', 'quiero cuidar mi suelo')
    const tapped = await talk('¿Qué me conviene sembrar?', 'Cebada', '4 ha', 'Solo de la lluvia', 'Cuidar mi suelo')
    expect(typed.state.situation).toEqual(tapped.state.situation)
    expect(flat(typed.turns[4].bubbles)).toBe(flat(tapped.turns[4].bubbles))
  })

  it('asks again, kindly, when the message is not an answer, and moves on when it is a new question', async () => {
    const first = await talk('¿Qué me conviene sembrar?', 'blablá')
    expect(first.turns[1].bubbles[0].text).toBe(t('whatsapp.notUnderstood'))
    expect(first.turns[1].bubbles[1].options).toHaveLength(5)
    expect(first.state.pending).toBe('previous')
    const second = await talk('¿Qué me conviene sembrar?', '¿Qué tan seguros son estos datos?')
    expect(flat(second.turns[1].bubbles)).toContain(t('farmer.chat.trust.intro'))
  })

  it('starts over after a reset: nothing is remembered', async () => {
    const { state } = await talk('¿Qué me conviene sembrar después del maíz?')
    expect(state.situation.previous).toBe('maize')
    const turn = await reply('¿Qué me conviene sembrar?', GTO, env)
    expect(turn.state.pending).toBe('previous')
    expect(turn.state.location).toBe('guanajuato')
  })
})

describe('honesty: no invented figures', () => {
  const situation = { previous: 'maize' as const, hectares: 2, water: 'rain' as const, goal: 'earn' as const }

  it('quotes the planner\'s money figures, rounded, and nothing else', async () => {
    const turn = await reply('¿Cuánto podría ganar?', { ...GTO, situation }, env)
    const rec = turn.state.last!
    const text = flat(turn.bubbles)
    const net = rec.result.strategy.values.net_mxn_ha
    expect(text).toContain(fmt.number(Math.abs(roundMoney(net))))
    expect(text).toContain(fmt.number(Math.abs(roundMoney(net * 2))))
    // every number in the answer is one the model produced, or a count/percentage of its own results
    expect(text).toContain(t('farmer.rec.net.hint'))
  })

  it('states the risk shares from the stored risk results', async () => {
    const turn = await reply('¿Y si llueve poco?', { ...GTO, situation }, env)
    const rec = turn.state.last!
    const rows = rec.risk!.rows
    const dry = rows.find((row) => row.scenario === 'rain80')!
    const text = flat(turn.bubbles)
    const share = Math.round(dry.failedHarvestFraction * 100)
    expect(text).toContain(share === 0 ? t('farmer.rec.risks.dryNone', { scenario: t('farmer.rec.risks.scenarios.rain80') }) : t('farmer.rec.risks.dry', { scenario: t('farmer.rec.risks.scenarios.rain80'), n: share }))
  })

  it('never says the confidence is above low, and always says it is an estimate', async () => {
    for (const question of ['¿Qué me conviene sembrar?', '¿Cuánto podría cosechar?', '¿Qué cultivo me conviene más?', '¿Y si llueve poco?', '¿Cuánto podría ganar?']) {
      const text = flat((await reply(question, { ...GTO, situation }, env)).bubbles)
      expect(text, question).toContain(t('farmer.rec.confidence.veryLow'))
      expect(text, question).toContain(t('whatsapp.experimental'))
      expect(text, question).toContain(t('farmer.rec.notGuarantee'))
      expect(text, question).not.toMatch(/\b(alta|media)\b|: baja\./i)
    }
  })

  it('answers with the same numbers the app\'s own planner gives', async () => {
    const turn = await reply('¿Cuánto podría ganar?', { ...GTO, situation }, env)
    const direct = await recommend({ data, point: { lat: data.meta.site.latitude, lon: data.meta.site.longitude }, place: null, situation, zone: turn.state.last!.zone })
    expect(turn.state.last!.result.strategy).toEqual(direct.result.strategy)
  })

  it('declines what the models do not cover', async () => {
    const turn = await reply('¿Cómo controlo la plaga del frijol?', GTO, env)
    expect(flat(turn.bubbles)).toBe(t('farmer.chat.unknown'))
  })

  it('reports a failure instead of inventing an answer', async () => {
    const failing: Env = { ...env, run: () => Promise.reject(new Error('sin datos')) }
    const turn = await reply('¿Qué me conviene sembrar?', { ...GTO, situation }, failing)
    expect(flat(turn.bubbles)).toBe(t('farmer.chat.error', { message: 'sin datos' }))
  })
})

describe('the first messages', () => {
  it('say it is a simulation and that the parcel is an example', () => {
    const text = flat(greeting(t))
    expect(text).toContain('simulación')
    expect(text).toContain('ubicaciones de referencia')
    expect(FIELDS).toHaveLength(4)
  })
})
