// What the bot remembers between a farmer's messages: the conversation state of the shared engine, and the answer
// options last offered (so "2" can be read as the second one). Kept in memory, keyed by the sender's WhatsApp number,
// and forgotten after a while idle. It is lost when the server restarts; a database comes with the deployment phase.

import type { ChatState } from '../../frontend/src/whatsapp/engine.ts'

export interface Session {
  state: ChatState
  /** The labels of the quick replies the bot last offered, in order. */
  options: string[]
  touched: number
}

const MAX_SESSIONS = 1000

export class SessionStore {
  readonly #sessions = new Map<string, Session>()
  readonly #ttlMs: number
  readonly #now: () => number

  constructor(ttlMinutes: number, now: () => number = Date.now) {
    this.#ttlMs = ttlMinutes * 60_000
    this.#now = now
  }

  /** The session of `sender`, or null if there is none or it went idle. */
  get(sender: string): Session | null {
    const session = this.#sessions.get(sender)
    if (!session) return null
    if (this.#now() - session.touched > this.#ttlMs) {
      this.#sessions.delete(sender)
      return null
    }
    return session
  }

  set(sender: string, state: ChatState, options: string[]): void {
    this.#sessions.delete(sender)
    this.#sessions.set(sender, { state, options, touched: this.#now() })
    if (this.#sessions.size > MAX_SESSIONS) {
      const oldest = this.#sessions.keys().next().value
      if (oldest !== undefined) this.#sessions.delete(oldest)
    }
  }

  get size(): number {
    return this.#sessions.size
  }
}
