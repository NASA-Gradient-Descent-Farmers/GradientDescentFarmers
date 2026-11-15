// The HTTP side: POST /whatsapp receives Twilio's webhook, checks its signature, runs the conversation and answers
// with TwiML. GET /health is for checking the server is up. Plain node:http, one dependency (the official Twilio SDK).

import { createServer, type IncomingMessage, type Server } from 'node:http'
import twilio from 'twilio'
import type { Results } from './data.ts'
import type { Config } from './config.ts'
import { handleIncoming } from './handler.ts'
import { SessionStore } from './sessions.ts'

const MAX_BODY = 64 * 1024

/** The path Twilio is configured to call. It must match the end of PUBLIC_WEBHOOK_URL. */
export const WEBHOOK_PATH = '/whatsapp'

/** "whatsapp:+5215512345678" -> "whatsapp:+52…678": enough to tell conversations apart in a log, never the full number. */
export const maskSender = (from: string) => from.replace(/(\+\d{2})\d+(\d{3})$/, '$1…$2')

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (piece: Buffer) => {
      size += piece.length
      if (size > MAX_BODY) {
        reject(new Error('too large'))
        request.destroy()
        return
      }
      chunks.push(piece)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

export function createWebhook(config: Config, { data, rotations }: Results, sessions = new SessionStore(config.sessionMinutes)): Server {
  return createServer(async (request, response) => {
    const send = (status: number, body: string, type = 'text/plain; charset=utf-8') => {
      response.writeHead(status, { 'Content-Type': type })
      response.end(body)
    }
    try {
      const path = (request.url ?? '').split('?')[0]
      if (request.method === 'GET' && path === '/health') return send(200, 'ok')
      if (path !== WEBHOOK_PATH) return send(404, 'not found')
      if (request.method !== 'POST') return send(405, 'method not allowed')

      const params = Object.fromEntries(new URLSearchParams(await readBody(request)))
      const signature = request.headers['x-twilio-signature']
      // the official SDK's check over the public URL and every posted field, with the account's Auth Token
      if (typeof signature !== 'string' || !twilio.validateRequest(config.authToken, signature, config.webhookUrl, params)) {
        console.warn('rejected a request with a missing or invalid Twilio signature')
        return send(403, 'invalid signature')
      }
      if (!params.From || params.Body === undefined) return send(400, 'missing From or Body')

      const messages = await handleIncoming({ from: params.From, body: params.Body, media: Number(params.NumMedia ?? 0) || 0 }, { data, rotations, sessions, siteUrl: config.siteUrl })
      console.log(`reply to ${maskSender(params.From)}: ${messages.length} message(s)`)
      const twiml = new twilio.twiml.MessagingResponse()
      for (const message of messages) twiml.message(message)
      return send(200, twiml.toString(), 'text/xml; charset=utf-8')
    } catch (error) {
      console.error('request failed:', error instanceof Error ? error.message : 'unknown error')
      return send(500, 'error')
    }
  })
}
