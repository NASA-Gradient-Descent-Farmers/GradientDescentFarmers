// Netlify Function behind /api/yolia-translate (see public/_redirects): English for live district-engine text that was not
// translated ahead of time. Same key as the chat (ANTHROPIC_API_KEY, optional YOLIA_LLM_MODEL); without it, 503 and the
// page keeps the Spanish.

import { handleTranslate, MAX_CHARS } from '../../src/llm/translate.ts'

export default async (request: Request): Promise<Response> => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  const text = await request.text()
  if (text.length > MAX_CHARS * 2) return json(413, { error: 'too_large' })
  let body: unknown = null
  try {
    body = JSON.parse(text)
  } catch {
    // refused below
  }
  const result = await handleTranslate(body, { apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.YOLIA_LLM_MODEL })
  return json(result.status, result.body)
}
