// The browser side: asks the app's own endpoint (/api/yolia-chat, a Netlify Function in production and a Vite middleware in
// development) for a reply. Returns null on any failure (no key configured, offline, timeout, a number the model could not
// support), and the chat then uses its written template instead. The API key never reaches the browser.

import type { NarrateRequest, NarrateResponse } from './prompt.ts'

export type Narrator = (request: NarrateRequest) => Promise<NarrateResponse | null>

export const LLM_PATH = 'api/yolia-chat'

/** Whether the app was built to try the language model. On by default; VITE_LLM=off turns it off (e.g. a fully offline demo). */
export const llmEnabled = (): boolean => (import.meta.env?.VITE_LLM as string | undefined)?.trim().toLowerCase() !== 'off'

/**
 * Whether the endpoint is there and has a key: an empty request is refused with 400 "bad_request" only by a configured
 * handler (no key gives 503; a static host without the function gives 404 or its index.html). The page says an AI writes
 * the summaries only when this is true.
 */
export async function probeNarrator(base: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetcher(`${base}${LLM_PATH}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    if (response.status !== 400) return false
    const body = (await response.json()) as { error?: string }
    return body.error === 'bad_request'
  } catch {
    return false
  }
}

export function makeNarrator(base: string, fetcher: typeof fetch = fetch, timeoutMs = 30_000): Narrator {
  let unavailable = false
  return async (request) => {
    if (unavailable) return null
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetcher(`${base}${LLM_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      })
      // no endpoint (a plain static host) or no key: stop asking for the rest of the visit
      if (response.status === 404 || response.status === 405 || response.status === 503) unavailable = true
      if (!response.ok) return null
      const body = (await response.json()) as NarrateResponse
      return typeof body.reply === 'string' && body.reply.trim() ? { reply: body.reply, followUps: Array.isArray(body.followUps) ? body.followUps : [], model: String(body.model ?? '') } : null
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }
}
