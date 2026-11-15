// Everything a person saves in YolIA (their parcel, answers, conversations, pin) is kept under keys that carry their
// account's id, so several people can use one phone without seeing each other's data. The modules that save things ask
// `scopedKey` for the real key at the moment they read or write; the signed-in account is set once, at sign-in.
//
// This is a simulation of accounts: it separates data on this device and nothing more. There is no server and no password.

const PREFIX = 'yolia:'
const GUEST = 'guest'

let owner: string | null = null

/** Who the saved data belongs to from now on (null when nobody is signed in). */
export function setStorageOwner(id: string | null): void {
  owner = id
}

/** The key to use in storage for `key`, inside the signed-in account's own space. */
export const scopedKey = (key: string): string => `${PREFIX}${owner ?? GUEST}:${key}`

/** Delete everything saved for an account (used when the account is removed). */
export function forgetOwner(id: string): void {
  try {
    const prefix = `${PREFIX}${id}:`
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(prefix)) doomed.push(key)
    }
    for (const key of doomed) localStorage.removeItem(key)
  } catch {
    // storage blocked: nothing was saved to delete
  }
}
