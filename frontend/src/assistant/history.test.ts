import { afterEach, describe, expect, it, vi } from 'vitest'
import { interpret } from './interpret.ts'
import {
  addTurn, emptyStored, loadStored, MAX_CONVERSATIONS, MAX_MESSAGES, newConversation, parseStored, removeConversation,
  saveStored, titleFrom, updateAssistant, upsertConversation, type AssistantMessage, type Conversation, type UserMessage,
} from './history.ts'
import { defaults } from './testdata.ts'

const user = (text: string, at = 1): UserMessage => ({ id: `u${at}`, role: 'user', text, at })
const reply = (at = 2, status: AssistantMessage['status'] = 'done'): AssistantMessage => ({
  id: `a${at}`, role: 'assistant', at, status, interpretation: interpret('¿Qué sembrar?', defaults), progress: {}, outcomes: [],
})
const conversation = (id: string, at: number): Conversation => ({ ...newConversation(at), id, title: id })

describe('conversations', () => {
  it('names a conversation after its first question, trimmed, and keeps that name', () => {
    expect(titleFrom('  ¿Qué   sembrar\ny cuánto abonar?  ')).toBe('¿Qué sembrar y cuánto abonar?')
    expect(titleFrom('x'.repeat(100))).toHaveLength(48)
    expect(titleFrom('x'.repeat(100)).endsWith('…')).toBe(true)
    const first = addTurn(newConversation(0), user('Primera pregunta'), reply())
    expect(first.title).toBe('Primera pregunta')
    expect(addTurn(first, user('Otra', 3), reply(4)).title).toBe('Primera pregunta')
  })

  it('adds a question with its answer, and keeps only the latest messages', () => {
    let c = newConversation(0)
    for (let i = 0; i < MAX_MESSAGES; i++) c = addTurn(c, user(`q${i}`, 2 * i), reply(2 * i + 1))
    expect(c.messages).toHaveLength(MAX_MESSAGES)
    expect(c.messages[c.messages.length - 1].role).toBe('assistant')
  })

  it('changes one answer and leaves the others', () => {
    const c = addTurn(addTurn(newConversation(0), user('a', 1), reply(2)), user('b', 3), reply(4))
    const changed = updateAssistant(c, 'a4', (m) => ({ ...m, status: 'interrupted' }))
    expect(changed.messages.filter((m) => m.role === 'assistant').map((m) => (m as AssistantMessage).status)).toEqual(['done', 'interrupted'])
  })

  it('lists the most recent first, replaces a conversation by id, and caps the list', () => {
    let list: Conversation[] = []
    for (let i = 0; i < MAX_CONVERSATIONS + 3; i++) list = upsertConversation(list, conversation(`c${i}`, i))
    expect(list).toHaveLength(MAX_CONVERSATIONS)
    expect(list[0].id).toBe(`c${MAX_CONVERSATIONS + 2}`)
    list = upsertConversation(list, { ...conversation('c5', 999), title: 'renamed' })
    expect(list[0]).toMatchObject({ id: 'c5', title: 'renamed' })
    expect(list.filter((c) => c.id === 'c5')).toHaveLength(1)
    expect(removeConversation(list, 'c5').some((c) => c.id === 'c5')).toBe(false)
  })
})

describe('parseStored', () => {
  const stored = (conversations: unknown[], extra = {}) => JSON.stringify({ version: 1, activeId: null, conversations, settings: null, ...extra })

  it('reads back what was saved', () => {
    const c = addTurn(newConversation(0), user('hola'), reply())
    const parsed = parseStored(stored([c], { activeId: c.id, settings: defaults }))
    expect(parsed.conversations[0].messages).toHaveLength(2)
    expect(parsed.activeId).toBe(c.id)
    expect(parsed.settings?.world).toBe('calibrated')
  })

  it('marks an answer that was still running as interrupted', () => {
    const c = addTurn(newConversation(0), user('hola'), reply(2, 'running'))
    const parsed = parseStored(stored([c]))
    expect((parsed.conversations[0].messages[1] as AssistantMessage).status).toBe('interrupted')
  })

  it('drops what is malformed instead of failing', () => {
    const good = addTurn(newConversation(0), user('hola'), reply())
    const parsed = parseStored(stored([good, { id: 5 }, { id: 'x', title: 't', messages: [{ role: 'user' }, { role: 'assistant', id: 'a', at: 1 }] }, 'nope'], { activeId: 'missing' }))
    expect(parsed.conversations.map((c) => c.id)).toEqual([good.id, 'x'])
    expect(parsed.conversations[1].messages).toEqual([]) // both of its messages were invalid
    expect(parsed.activeId).toBeNull()
  })

  it('gives an empty history for anything unusable', () => {
    for (const text of [null, '', 'not json', '[]', '{"version":2,"conversations":[]}', '{"version":1}']) expect(parseStored(text), String(text)).toEqual(emptyStored())
  })
})

describe('storage', () => {
  afterEach(() => vi.unstubAllGlobals())
  const memory = () => {
    const data = new Map<string, string>()
    return { data, api: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) } }
  }

  it('saves and loads', () => {
    const { api } = memory()
    vi.stubGlobal('localStorage', api)
    const c = addTurn(newConversation(0), user('hola'), reply())
    expect(saveStored({ ...emptyStored(), conversations: [c], activeId: c.id })).toBe(true)
    expect(loadStored().conversations[0].title).toBe('hola')
  })

  it('makes room by dropping the oldest conversations when the quota is reached', () => {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (v.length > 250) throw new DOMException('quota', 'QuotaExceededError')
        data.set(k, v)
      },
    })
    const list = [conversation('new', 3), conversation('mid', 2), conversation('old', 1)]
    expect(saveStored({ ...emptyStored(), conversations: list })).toBe(true)
    const saved = loadStored().conversations.map((c) => c.id)
    expect(saved[0]).toBe('new') // the newest is kept
    expect(saved).toEqual(['new', 'mid']) // the oldest went first
  })

  it('keeps working when storage is blocked', () => {
    const blocked = () => {
      throw new Error('blocked')
    }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked })
    expect(saveStored(emptyStored())).toBe(false)
    expect(loadStored()).toEqual(emptyStored())
  })
})
