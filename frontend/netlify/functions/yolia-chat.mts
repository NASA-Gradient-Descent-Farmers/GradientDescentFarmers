// Netlify Function behind /api/yolia-chat (see public/_redirects): the chat's language model. The Anthropic key is a Netlify
// environment variable (ANTHROPIC_API_KEY, optional YOLIA_LLM_MODEL) and never reaches the browser. Without the key the function
// answers 503 and the chat keeps its written templates.

import { handleNarrate } from '../../src/llm/handler.ts'

const MAX_BODY = 60_000

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { 'content-type': 'application/json' } })
  const text = await request.text()
  if (text.length > MAX_BODY) return new Response(JSON.stringify({ error: 'too_large' }), { status: 413, headers: { 'content-type': 'application/json' } })
  let body: unknown = null
  try {
    body = JSON.parse(text)
  } catch {
    // parseRequest refuses it below
  }
  const result = await handleNarrate(body, { apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.YOLIA_LLM_MODEL })
  return new Response(JSON.stringify(result.body), { status: result.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}
