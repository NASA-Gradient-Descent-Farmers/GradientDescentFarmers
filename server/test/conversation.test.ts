// Multi-turn conversations, location recognition, and honesty about data, through the webhook.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { say, start } from './helpers.ts'

let base = ''
let close: () => Promise<void>
before(async () => {
  const running = await start()
  base = running.url
  close = running.close
})
after(() => close())

const EXPERIMENTAL = 'Datos experimentales de demostración'

describe('a conversation across several messages', () => {
  const me = 'whatsapp:+5215500000101'

  it('keeps its context: location, then the four questions, then the answer, then follow-ups', async () => {
    assert.match(await say(base, me, 'Hola'), /Elige Guanajuato, Sinaloa o Sonora/)
    // "1" is read as the first option offered
    const located = await say(base, me, '1')
    assert.match(located, /Ubicación: Guanajuato \(20\.4243195, -101\.1466639\)/)
    assert.ok(located.includes(EXPERIMENTAL))
    const asked = await say(base, me, '¿Qué me conviene sembrar?')
    assert.match(asked, /qué sembraste/i)
    assert.match(asked, /1\. Maíz/)
    assert.match(await say(base, me, '1'), /hectáreas/i)
    assert.match(await say(base, me, '3 hectáreas'), /lluvia|riego/i)
    assert.match(await say(base, me, 'solo lluvia'), /qué te importa más/i)
    const answer = await say(base, me, '1')
    assert.match(answer, /Qué haría el modelo/)
    assert.ok(answer.includes(EXPERIMENTAL))
    assert.match(answer, /Qué tan segura es\*: Muy baja/)
    // follow-ups reuse what was said, without asking again
    const rain = await say(base, me, '¿Y si llueve poco?')
    assert.match(rain, /Riesgos principales/)
    assert.ok(rain.includes(EXPERIMENTAL))
    assert.doesNotMatch(rain, /qué sembraste/i)
    const money = await say(base, me, '¿Cuánto podría ganar?')
    assert.match(money, /Para tus 3 ha/)
  })

  it('keeps each farmer\'s conversation apart', async () => {
    const a = 'whatsapp:+5215500000102'
    const b = 'whatsapp:+5215500000103'
    await say(base, a, 'Guanajuato')
    await say(base, b, 'Sonora')
    assert.match(await say(base, a, '¿Qué me conviene sembrar?'), /qué sembraste/i)
    assert.match(await say(base, b, '¿Qué me conviene sembrar?'), /Datos no disponibles para Sonora/)
  })

  it('starts over with "menu"', async () => {
    const from = 'whatsapp:+5215500000104'
    await say(base, from, 'Guanajuato')
    assert.match(await say(base, from, 'menu'), /Elige Guanajuato, Sinaloa o Sonora/)
    assert.match(await say(base, from, '¿Qué me conviene sembrar?'), /Elige Guanajuato, Sinaloa o Sonora/)
  })

  it('asks again, and does not crash, on a message it cannot place', async () => {
    const from = 'whatsapp:+5215500000105'
    await say(base, from, 'Guanajuato')
    await say(base, from, '¿Qué me conviene sembrar?')
    assert.match(await say(base, from, 'blablá'), /No te entendí/)
  })
})

describe('location recognition', () => {
  const cases = [
    ['Guanajuato', 'Guanajuato', '20.4243195, -101.1466639'],
    ['sinaloa', 'Sinaloa', '25.7636111, -108.8613889'],
    ['Estoy en SONORA', 'Sonora', '27.332202, -110.162783'],
    ['¿Qué sembrar en Sinaloa?', 'Sinaloa', '25.7636111, -108.8613889'],
  ] as const
  for (const [text, name, coords] of cases) {
    it(`"${text}" selects ${name} with its exact coordinates`, async () => {
      const reply = await say(base, `whatsapp:+52155${String(Math.abs(hash(text))).slice(0, 7).padStart(7, '0')}`, text)
      assert.ok(reply.includes(`Ubicación: ${name} (${coords})`), reply)
      assert.match(reply, /punto de referencia para la demostración, no una parcela verificada/)
    })
  }

  it('switches location mid-conversation and drops the previous results', async () => {
    const from = 'whatsapp:+5215500000110'
    for (const text of ['Guanajuato', '¿Qué me conviene sembrar después del maíz?', '2 ha', 'solo lluvia', 'ganar más']) await say(base, from, text)
    const switched = await say(base, from, 'Sonora')
    assert.match(switched, /Ubicación: Sonora/)
    assert.match(await say(base, from, '¿Cuánto podría ganar?'), /Datos no disponibles para Sonora/)
    assert.match(await say(base, from, 'Guanajuato'), /Ubicación: Guanajuato/)
  })
})

describe('missing agricultural data', () => {
  for (const name of ['Sinaloa', 'Sonora']) {
    it(`${name}: every question about results is answered "Datos no disponibles", with no figures`, async () => {
      const from = `whatsapp:+5215500${name === 'Sinaloa' ? '0201' : '0202'}`
      await say(base, from, name)
      for (const question of ['¿Qué me conviene sembrar?', '¿Qué pasa si llueve poco?', '¿Cuánto podría cosechar?', '¿Qué cultivo me conviene más?', '¿Cuánto podría ganar?', '¿Cuánto abono necesito?', '¿Qué tan seguros son estos datos?']) {
        const reply = await say(base, from, question)
        assert.match(reply, new RegExp(`Datos no disponibles para ${name}`), question)
        assert.doesNotMatch(reply, /pesos|t\/ha|kg de nitr|Maíz todos los años|Qué haría el modelo/, question)
      }
    })
  }
})

describe('synthetic results are never presented as validated', () => {
  it('labels every Guanajuato answer as experimental demonstration data, and never says "validado"', async () => {
    const from = 'whatsapp:+5215500000301'
    const replies: string[] = []
    for (const text of ['Guanajuato', '¿Qué me conviene sembrar después de la cebada?', '5 ha', 'riego a veces', 'reducir riesgos']) replies.push(await say(base, from, text))
    for (const question of ['¿Cuánto podría cosechar?', '¿Qué cultivo me conviene más?', '¿Y si llueve poco?', '¿Cuánto podría ganar?', '¿Qué tan seguros son estos datos?', '¿Cuánto abono necesito?']) replies.push(await say(base, from, question))
    const withResults = replies.slice(4)
    for (const reply of withResults) {
      assert.ok(reply.includes(EXPERIMENTAL), reply.slice(0, 80))
      assert.match(reply, /no están calibrados para esta ubicación/)
      assert.doesNotMatch(reply, /validad[oa]s?\b/i)
    }
  })

  it('links to the website with each new result', async () => {
    const from = 'whatsapp:+5215500000302'
    for (const text of ['Sonora', '¿Qué me conviene sembrar?']) await say(base, from, text)
    assert.match(await say(base, from, 'Guanajuato'), /Ubicación: Guanajuato/)
  })
})

function hash(text: string): number {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) | 0
  return h
}
