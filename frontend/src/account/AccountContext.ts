import { createContext, useContext } from 'react'
import type { Version } from '../lib/version.ts'
import type { Account, CreateResult } from './users.ts'

export interface AccountApi {
  /** Who is signed in, or null. */
  user: Account | null
  /** Every account on this phone. */
  accounts: Account[]
  signIn: (id: string) => void
  /** Create an account and sign in to it; returns why not when it cannot be created. */
  signUp: (name: string, mode: Version) => Extract<CreateResult, { ok: false }>['reason'] | null
  signOut: () => void
  /** Change how the signed-in person uses the app. */
  setMode: (mode: Version) => void
  /** Delete an account and everything saved for it. */
  remove: (id: string) => void
}

export const AccountContext = createContext<AccountApi | null>(null)

export function useAccount(): AccountApi {
  const api = useContext(AccountContext)
  if (!api) throw new Error('useAccount must be used inside an AccountProvider')
  return api
}
