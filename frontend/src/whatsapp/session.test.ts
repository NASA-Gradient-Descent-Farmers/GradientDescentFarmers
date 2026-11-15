import { describe, expect, it } from 'vitest'
import { data } from '../assistant/testdata.ts'
import { DICTIONARIES, translate } from '../i18n/translate.ts'
import { makeFormat } from '../lib/format.ts'
import { EMPTY_CHAT, type BotBubble, type Env } from './engine.ts'
import { converse, type Hooks } from './session.ts'

const t = (path: string, vars?: Record<string, string | number>) => translate(DICTIONARIES.es, path, vars)
const fmt = makeFormat('es')
const env: Env = { data, t, fmt, distance: (km) => String(km) }

function recorder(alive = () => true) {
  const log: string[] = []
  const shown: BotBubble[] = []
  const hooks: Hooks = {
    typing: (on) => log.push(on ? 'typing' : 'idle'),
    show: (bubble) => {
      log.push('bubble')
      shown.push(bubble)
    },
    wait: () => Promise.resolve(),
    alive,
  }
  return { log, shown, hooks }
}

describe('converse', () => {
  it('shows the typing indicator, then each bubble after its own pause, then stops typing', async () => {
    const { log, shown, hooks } = recorder()
    const state = await converse('¿Qué tan seguros son estos datos?', EMPTY_CHAT, env, hooks, 0)
    expect(shown.length).toBe(3)
    expect(log).toEqual(['typing', 'bubble', 'typing', 'bubble', 'typing', 'bubble', 'idle'])
    expect(state).toEqual(EMPTY_CHAT)
  })

  it('returns the state the next message continues from', async () => {
    const { hooks } = recorder()
    const state = await converse('¿Qué me conviene sembrar?', EMPTY_CHAT, env, hooks, 0)
    expect(state.pending).toBe('previous')
  })

  it('drops the answer if the conversation was reset while it was typing', async () => {
    let alive = true
    const { shown, hooks } = recorder(() => alive)
    const wait = hooks.wait
    hooks.wait = async (ms) => {
      alive = false
      await wait(ms)
    }
    const state = await converse('¿Qué me conviene sembrar?', EMPTY_CHAT, env, hooks, 0)
    expect(shown).toEqual([])
    expect(state).toBe(EMPTY_CHAT)
  })
})
