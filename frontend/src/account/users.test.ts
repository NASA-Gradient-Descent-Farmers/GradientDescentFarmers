import { afterEach, describe, expect, it, vi } from 'vitest'
import { forgetOwner, scopedKey, setStorageOwner } from './storage.ts'
import {
  cleanName,
  createAccount,
  initialOf,
  loadAccounts,
  loadSession,
  MAX_ACCOUNTS,
  MAX_NAME,
  parseAccounts,
  removeAccount,
  storeAccounts,
  storeSession,
  withMode,
  type Account,
} from './users.ts'

const ana: Account = { id: 'a1', name: 'Ana', mode: 'agricultor', createdAt: 1 }

describe('names', () => {
  it('are tidied: extra spaces go and the length is capped', () => {
    expect(cleanName('  Ana   María \n')).toBe('Ana María')
    expect(cleanName('x'.repeat(100))).toHaveLength(MAX_NAME)
    expect(cleanName('   ')).toBe('')
  })

  it('give a capital initial for the badge', () => {
    expect(initialOf('ana')).toBe('A')
    expect(initialOf('  óscar')).toBe('Ó')
    expect(initialOf('')).toBe('?')
  })
})

describe('creating an account', () => {
  it('adds it with its mode and keeps the existing ones', () => {
    const result = createAccount([ana], '  Beto ', 'tecnico', 5, 'b2')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.account).toEqual({ id: 'b2', name: 'Beto', mode: 'tecnico', createdAt: 5 })
    expect(result.accounts.map((a) => a.id)).toEqual(['a1', 'b2'])
  })

  it('refuses an empty name', () => {
    expect(createAccount([], '   ', 'agricultor', 1, 'x')).toEqual({ ok: false, reason: 'empty' })
  })

  it('refuses a name already taken, ignoring capitals and accents', () => {
    expect(createAccount([{ ...ana, name: 'Ángela' }], 'angela', 'agricultor', 1, 'x')).toEqual({ ok: false, reason: 'taken' })
  })

  it('refuses more than the limit', () => {
    const many = Array.from({ length: MAX_ACCOUNTS }, (_, i) => ({ ...ana, id: `id${i}`, name: `Persona ${i}` }))
    expect(createAccount(many, 'Una más', 'agricultor', 1, 'x')).toEqual({ ok: false, reason: 'full' })
  })
})

describe('changing accounts', () => {
  it('removes one by id', () => {
    expect(removeAccount([ana, { ...ana, id: 'b2', name: 'Beto' }], 'a1').map((a) => a.id)).toEqual(['b2'])
  })

  it('changes only that account\'s mode', () => {
    const list = [ana, { ...ana, id: 'b2', name: 'Beto' }]
    const next = withMode(list, 'b2', 'tecnico')
    expect(next.map((a) => a.mode)).toEqual(['agricultor', 'tecnico'])
  })
})

describe('reading stored accounts', () => {
  it('drops anything that does not check out', () => {
    const text = JSON.stringify([
      ana,
      { id: 'a1', name: 'Repetida', mode: 'agricultor' }, // same id again
      { id: '', name: 'Sin id', mode: 'agricultor' },
      { id: 'c:3', name: 'Dos puntos', mode: 'agricultor' }, // a colon would break the storage keys
      { id: 'd4', name: '   ', mode: 'agricultor' },
      { id: 'e5', name: 'Modo raro', mode: 'admin' },
      'texto',
      null,
    ])
    expect(parseAccounts(text)).toEqual([ana])
  })

  it('gives nothing for missing or broken text', () => {
    expect(parseAccounts(null)).toEqual([])
    expect(parseAccounts('{no')).toEqual([])
    expect(parseAccounts('{"a":1}')).toEqual([])
  })
})

describe('storage', () => {
  const fake = (initial: Record<string, string> = {}) => {
    const data = new Map(Object.entries(initial))
    vi.stubGlobal('localStorage', {
      get length() {
        return data.size
      },
      key: (i: number) => [...data.keys()][i] ?? null,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    })
    return data
  }
  afterEach(() => {
    vi.unstubAllGlobals()
    setStorageOwner(null)
  })

  it('round-trips the accounts and the session', () => {
    fake()
    storeAccounts([ana])
    storeSession('a1')
    expect(loadAccounts()).toEqual([ana])
    expect(loadSession()).toBe('a1')
    storeSession(null)
    expect(loadSession()).toBeNull()
  })

  it('keeps each account\'s data under its own keys', () => {
    setStorageOwner('a1')
    const one = scopedKey('yolia-farmer')
    setStorageOwner('b2')
    const two = scopedKey('yolia-farmer')
    expect(one).not.toBe(two)
    expect(one).toContain('a1')
    setStorageOwner(null)
    expect(scopedKey('yolia-farmer')).not.toBe(one)
  })

  it('forgets one account\'s data and nobody else\'s', () => {
    setStorageOwner('a1')
    const mine = scopedKey('yolia-farmer')
    setStorageOwner('b2')
    const theirs = scopedKey('yolia-farmer')
    const data = fake({ [mine]: '1', [theirs]: '2', 'yolia-accounts': '[]' })
    forgetOwner('a1')
    expect([...data.keys()].sort()).toEqual([theirs, 'yolia-accounts'].sort())
  })
})
