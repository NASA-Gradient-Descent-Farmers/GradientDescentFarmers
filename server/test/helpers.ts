import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import twilio from 'twilio'
import type { Config } from '../src/config.ts'
import { loadResults } from '../src/data.ts'
import { createWebhook } from '../src/server.ts'

export const TOKEN = 'test_auth_token_0000000000000000'
export const config: Config = { port: 0, authToken: TOKEN, webhookUrl: 'https://example-tunnel.test/whatsapp', siteUrl: 'https://yolia.example/site', sessionMinutes: 60 }
export const results = loadResults()
export const data = results.data

/** `withRotations: false` starts the webhook as if the rotation files were missing, to test "data unavailable". */
export async function start(withRotations = true): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  const server = createWebhook(config, withRotations ? results : { data, rotations: {} })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { server, url, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

const encode = (params: Record<string, string>) => new URLSearchParams(params).toString()

/** A request as Twilio sends it: form fields plus a signature made with the Auth Token over the public webhook URL. */
export function post(base: string, params: Record<string, string>, signature?: string | null) {
  const sig = signature === undefined ? twilio.getExpectedTwilioSignature(TOKEN, config.webhookUrl, params) : signature
  return fetch(`${base}/whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(sig ? { 'X-Twilio-Signature': sig } : {}) },
    body: encode(params),
  })
}

export const incoming = (from: string, body: string): Record<string, string> => ({ From: from, To: 'whatsapp:+14155238886', Body: body, NumMedia: '0', MessageSid: 'SMtest' })

/** The text of each <Message> in a TwiML answer. */
export function messagesOf(xml: string): string[] {
  const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  return [...xml.matchAll(/<Message>([\s\S]*?)<\/Message>/g)].map((m) => decode(m[1]))
}

/** Sends one message as `from` and returns everything the bot said back. */
export async function say(base: string, from: string, body: string): Promise<string> {
  const response = await post(base, incoming(from, body))
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`)
  return messagesOf(await response.text()).join('\n---\n')
}
