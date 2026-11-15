// The simulated accounts of this phone: a name and the way the person uses YolIA (Agricultor or Técnico). There is no
// password and no server; this is only enough to tell users apart now and to be swapped for real accounts later (the
// pieces that read "who is signed in" go through useAccount, never through this storage directly).

import { isVersion, type Version } from '../lib/version.ts'

const ACCOUNTS_KEY = 'yolia-accounts'
const SESSION_KEY = 'yolia-session'

export const MAX_NAME = 40
export const MAX_ACCOUNTS = 12

export interface Account {
  id: string
  name: string
  /** How this person uses the app: the simple assistant, or the full tools. */
  mode: Version
  createdAt: number
}

/** A name as typed, tidied: extra spaces gone, no longer than MAX_NAME. */
export const cleanName = (raw: string): string => raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim()

/** The same name for comparing: no accents, no capitals ("Ángela" and "angela" are one person). */
const sameName = (name: string) => name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** The capital letter shown in the round badge. */
export const initialOf = (name: string): string => (cleanName(name).charAt(0) || '?').toUpperCase()

export type CreateResult = { ok: true; accounts: Account[]; account: Account } | { ok: false; reason: 'empty' | 'taken' | 'full' }

/** Add an account, or say why not: no name, a name already on this phone, or too many accounts. */
export function createAccount(accounts: Account[], rawName: string, mode: Version, now: number, id: string): CreateResult {
  const name = cleanName(rawName)
  if (name === '') return { ok: false, reason: 'empty' }
  if (accounts.some((a) => sameName(a.name) === sameName(name))) return { ok: false, reason: 'taken' }
  if (accounts.length >= MAX_ACCOUNTS) return { ok: false, reason: 'full' }
  const account: Account = { id, name, mode, createdAt: now }
  return { ok: true, accounts: [...accounts, account], account }
}

export const removeAccount = (accounts: Account[], id: string): Account[] => accounts.filter((a) => a.id !== id)

export const withMode = (accounts: Account[], id: string, mode: Version): Account[] => accounts.map((a) => (a.id === id ? { ...a, mode } : a))

/** A new account's id. */
export function newId(): string {
  const random = globalThis.crypto?.randomUUID?.()
  return random ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Accounts from stored text; anything that does not check out is dropped, never trusted. */
export function parseAccounts(text: string | null): Account[] {
  if (!text) return []
  try {
    const raw = JSON.parse(text) as unknown
    if (!Array.isArray(raw)) return []
    const seen = new Set<string>()
    const accounts: Account[] = []
    for (const item of raw) {
      const a = item as Partial<Account> | null
      if (!a || typeof a.id !== 'string' || a.id === '' || a.id.includes(':') || seen.has(a.id)) continue
      if (typeof a.name !== 'string' || cleanName(a.name) === '' || !isVersion(a.mode)) continue
      seen.add(a.id)
      accounts.push({ id: a.id, name: cleanName(a.name), mode: a.mode, createdAt: typeof a.createdAt === 'number' && Number.isFinite(a.createdAt) ? a.createdAt : 0 })
      if (accounts.length >= MAX_ACCOUNTS) break
    }
    return accounts
  } catch {
    return []
  }
}

export function loadAccounts(): Account[] {
  try {
    return parseAccounts(localStorage.getItem(ACCOUNTS_KEY))
  } catch {
    return []
  }
}

export function storeAccounts(accounts: Account[]): void {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts))
  } catch {
    // storage blocked or full: the accounts last for this visit only
  }
}

/** The account that was signed in when the page was last open (kept so a reload does not sign anyone out). */
export function loadSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY) || null
  } catch {
    return null
  }
}

export function storeSession(id: string | null): void {
  try {
    if (id) localStorage.setItem(SESSION_KEY, id)
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // not remembered: the next visit starts signed out
  }
}
