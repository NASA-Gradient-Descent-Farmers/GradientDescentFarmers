// One exchange as the chat shows it: the farmer's message is already on screen; here the bot "types", then its bubbles
// arrive one by one. Kept apart from React so the sequence (and a reset in the middle of it) can be tested.

import { reply, type BotBubble, type ChatState, type Env } from './engine.ts'

export interface Hooks {
  typing: (on: boolean) => void
  show: (bubble: BotBubble) => void
  wait: (ms: number) => Promise<void>
  /** False once the conversation was reset: whatever is still being worked out is dropped. */
  alive: () => boolean
}

/** The pause before each bubble, long enough to read as someone typing and short enough for a live demo. */
export const TYPING_MS = 900

export async function converse(text: string, state: ChatState, env: Env, hooks: Hooks, typingMs = TYPING_MS): Promise<ChatState> {
  hooks.typing(true)
  try {
    const [turn] = await Promise.all([reply(text, state, env), hooks.wait(typingMs)])
    if (!hooks.alive()) return state
    for (const [index, bubble] of turn.bubbles.entries()) {
      if (index > 0) {
        hooks.typing(true)
        await hooks.wait(Math.round(typingMs * 0.7))
        if (!hooks.alive()) return state
      }
      hooks.show(bubble)
    }
    return turn.state
  } finally {
    hooks.typing(false)
  }
}
