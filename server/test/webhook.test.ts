// Authentication and message handling of the webhook, over real HTTP on a random local port. No network, no credentials.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { config, incoming, messagesOf, post, say, start, TOKEN } from './helpers.ts'

let base = ''
let close: () => Promise<void>
before(async () => {
  const running = await start()
  base = running.url
  close = running.close
})
after(() => close())

describe('webhook authentication', () => {
  it('rejects a request with no signature', async () => {
    const response = await post(base, incoming('whatsapp:+5215500000001', 'Hola'), null)
    assert.equal(response.status, 403)
  })

  it('rejects a request signed with the wrong token', async () => {
    const params = incoming('whatsapp:+5215500000001', 'Hola')
    const twilio = (await import('twilio')).default
    const bad = twilio.getExpectedTwilioSignature('another_token_entirely_000000000000', config.webhookUrl, params)
    assert.equal((await post(base, params, bad)).status, 403)
  })

  it('rejects a signature made for a different URL', async () => {
    const params = incoming('whatsapp:+5215500000001', 'Hola')
    const twilio = (await import('twilio')).default
    assert.equal((await post(base, params, twilio.getExpectedTwilioSignature(TOKEN, 'https://evil.test/whatsapp', params))).status, 403)
  })

  it('rejects a body changed after it was signed', async () => {
    const params = incoming('whatsapp:+5215500000001', 'Hola')
    const twilio = (await import('twilio')).default
    const signature = twilio.getExpectedTwilioSignature(TOKEN, config.webhookUrl, params)
    assert.equal((await post(base, { ...params, Body: 'Sonora' }, signature)).status, 403)
  })

  it('accepts a correctly signed request and answers with TwiML', async () => {
    const response = await post(base, incoming('whatsapp:+5215500000002', 'Hola'))
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') ?? '', /text\/xml/)
    assert.match(await response.text(), /^<\?xml[^>]*\?><Response><Message>/)
  })

  it('does not echo the Auth Token anywhere in a reply', async () => {
    const response = await post(base, incoming('whatsapp:+5215500000003', 'Hola'))
    assert.ok(!(await response.text()).includes(TOKEN))
  })

  it('answers only POST /whatsapp, plus a health check', async () => {
    assert.equal((await fetch(`${base}/health`)).status, 200)
    assert.equal((await fetch(`${base}/whatsapp`)).status, 405)
    assert.equal((await fetch(`${base}/other`)).status, 404)
  })

  it('refuses a signed message without a sender', async () => {
    assert.equal((await post(base, { Body: 'Hola' })).status, 400)
  })
})

describe('incoming messages', () => {
  it('opens a new conversation with the welcome, the three locations as numbered options, and the website link', async () => {
    const reply = await say(base, 'whatsapp:+5215500000010', 'Hola')
    assert.match(reply, /soy YoliA/)
    assert.match(reply, /1\. Guanajuato\n2\. Sinaloa\n3\. Sonora/)
    // the chat is YoliA on WhatsApp: it introduces itself and says the locations are reference points, never a simulation
    assert.match(reply, /ubicaciones de referencia/)
    assert.doesNotMatch(reply, /simulaci[oó]n|demostraci[oó]n/i)
    assert.ok(reply.includes(config.siteUrl))
  })

  it('reads the sender and the text from the Twilio form fields', async () => {
    const reply = await say(base, 'whatsapp:+5215500000011', 'quiero sembrar en Sonora')
    assert.match(reply, /Ubicación: Sonora/)
  })

  it('does not read attachments, and says so', async () => {
    const response = await post(base, { ...incoming('whatsapp:+5215500000012', ''), NumMedia: '1' })
    assert.match(messagesOf(await response.text())[0], /solo puedo leer mensajes de texto/)
  })

  it('splits a long answer into messages Twilio accepts', async () => {
    const from = 'whatsapp:+5215500000013'
    for (const text of ['Guanajuato', '¿Qué me conviene sembrar?', 'Maíz', '2 ha', 'Solo de la lluvia']) await say(base, from, text)
    const response = await post(base, incoming(from, 'Ganar más'))
    for (const message of messagesOf(await response.text())) assert.ok(message.length <= 1600, `message of ${message.length} characters`)
  })
})
