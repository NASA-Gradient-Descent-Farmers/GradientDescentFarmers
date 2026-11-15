import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ConfigError, loadConfig } from '../src/config.ts'
import { chunk, MAX_MESSAGE } from '../src/handler.ts'
import { maskSender } from '../src/server.ts'
import { SessionStore } from '../src/sessions.ts'
import { EMPTY_CHAT } from '../../frontend/src/whatsapp/engine.ts'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadEnvironmentResults, loadRotationResults } from '../src/data.ts'

describe('configuration from the environment', () => {
  it('needs the token and the public URL, and says what is missing', () => {
    assert.throws(() => loadConfig({}), (e: unknown) => e instanceof ConfigError && /TWILIO_AUTH_TOKEN, PUBLIC_WEBHOOK_URL/.test(e.message))
  })
  it('requires an https webhook URL', () => {
    assert.throws(() => loadConfig({ TWILIO_AUTH_TOKEN: 'x', PUBLIC_WEBHOOK_URL: 'http://localhost:3000/whatsapp' }), ConfigError)
  })
  it('reads the settings and applies defaults', () => {
    const config = loadConfig({ TWILIO_AUTH_TOKEN: ' tok ', PUBLIC_WEBHOOK_URL: 'https://a.test/whatsapp', PORT: '' })
    assert.equal(config.authToken, 'tok')
    assert.equal(config.port, 3000)
    assert.equal(config.sessionMinutes, 360)
  })
})

describe('sessions', () => {
  it('remember a conversation and forget it when idle', () => {
    let now = 0
    const store = new SessionStore(10, () => now)
    store.set('a', { ...EMPTY_CHAT, location: 'sonora' }, ['x'])
    assert.equal(store.get('a')?.state.location, 'sonora')
    now = 9 * 60_000
    assert.ok(store.get('a'))
    now = 20 * 60_000
    assert.equal(store.get('a'), null)
  })
})

describe('message splitting and logging', () => {
  it('keeps short text whole and splits long text under the limit', () => {
    assert.deepEqual(chunk('hola\n\nmundo'), ['hola\n\nmundo'])
    const long = Array.from({ length: 40 }, (_, i) => `Párrafo ${i} ${'x'.repeat(90)}`).join('\n\n')
    const parts = chunk(long)
    assert.ok(parts.length > 1)
    for (const part of parts) assert.ok(part.length <= MAX_MESSAGE)
    assert.equal(parts.join('\n\n').replace(/\s+/g, ''), long.replace(/\s+/g, ''))
  })
  it('masks phone numbers in logs', () => {
    assert.equal(maskSender('whatsapp:+5215512345678'), 'whatsapp:+52…678')
  })
})

describe('loading the rotation results from disk', () => {
  it('loads the published rotation file of every demonstration place', () => {
    assert.deepEqual(Object.keys(loadRotationResults()).sort(), ['guanajuato', 'sinaloa', 'sonora'])
  })

  it('leaves out a file that is missing or fails the check, with a warning, instead of failing to start', (context) => {
    const warn = context.mock.method(console, 'warn', () => {})
    const dir = mkdtempSync(join(tmpdir(), 'yolia-rotations-'))
    mkdirSync(join(dir, 'rotations'))
    writeFileSync(join(dir, 'rotations', 'sinaloa.json'), JSON.stringify({ version: 7 }))
    assert.deepEqual(loadRotationResults(pathToFileURL(`${dir}/`)), {})
    assert.equal(warn.mock.callCount(), 3)
  })
})

describe('loading the environmental packages from disk', () => {
  it('loads the published package of every demonstration place', () => {
    assert.deepEqual(Object.keys(loadEnvironmentResults()).sort(), ['guanajuato', 'sinaloa', 'sonora'])
  })

  it('leaves out a package that is missing or fails the check, with a warning', (context) => {
    const warn = context.mock.method(console, 'warn', () => {})
    const dir = mkdtempSync(join(tmpdir(), 'yolia-environment-'))
    mkdirSync(join(dir, 'environment'))
    writeFileSync(join(dir, 'environment', 'sonora.json'), JSON.stringify({ version: 9 }))
    assert.deepEqual(loadEnvironmentResults(pathToFileURL(`${dir}/`)), {})
    assert.equal(warn.mock.callCount(), 3)
  })
})
