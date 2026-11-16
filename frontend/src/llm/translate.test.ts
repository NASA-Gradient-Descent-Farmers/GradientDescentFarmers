// English for live engine text: the server keeps a translation only when its numbers are the original's, refuses odd
// requests, and the browser fills what the file lacks and remembers it for the visit.
import { describe, expect, it } from 'vitest'
import { missingStrings, resetLiveTranslations, translateLive } from '../lib/dataI18n.ts'
import { handleTranslate, numberKey } from './translate.ts'

const claude = (reply: unknown) => (async () => new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(reply) }] }), { status: 200 })) as unknown as typeof fetch

describe('the translate endpoint', () => {
  it('keeps a translation only when its numbers are unchanged', async () => {
    const strings = ['Produce 2.11 t por ha a $4,508/t.', 'Siembra en junio.']
    const result = await handleTranslate({ strings }, { apiKey: 'k', fetcher: claude(['Yields 2.11 t per ha at $4,508/t.', 'Sow in June 2026.']) })
    expect(result.status).toBe(200)
    expect((result.body as { translations: (string | null)[] }).translations).toEqual(['Yields 2.11 t per ha at $4,508/t.', null])
    expect(numberKey('$4,508 y 2.11')).toBe(numberKey('2.11 and $4508'))
  })

  it('refuses without a key, with an odd body, or too much text', async () => {
    expect((await handleTranslate({ strings: ['hola mundo'] }, {})).status).toBe(503)
    expect((await handleTranslate({ strings: 'hola' }, { apiKey: 'k' })).status).toBe(400)
    expect((await handleTranslate({ strings: Array(200).fill('hola mundo') }, { apiKey: 'k' })).status).toBe(400)
  })

  it('a failing model leaves everything in Spanish', async () => {
    const result = await handleTranslate({ strings: ['hola mundo'] }, { apiKey: 'k', fetcher: claude(['only', 'two']) })
    expect(result.status).toBe(502)
  })
})

describe('translating a live answer in the browser', () => {
  const value = { tarjeta: { por_que: 'Alterna maíz con frijol.', evidencia: [{ texto: 'Maíz (primavera-verano, temporal): $6,128/t.', fuente: 'SIAP' }] }, estado: 'Tlaxcala' }
  const site = (english: Record<string, string | null>, calls: string[][]) =>
    (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('data/i18n/en.json')) return new Response(JSON.stringify({ strings: {} }))
      const { strings } = JSON.parse(String(init!.body)) as { strings: string[] }
      calls.push(strings)
      return new Response(JSON.stringify({ translations: strings.map((s) => english[s] ?? null) }))
    }) as unknown as typeof fetch

  it('asks only for what is missing, once per visit, and never touches names', async () => {
    resetLiveTranslations()
    const calls: string[][] = []
    const fetcher = site({ 'Alterna maíz con frijol.': 'Alternates maize with beans.', 'Maíz (primavera-verano, temporal): $6,128/t.': 'Maize (spring-summer, rainfed): $6,128/t.' }, calls)
    const first = await translateLive(value, '/', fetcher)
    expect(first.complete).toBe(true)
    expect(first.value.tarjeta.por_que).toBe('Alternates maize with beans.')
    expect(first.value.estado).toBe('Tlaxcala')
    expect(calls).toHaveLength(1)
    await translateLive(value, '/', fetcher)
    expect(calls).toHaveLength(1)
    resetLiveTranslations()
  })

  it('says when something stayed in Spanish', async () => {
    resetLiveTranslations()
    const left = await translateLive(value, '/', site({}, []))
    expect(left.complete).toBe(false)
    expect(missingStrings(left.value, new Map())).toHaveLength(2)
    resetLiveTranslations()
  })
})
