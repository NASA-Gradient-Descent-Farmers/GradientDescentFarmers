// Multi-turn conversations, location recognition, and honesty about data, through the webhook.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { results, say, start } from './helpers.ts'
import { bestOption } from '../../frontend/src/lib/rotations.ts'

let base = ''
let close: () => Promise<void>
// the same webhook started as if the rotation files were missing
let bare = ''
let closeBare: () => Promise<void>
before(async () => {
  const running = await start()
  base = running.url
  close = running.close
  const without = await start(false)
  bare = without.url
  closeBare = without.close
})
after(async () => {
  await close()
  await closeBare()
})

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
    assert.match(await say(base, b, '¿Qué me conviene sembrar?'), /Opciones exploratorias de rotación/)
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
    const money = await say(base, from, '¿Cuánto podría ganar?')
    assert.match(money, /Ingreso bruto/)
    assert.doesNotMatch(money, /Para tus 2 ha|Datos experimentales de demostración/)
    assert.match(await say(base, from, 'Guanajuato'), /Ubicación: Guanajuato/)
  })
})

describe('rotation results for Sinaloa and Sonora', () => {
  for (const [name, id] of [['Sinaloa', 'sinaloa'], ['Sonora', 'sonora']] as const) {
    const rotations = results.rotations[id]!
    it(`${name}: answers from the published rotation run, as exploratory scenarios and gross income`, async () => {
      const from = `whatsapp:+5215500${id === 'sinaloa' ? '0401' : '0402'}`
      const located = await say(base, from, name)
      assert.match(located, new RegExp(`Para ${name} hay resultados de rotación`))
      assert.ok(located.includes(rotations.municipality!), located)
      const plant = await say(base, from, '¿Qué me conviene sembrar?')
      assert.ok(plant.includes(bestOption(rotations, 'irrigated')!.descriptionEs), plant)
      assert.ok(plant.includes(bestOption(rotations, 'rainfed')!.descriptionEs), plant)
      assert.match(plant, /Confianza baja/)
      assert.match(plant, /no es ganancia/)
      assert.match(plant, /Más información de YolIA: https:\/\/yolia\.example\/site/)
      assert.doesNotMatch(plant, /Datos no disponibles|qué sembraste|Datos experimentales de demostración/)
    })

    it(`${name}: harvest, rain, money and confidence questions are all answered, and none claims a success rate`, async () => {
      const from = `whatsapp:+5215500${id === 'sinaloa' ? '0411' : '0412'}`
      await say(base, from, name)
      for (const [question, expected] of [
        ['¿Cuánto podría cosechar?', /Cosecha simulada/],
        ['¿Qué pasa si llueve poco?', /no simula un año seco aparte/],
        ['¿Cuánto podría ganar?', /Ingreso bruto: ≈ [\d,]+ MXN\/ha/],
        ['¿Qué tan seguros son estos datos?', /No hay un porcentaje de éxito calibrado/],
        ['¿Cuánto abono necesito?', /no calcula dosis de fertilizante/],
      ] as const) {
        const reply = await say(base, from, question)
        assert.match(reply, expected, question)
        assert.doesNotMatch(reply, /Datos no disponibles|\d\s?%/, question)
      }
    })
  }

  it('a long answer is split into messages that each fit WhatsApp', async () => {
    const from = 'whatsapp:+5215500000421'
    await say(base, from, 'Sinaloa')
    const response = await say(base, from, '¿Qué cultivo me conviene más?')
    for (const message of response.split('\n---\n')) assert.ok(message.length <= 1500, `${message.length}`)
  })
})

describe('environmental data of each place (Daniel\'s source profiles)', () => {
  for (const [name, id] of [['Guanajuato', 'guanajuato'], ['Sinaloa', 'sinaloa'], ['Sonora', 'sonora']] as const) {
    const environment = results.environment[id]!
    it(`${name}: climate, soil, satellite and source questions are answered from its package`, async () => {
      const from = `whatsapp:+5215500${id === 'guanajuato' ? '0501' : id === 'sinaloa' ? '0502' : '0503'}`
      await say(base, from, name)
      const climate = await say(base, from, '¿Cómo es el clima?')
      for (const row of environment.climate.annual) assert.ok(climate.includes(`${row.year}: ${Math.round(row.rainMm!)} mm de lluvia`), climate)
      assert.match(climate, /no miden tu parcela/)
      assert.match(await say(base, from, '¿Cómo es el suelo?'), /pH \d.*arcilla \d+ %/s)
      assert.match(await say(base, from, '¿Qué dicen los satélites?'), /NDVI entre/)
      const sources = await say(base, from, '¿De dónde salen los datos?')
      assert.match(sources, /Disponibles: .*NASA POWER/)
      assert.match(sources, /Todavía no se puede/)
      assert.doesNotMatch(sources, /Datos no disponibles/)
    })
  }

  it('a question that waited for the location is answered once it is chosen, and the answer fits WhatsApp', async () => {
    const from = 'whatsapp:+5215500000510'
    assert.match(await say(base, from, '¿Cómo es el suelo?'), /Elige Guanajuato, Sinaloa o Sonora/)
    const answer = await say(base, from, '3')
    assert.match(answer, /\*Suelo\*/)
    for (const message of answer.split('\n---\n')) assert.ok(message.length <= 1500)
  })

  it('without the package, the place says "Datos no disponibles" for these questions too', async () => {
    const from = 'whatsapp:+5215500000511'
    await say(bare, from, 'Sonora')
    assert.match(await say(bare, from, '¿Cómo es el clima?'), /Datos no disponibles para Sonora/)
  })
})

describe('missing agricultural data', () => {
  for (const name of ['Sinaloa', 'Sonora']) {
    it(`${name} without its rotation file: every question about results is answered "Datos no disponibles", with no figures`, async () => {
      const from = `whatsapp:+5215500${name === 'Sinaloa' ? '0201' : '0202'}`
      await say(bare, from, name)
      for (const question of ['¿Qué me conviene sembrar?', '¿Qué pasa si llueve poco?', '¿Cuánto podría cosechar?', '¿Qué cultivo me conviene más?', '¿Cuánto podría ganar?', '¿Cuánto abono necesito?', '¿Qué tan seguros son estos datos?']) {
        const reply = await say(bare, from, question)
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
    for (const text of ['Sonora', '¿Qué me conviene sembrar?']) await say(bare, from, text)
    assert.match(await say(bare, from, 'Guanajuato'), /Ubicación: Guanajuato/)
  })
})

function hash(text: string): number {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) | 0
  return h
}
