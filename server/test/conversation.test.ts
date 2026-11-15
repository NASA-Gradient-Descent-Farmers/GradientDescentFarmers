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

describe('a conversation across several messages', () => {
  const me = 'whatsapp:+5215500000101'

  it('keeps its context: location, then questions and follow-ups that need no further questions', async () => {
    const rotations = results.rotations.guanajuato!
    assert.match(await say(base, me, 'Hola'), /Elige Guanajuato, Sinaloa o Sonora/)
    // "1" is read as the first option offered
    const located = await say(base, me, '1')
    assert.match(located, /Ubicación: Guanajuato \(20\.4243195, -101\.1466639\)/)
    assert.match(located, /Para Guanajuato hay resultados de rotación/)
    assert.ok(located.includes(rotations.municipality!), located)
    const plant = await say(base, me, '¿Qué me conviene sembrar?')
    assert.ok(plant.includes(bestOption(rotations, 'irrigated')!.descriptionEs), plant)
    assert.doesNotMatch(plant, /qué sembraste|Datos experimentales de demostración|Datos no disponibles/i)
    // follow-ups use the same place without asking again
    const rain = await say(base, me, '¿Y si llueve poco?')
    assert.match(rain, /Lo que se observó en la zona/)
    assert.match(await say(base, me, '¿Cuánto podría ganar?'), /Ingreso bruto: ≈ [\d,]+ MXN\/ha/)
  })

  it('keeps each farmer\'s conversation apart', async () => {
    const a = 'whatsapp:+5215500000102'
    const b = 'whatsapp:+5215500000103'
    await say(base, a, 'Guanajuato')
    await say(base, b, 'Sonora')
    const first = await say(base, a, '¿Qué me conviene sembrar?')
    const second = await say(base, b, '¿Qué me conviene sembrar?')
    assert.ok(first.includes(bestOption(results.rotations.guanajuato!, 'irrigated')!.descriptionEs), first)
    assert.ok(second.includes(bestOption(results.rotations.sonora!, 'irrigated')!.descriptionEs), second)
    assert.notEqual(first, second)
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
    assert.match(await say(base, from, 'blablá'), /Eso no lo puedo responder/)
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
    for (const text of ['Guanajuato', '¿Qué me conviene sembrar después del maíz?']) await say(base, from, text)
    const switched = await say(base, from, 'Sonora')
    assert.match(switched, /Ubicación: Sonora/)
    const money = await say(base, from, '¿Cuánto podría ganar?')
    assert.match(money, /Ingreso bruto/)
    assert.ok(money.includes(String(Math.round(results.rotations.sonora!.options.find((o) => o.regime === 'irrigated')!.gross!.median! / 1000) * 1000).slice(0, 2)))
    assert.match(await say(base, from, 'Guanajuato'), /Ubicación: Guanajuato/)
  })
})

describe('rotation results for each place', () => {
  for (const [name, id] of [['Guanajuato', 'guanajuato'], ['Sinaloa', 'sinaloa'], ['Sonora', 'sonora']] as const) {
    const rotations = results.rotations[id]!
    it(`${name}: answers from the published rotation run, as exploratory scenarios and gross income`, async () => {
      const from = `whatsapp:+5215500${id === 'guanajuato' ? '0400' : id === 'sinaloa' ? '0401' : '0402'}`
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
      const from = `whatsapp:+5215500${id === 'guanajuato' ? '0410' : id === 'sinaloa' ? '0411' : '0412'}`
      await say(base, from, name)
      for (const [question, expected] of [
        ['¿Cuánto podría cosechar?', /Cosecha simulada/],
        ['¿Qué pasa si llueve poco?', /no simula un año seco aparte/],
        ['¿Cuánto podría ganar?', /Ingreso bruto: ≈ [\d,]+ MXN\/ha/],
        ['¿Qué tan seguros son estos datos?', /No hay un porcentaje de éxito calibrado/],
        ['¿Cuánto abono necesito?', /probar en un pedazo de tu parcela/],
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
      assert.match(sources, /Se usaron: .*NASA POWER/)
      assert.match(sources, /Con estos datos se puede/)
      assert.doesNotMatch(sources, /Datos no disponibles|Todavía no|Sin datos:/)
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

describe('English', () => {
  // words the Spanish text has and an English answer must not
  const SPANISH = /\b(año|ingreso|riego|cosecha|barbecho|maíz|garbanzo|sorgo|trigo|exploratori[oa]s?|experimento|lluvia|confianza|opciones|suelo|datos)\b/i

  it('a conversation opened in English stays in English: location, questions, links and hints', async () => {
    const me = 'whatsapp:+14155550101'
    const greeting = await say(base, me, 'Hello')
    assert.match(greeting, /Hi, I am YolIA/)
    assert.match(greeting, /Reply with the number or type your answer/)
    assert.match(greeting, /Prefer Spanish\? Type \*español\*/)
    assert.match(greeting, /More about YolIA: https:\/\/yolia\.example\/site/)
    assert.doesNotMatch(greeting, SPANISH)
    assert.match(await say(base, me, '3'), /Location: Sonora/)
    for (const question of ['What should I plant?', 'How much will I harvest?', 'What if it rains little?', 'How reliable is this data?', 'What is the climate like?', 'Where does the data come from?']) {
      const answer = await say(base, me, question)
      assert.doesNotMatch(answer, SPANISH, question)
      assert.match(answer, /More about YolIA/, question)
    }
  })

  it('the first message can be an English question, and the location is asked in English', async () => {
    const asked = await say(base, 'whatsapp:+14155550102', 'What should I plant?')
    assert.match(asked, /Which location should I check\?/)
    assert.match(asked, /Reply with the number/)
  })

  it('English and Spanish senders do not affect each other', async () => {
    const english = 'whatsapp:+14155550103'
    const spanish = 'whatsapp:+5215500000601'
    await say(base, english, 'Hello')
    await say(base, spanish, 'Hola')
    assert.match(await say(base, english, 'Sonora'), /Location: Sonora/)
    assert.match(await say(base, spanish, 'Sonora'), /Ubicación: Sonora/)
    assert.match(await say(base, english, 'What should I plant?'), /With irrigation/)
    assert.match(await say(base, spanish, '¿Qué me conviene sembrar?'), /Con riego/)
  })

  it('"english" and "español" switch the conversation, and say so', async () => {
    const from = 'whatsapp:+5215500000602'
    await say(base, from, 'Hola')
    const switched = await say(base, from, 'english')
    assert.match(switched, /Okay, I will continue in English/)
    assert.match(switched, /Hi, I am YolIA/)
    assert.match(await say(base, from, 'Sinaloa'), /Location: Sinaloa/)
    const back = await say(base, from, 'español')
    assert.match(back, /Listo, seguiré en español/)
    assert.match(back, /Hola, soy YolIA/)
  })

  it('a clear English question in a Spanish conversation switches it; a bare place name does not', async () => {
    const from = 'whatsapp:+5215500000603'
    await say(base, from, 'Hola')
    assert.match(await say(base, from, 'Sonora'), /Ubicación: Sonora/)
    assert.match(await say(base, from, 'What should I plant?'), /With irrigation/)
    assert.match(await say(base, from, 'Guanajuato'), /Location: Guanajuato/)
  })

  it('"menu" restarts without changing the language, and greeting twice does not break', async () => {
    const from = 'whatsapp:+14155550104'
    await say(base, from, 'Hello')
    const again = await say(base, from, 'Hello again')
    assert.match(again, /Hi, I am YolIA/)
    assert.match(await say(base, from, 'menu'), /Hi, I am YolIA/)
  })

  it('the numbers are the same in both languages', async () => {
    const a = 'whatsapp:+14155550105'
    const b = 'whatsapp:+5215500000604'
    await say(base, a, 'Sonora')
    await say(base, b, 'Sonora')
    const numbers = (text: string) => [...text.matchAll(/\d[\d,.]*/g)].map((match) => match[0].replace(/[,.]/g, ''))
    assert.deepEqual(numbers(await say(base, a, 'What should I plant?')), numbers(await say(base, b, '¿Qué me conviene sembrar?')))
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
  it('every answer for every place says it is exploratory, and none says it is validated or gives a success rate', async () => {
    for (const [name, index] of [['Guanajuato', 0], ['Sinaloa', 1], ['Sonora', 2]] as const) {
      const from = `whatsapp:+5215500003${index}1`
      await say(base, from, name)
      for (const question of ['¿Qué me conviene sembrar?', '¿Cuánto podría cosechar?', '¿Qué cultivo me conviene más?', '¿Y si llueve poco?', '¿Cuánto podría ganar?']) {
        const reply = await say(base, from, question)
        assert.match(reply, /Confianza baja|no es una predicción|no es ganancia|no simula un año seco/, `${name}: ${question}`)
        assert.doesNotMatch(reply, /\d\s?% de éxito/, `${name}: ${question}`)
      }
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
