// The server side of the chat's language model: takes a NarrateRequest, asks Claude (Anthropic Messages API) for a reply
// through a forced tool call, checks every number in it against the facts, and retries once when one is not there. Runs in
// the Netlify Function (netlify/functions/yolia-chat.mts) and in the Vite dev server (vite.config.ts); the API key stays on
// the server. No SDK: one fetch.

import { checkNumbers } from './guard.ts'
import { FOLLOW_UPS, RESPOND_TOOL, systemPrompt, userPrompt, type FollowUp, type NarrateRequest, type NarrateResponse } from './prompt.ts'

export const DEFAULT_MODEL = 'claude-sonnet-5-5'
const API_URL = 'https://api.anthropic.com/v1/messages'
const MAX_FACT_LINES = 40
const MAX_LINE = 1200

export interface HandlerEnv {
  apiKey?: string
  model?: string
  fetcher?: typeof fetch
  timeoutMs?: number
}

export interface HandlerResult {
  status: number
  body: NarrateResponse | { error: string; detail?: unknown }
}

const isStringList = (value: unknown, max: number): value is string[] => Array.isArray(value) && value.length <= max && value.every((v) => typeof v === 'string')

/** A request body from the browser, checked; anything odd is refused rather than passed to the model. */
export function parseRequest(raw: unknown): NarrateRequest | null {
  const r = raw as Partial<NarrateRequest> | null
  if (!r || typeof r !== 'object') return null
  if (r.mode !== 'summary' && r.mode !== 'question') return null
  if (r.language !== 'es' && r.language !== 'en') return null
  if (typeof r.question !== 'string' || r.question.length > 2000 || typeof r.context !== 'string' || r.context.length > 1000) return null
  const facts = r.facts as NarrateRequest['facts'] | undefined
  if (!facts || !isStringList(facts.wofost, MAX_FACT_LINES) || !isStringList(facts.district, MAX_FACT_LINES)) return null
  if (![...facts.wofost, ...facts.district].every((line) => line.length <= MAX_LINE)) return null
  if (!Array.isArray(r.followUps) || r.followUps.length > FOLLOW_UPS.length) return null
  const followUps = r.followUps.filter((f): f is { id: FollowUp; label: string } => !!f && (FOLLOW_UPS as readonly string[]).includes(f.id) && typeof f.label === 'string' && f.label.length <= 120)
  const history = Array.isArray(r.history)
    ? r.history.filter((m) => m && (m.from === 'user' || m.from === 'bot') && typeof m.text === 'string').slice(-6).map((m) => ({ from: m.from, text: m.text.slice(0, 600) }))
    : []
  return { mode: r.mode, language: r.language, question: r.question, context: r.context, facts: { wofost: facts.wofost, district: facts.district }, followUps, history }
}

interface ToolUse {
  type: 'tool_use'
  name: string
  input: { mensaje?: unknown; siguientes?: unknown }
}

async function callClaude(request: NarrateRequest, env: Required<Pick<HandlerEnv, 'apiKey' | 'model'>> & HandlerEnv, correction?: string): Promise<{ text: string; followUps: FollowUp[] }> {
  const fetcher = env.fetcher ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), env.timeoutMs ?? 25_000)
  const messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: userPrompt(request) }]
  if (correction) messages[0].content += `\n\n${correction}`
  try {
    const response = await fetcher(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': env.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: env.model,
        max_tokens: 900,
        temperature: 0.3,
        system: systemPrompt(request.language),
        tools: [RESPOND_TOOL],
        tool_choice: { type: 'tool', name: RESPOND_TOOL.name },
        messages,
      }),
    })
    const body = (await response.json()) as { content?: unknown[]; error?: { message?: string } }
    if (!response.ok) throw new Error(body.error?.message ?? `Anthropic API HTTP ${response.status}`)
    const use = (body.content ?? []).find((block): block is ToolUse => (block as ToolUse)?.type === 'tool_use' && (block as ToolUse).name === RESPOND_TOOL.name)
    const text = typeof use?.input.mensaje === 'string' ? use.input.mensaje.trim() : ''
    if (!text) throw new Error('The model returned no message')
    const allowed = new Set(request.followUps.map((f) => f.id))
    const followUps = (Array.isArray(use?.input.siguientes) ? use.input.siguientes : []).filter((id): id is FollowUp => typeof id === 'string' && allowed.has(id as FollowUp)).slice(0, 4)
    return { text, followUps: [...new Set(followUps)] }
  } finally {
    clearTimeout(timer)
  }
}

/** One request, start to finish. Never throws: errors come back as a status and a message the client falls back on. */
export async function handleNarrate(raw: unknown, env: HandlerEnv): Promise<HandlerResult> {
  if (!env.apiKey) return { status: 503, body: { error: 'llm_not_configured' } }
  const request = parseRequest(raw)
  if (!request) return { status: 400, body: { error: 'bad_request' } }
  const facts = [...request.facts.wofost, ...request.facts.district, request.context].join('\n')
  const settings = { ...env, apiKey: env.apiKey, model: env.model || DEFAULT_MODEL }
  try {
    let answer = await callClaude(request, settings)
    let check = checkNumbers(answer.text, facts, request.question)
    if (!check.ok) {
      // one retry, naming the numbers that were not in the facts
      answer = await callClaude(request, settings, `Tu mensaje anterior usó números que no están en los hechos (${check.unsupported.join(', ')}). Escríbelo de nuevo usando solo números que aparezcan en los hechos, o sin números.`)
      check = checkNumbers(answer.text, facts, request.question)
      if (!check.ok) return { status: 422, body: { error: 'unsupported_numbers', detail: check.unsupported } }
    }
    return { status: 200, body: { reply: answer.text, followUps: answer.followUps, model: settings.model } }
  } catch (error) {
    return { status: 502, body: { error: 'llm_failed', detail: error instanceof Error ? error.message : String(error) } }
  }
}
