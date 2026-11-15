// The language-model handler with the Anthropic API stubbed: the request it sends, the structured answer it reads, the
// number check and its one retry, and that every failure becomes a status the chat falls back on.
import { describe, expect, it } from 'vitest'
import { handleNarrate, parseRequest } from './handler.ts'
import { numbersIn } from './guard.ts'
import type { NarrateRequest } from './prompt.ts'

const request: NarrateRequest = {
  mode: 'summary',
  language: 'es',
  question: '¿Qué me conviene sembrar?',
  context: 'Sonora (Bácum, distrito Cajeme), riego',
  facts: { wofost: ['Opción: trigo → soya. Ingreso bruto mediano ≈ $61,234 por ha.'], district: ['Rotación actual: trigo. Valor de la cosecha $46,780 por ha al año.', 'Alternativa garbanzo: Riesgos: precio variable.'] },
  followUps: [
    { id: 'why', label: '¿Por qué esa opción?' },
    { id: 'risks', label: '¿Qué riesgos tiene?' },
  ],
}

const toolReply = (mensaje: string, siguientes: string[] = ['why']) =>
  new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'responder', input: { mensaje, siguientes } }] }), { status: 200 })

function stub(...replies: Response[]) {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> })
    return replies.shift() ?? new Response('{}', { status: 500 })
  }) as unknown as typeof fetch
  return { calls, fetcher }
}

describe('handleNarrate', () => {
  it('asks Claude with a forced tool call and returns its message and allowed follow-ups', async () => {
    const { calls, fetcher } = stub(toolReply('Tu trigo vale $46,780 por ha. La simulación sugiere trigo → soya.', ['why', 'money', 'risks']))
    const result = await handleNarrate(request, { apiKey: 'k', fetcher })
    expect(result).toEqual({ status: 200, body: { reply: 'Tu trigo vale $46,780 por ha. La simulación sugiere trigo → soya.', followUps: ['why', 'risks'], model: 'claude-sonnet-5-5' } })
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages')
    expect(calls[0].headers['x-api-key']).toBe('k')
    expect(calls[0].body).toMatchObject({ model: 'claude-sonnet-5-5', tool_choice: { type: 'tool', name: 'responder' } })
    const prompt = (calls[0].body.messages as { content: string }[])[0].content
    expect(prompt).toContain('HECHOS — Simulación de suelo y cultivo (WOFOST)')
    expect(prompt).toContain('$46,780')
  })

  it('retries once when a number is not in the facts, and refuses a second invented number', async () => {
    const fixed = stub(toolReply('Ganarías 50,000 pesos.'), toolReply('Tu trigo vale $46,780 por ha.'))
    expect((await handleNarrate(request, { apiKey: 'k', fetcher: fixed.fetcher })).status).toBe(200)
    expect((fixed.calls[1].body.messages as { content: string }[])[0].content).toMatch(/50000/)
    const stubborn = stub(toolReply('Ganarías 50,000 pesos.'), toolReply('O quizá 70,000.'))
    expect(await handleNarrate(request, { apiKey: 'k', fetcher: stubborn.fetcher })).toEqual({ status: 422, body: { error: 'unsupported_numbers', detail: [70000] } })
  })

  it('turns a missing key, a bad request and an API error into statuses', async () => {
    expect((await handleNarrate(request, {})).status).toBe(503)
    expect((await handleNarrate({ ...request, mode: 'chat' }, { apiKey: 'k' })).status).toBe(400)
    const failing = stub(new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 529 }))
    expect(await handleNarrate(request, { apiKey: 'k', fetcher: failing.fetcher })).toEqual({ status: 502, body: { error: 'llm_failed', detail: 'overloaded' } })
  })
})

describe('parseRequest and numbersIn', () => {
  it('keeps only known follow-ups and bounded text', () => {
    const parsed = parseRequest({ ...request, followUps: [...request.followUps, { id: 'hack', label: 'x' }] })
    expect(parsed!.followUps.map((f) => f.id)).toEqual(['why', 'risks'])
    expect(parseRequest({ ...request, facts: { wofost: ['x'.repeat(5000)], district: [] } })).toBeNull()
  })

  it('reads numbers as the engines write them', () => {
    expect(numbersIn('$40,252 por ha; 7.05 t; −2,821; 13% y 1982-2025')).toEqual([40252, 7.05, 2821, 13, 1982, 2025])
  })
})
