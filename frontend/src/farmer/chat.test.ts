import { describe, expect, it } from 'vitest'
import { classify, extractPrevious, nextAsk, parseChat, planReply, userTurn, type Context } from './chat.ts'
import type { Zone } from './recommend.ts'

const inside: Zone = { status: 'inside', key: 'inside', km: 9 }
const answered = { previous: 'maize' as const, hectares: 2, water: 'rain' as const, goal: 'earn' as const }
const ctx = (over: Partial<Context> = {}): Context => ({ hasParcel: true, situation: answered, zone: inside, last: null, ...over })

describe('classify', () => {
  it('reads the topic of a question in plain Spanish or English', () => {
    const cases: [string, ReturnType<typeof classify>][] = [
      ['¿Qué me conviene sembrar después del maíz?', 'plant'],
      ['¿Cuánto podría ganar?', 'money'],
      ['¿Y si llueve poco?', 'rain'],
      ['¿Qué tan seguros son estos datos?', 'trust'],
      ['¿Cuánto abono necesito?', 'fertilizer'],
      ['Hola', 'hello'],
      ['¿Cómo controlo la plaga del frijol?', 'unknown'],
      ['What should I plant?', 'plant'],
      ['how reliable is this', 'trust'],
    ]
    for (const [text, intent] of cases) expect(classify(text), text).toBe(intent)
  })
})

describe('extractPrevious', () => {
  it('takes the crop named after "después de"', () => {
    expect(extractPrevious('¿Qué me conviene sembrar después del maíz?')).toBe('maize')
    expect(extractPrevious('qué siembro después de la cebada')).toBe('barley')
    expect(extractPrevious('y después de haba?')).toBe('fababean')
    expect(extractPrevious('qué me conviene sembrar')).toBeNull()
  })
})

describe('planReply', () => {
  it('asks for the parcel first, then the first unanswered question, as a conversation', () => {
    const noParcel = planReply('¿Qué me conviene sembrar?', ctx({ hasParcel: false, situation: {} }))
    expect(noParcel.plan).toEqual({ kind: 'say', bodies: [{ kind: 'ask', field: 'parcel', lead: true }] })
    const noWater = planReply('¿Qué me conviene sembrar después del maíz?', ctx({ situation: { hectares: 3, goal: 'water' } }))
    expect(noWater.patch).toEqual({ previous: 'maize' })
    expect(noWater.plan).toEqual({ kind: 'say', bodies: [{ kind: 'ask', field: 'water', lead: true }] })
  })

  it('runs the planner only when everything is known and the parcel is in the validated area', () => {
    expect(planReply('¿Cuánto podría ganar?', ctx()).plan).toEqual({ kind: 'recommend', focus: 'money' })
    expect(planReply('¿Y si llueve poco?', ctx()).plan).toEqual({ kind: 'recommend', focus: 'rain' })
    const outside: Zone = { status: 'outside', key: 'outsideDistance', km: 480 }
    expect(planReply('¿Qué sembrar?', ctx({ zone: outside })).plan).toEqual({ kind: 'say', bodies: [{ kind: 'outside', km: 480 }] })
  })

  it('answers the other topics without running anything, and declines what it does not cover', () => {
    expect(planReply('hola', ctx()).plan).toEqual({ kind: 'say', bodies: [{ kind: 'greeting' }] })
    expect(planReply('¿Qué tan seguros son los datos?', ctx()).plan).toEqual({ kind: 'say', bodies: [{ kind: 'trust' }] })
    expect(planReply('¿Cuánto abono necesito?', ctx()).plan).toEqual({ kind: 'say', bodies: [{ kind: 'fertilizer', rec: null }] })
    expect(planReply('¿Cómo controlo la plaga?', ctx()).plan).toEqual({ kind: 'say', bodies: [{ kind: 'unknown' }] })
  })
})

describe('nextAsk', () => {
  it('goes parcel, previous, hectares, water, goal, then nothing', () => {
    expect(nextAsk(false, answered)).toBe('parcel')
    expect(nextAsk(true, {})).toBe('previous')
    expect(nextAsk(true, { previous: 'none' })).toBe('hectares')
    expect(nextAsk(true, answered)).toBeNull()
  })
})

describe('parseChat', () => {
  it('keeps well-formed turns and drops anything else', () => {
    const good = [
      { id: 'a', at: 1, role: 'user', text: 'hola' },
      { id: 'b', at: 2, role: 'bot', body: { kind: 'ask', field: 'water', lead: false } },
      { id: 'c', at: 3, role: 'bot', body: { kind: 'trust' } },
    ]
    const bad = [{ id: 'd', at: 4, role: 'bot', body: { kind: 'ask', field: 'colour' } }, { id: 'e', at: 5, role: 'bot', body: { kind: 'nonsense' } }, { role: 'user' }, 5]
    expect(parseChat(JSON.stringify([...good, ...bad])).map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(parseChat('nope')).toEqual([])
  })

  it('keeps the dictionary key of what a button said, so it can be shown in the language chosen later', () => {
    const turn = userTurn('¿Cuánto podría ganar?', { key: 'farmer.chat.suggestions.money' })
    const back = parseChat(JSON.stringify([turn]))[0]
    expect(back).toMatchObject({ role: 'user', text: '¿Cuánto podría ganar?', key: 'farmer.chat.suggestions.money' })
    expect(userTurn('hola')).not.toHaveProperty('key')
  })

})
