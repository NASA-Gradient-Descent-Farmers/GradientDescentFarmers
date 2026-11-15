import { useMemo, useState, type ReactNode } from 'react'
import type { Version } from '../lib/version.ts'
import { AccountContext, type AccountApi } from './AccountContext.ts'
import { forgetOwner, setStorageOwner } from './storage.ts'
import { createAccount, loadAccounts, loadSession, newId, removeAccount, storeAccounts, storeSession, withMode, type Account } from './users.ts'

/** Which account was signed in last time, if it still exists. Also points saved data at it before anything reads it. */
function restoreSession(accounts: Account[]): string | null {
  const id = loadSession()
  const found = id !== null && accounts.some((a) => a.id === id) ? id : null
  setStorageOwner(found)
  return found
}

/**
 * Keeps the simulated accounts and who is signed in. Signing in points every saved-data module at that account's own keys
 * before the app below is drawn (the app is keyed by the account, so it starts afresh for each one).
 */
export function AccountProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>(loadAccounts)
  const [sessionId, setSessionId] = useState<string | null>(() => restoreSession(loadAccounts()))

  const api = useMemo<AccountApi>(() => {
    const enter = (id: string) => {
      setStorageOwner(id)
      storeSession(id)
      setSessionId(id)
    }
    return {
      user: accounts.find((a) => a.id === sessionId) ?? null,
      accounts,
      signIn: (id) => {
        if (accounts.some((a) => a.id === id)) enter(id)
      },
      signUp: (name: string, mode: Version) => {
        const result = createAccount(accounts, name, mode, Date.now(), newId())
        if (!result.ok) return result.reason
        storeAccounts(result.accounts)
        setAccounts(result.accounts)
        enter(result.account.id)
        return null
      },
      signOut: () => {
        setStorageOwner(null)
        storeSession(null)
        setSessionId(null)
      },
      setMode: (mode) => {
        if (!sessionId) return
        const next = withMode(accounts, sessionId, mode)
        storeAccounts(next)
        setAccounts(next)
      },
      remove: (id) => {
        const next = removeAccount(accounts, id)
        forgetOwner(id)
        storeAccounts(next)
        setAccounts(next)
        if (id === sessionId) {
          setStorageOwner(null)
          storeSession(null)
          setSessionId(null)
        }
      },
    }
  }, [accounts, sessionId])

  return <AccountContext.Provider value={api}>{children}</AccountContext.Provider>
}
