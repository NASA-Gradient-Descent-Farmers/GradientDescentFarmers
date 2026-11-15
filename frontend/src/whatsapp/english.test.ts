// The WhatsApp chat in English: the questions are understood, the answers are in English all the way down (including the
// text the rotation service wrote in Spanish), and they carry the same figures as the Spanish ones.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { data } from '../assistant/testdata.ts'
import { DICTIONARIES, translate } from '../i18n/translate.ts'
import { demoLocation, type DemoLocationId } from '../lib/demoLocations.ts'
import { parseEnvironment, type EnvironmentByLocation } from '../lib/environment.ts'
import { makeFormat, type Lang } from '../lib/format.ts'
import { parseRotations, type RotationsByLocation } from '../lib/rotations.ts'
import { EMPTY_CHAT, environmentTopicOf, focusOf, greeting, reply, type BotBubble, type Env } from './engine.ts'

const read = (kind: string, id: string): unknown => JSON.parse(readFileSync(new URL(`../../public/data/${kind}/${id}.json`, import.meta.url), 'utf8'))
const ids: DemoLocationId[] = ['guanajuato', 'sinaloa', 'sonora']
const rotations: RotationsByLocation = Object.fromEntries(ids.map((id) => [id, parseRotations(read('rotations', id))]))
const environment: EnvironmentByLocation = Object.fromEntries(ids.map((id) => [id, parseEnvironment(read('environment', id))]))

const envFor = (lang: Lang): Env => {
  const fmt = makeFormat(lang)
  return { data, rotations, environment, lang, t: (path, vars) => translate(DICTIONARIES[lang], path, vars), fmt, distance: (km) => fmt.number(km) }
}
const en = envFor('en')
const es = envFor('es')
const flat = (bubbles: BotBubble[]) => bubbles.map((bubble) => bubble.text).join('\n')
const ask = async (question: string, id: DemoLocationId, env: Env) => flat((await reply(question, { ...EMPTY_CHAT, location: id }, env)).bubbles)

// words that only a Spanish text has: none may reach an English answer
const SPANISH = /\b(año|ingreso|riego|cosecha|barbecho|maíz|garbanzo|sorgo|trigo|exploratori[oa]s?|validad[oa]s?|experimento|lluvia|confianza|opción|opciones|suelo|datos)\b/i

describe('English questions are understood', () => {
  it.each([
    ['What should I plant?', 'plant'],
    ['How much could I earn?', 'money'],
    ['What if it rains little?', 'rain'],
    ['What is the best crop for me?', 'compare'],
    ['How much will I harvest?', 'harvest'],
  ])('"%s" is about %s', (question, focus) => {
    expect(focusOf(question)).toBe(focus)
  })

  it.each([
    ['What is the climate like?', 'climate'],
    ['How much does it rain per year?', 'climate'],
    ['What is the soil like?', 'soil'],
    ['What does the satellite say about vegetation?', 'satellite'],
    ['Where does the data come from?', 'sources'],
  ])('"%s" is about the place\'s %s', (question, topic) => {
    expect(environmentTopicOf(question)).toBe(topic)
  })
})

describe.each(ids)('%s in English', (id) => {
  const QUESTIONS = ['What should I plant?', 'What is the best crop for me?', 'How much will I harvest?', 'How much could I earn?', 'What if it rains little?', 'How reliable is this data?', 'How much fertilizer do I need?', 'What is the climate like?', 'What is the soil like?', 'What does the satellite say about vegetation?', 'Where does the data come from?']

  it('answers every question in English, with no Spanish left in it', async () => {
    for (const question of QUESTIONS) {
      const text = await ask(question, id, en)
      expect(text.length, question).toBeGreaterThan(40)
      expect(text, question).not.toMatch(SPANISH)
    }
  })

  it('carries the same figures as the Spanish answer', async () => {
    const numbers = (text: string) => [...text.matchAll(/\d[\d,.]*/g)].map((match) => match[0].replace(/[,.]/g, ''))
    const english = numbers(await ask('What should I plant?', id, en))
    const spanish = numbers(await ask('¿Qué me conviene sembrar?', id, es))
    expect(english).toEqual(spanish)
  })
})

describe('in a conversation', () => {
  it('opens in English, asks for the location in English, and answers the question that waited', async () => {
    const opening = flat(greeting(en.t))
    expect(opening).toContain('Hi, I am YoliA')
    expect(opening).not.toMatch(SPANISH)
    const asked = await reply('What should I plant?', EMPTY_CHAT, en)
    expect(flat(asked.bubbles)).toContain('Which location should I check?')
    const answered = await reply('Sonora', asked.state, en)
    expect(flat(answered.bubbles)).toContain('With irrigation')
    expect(flat(answered.bubbles)).not.toMatch(SPANISH)
  })

  it('names the place and what exists for it in English', async () => {
    const turn = await reply(demoLocation('sonora').name, EMPTY_CHAT, en)
    const text = flat(turn.bubbles)
    expect(text).toContain('For Sonora there are rotation results')
    expect(text).not.toMatch(SPANISH)
  })

  it('greeting twice does not break: with no location chosen, it greets again', async () => {
    const first = await reply('Hello', EMPTY_CHAT, en)
    const second = await reply('Hello again', first.state, en)
    expect(flat(second.bubbles)).toContain('Hi, I am YoliA')
  })

  it('never claims validation or a success rate, in either language', async () => {
    for (const env of [en, es]) {
      const text = await ask(env === en ? 'What should I plant?' : '¿Qué me conviene sembrar?', 'sonora', env)
      expect(text).not.toMatch(/\d\s?%\s+(chance|probability|de éxito)/i)
    }
  })
})
