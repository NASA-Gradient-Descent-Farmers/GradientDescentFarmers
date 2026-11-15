// Conversations: kept only in this browser (localStorage), trimmed so they always fit, and safe to lose.

import type { SummaryItem } from './compose.ts'
import type { Interpretation, ModelId, Outcome, Progress, Settings } from './types.ts'
import { scopedKey } from '../account/storage.ts'

export interface UserMessage {
  id: string
  role: 'user'
  text: string
  at: number
}

export interface AssistantMessage {
  id: string
  role: 'assistant'
  at: number
  /** `interrupted`: the page was closed or reloaded while the models were working. */
  status: 'running' | 'done' | 'interrupted'
  interpretation: Interpretation
  progress: Partial<Record<ModelId, Progress>>
  outcomes: Outcome[]
  /** A summary written by a language model backend, when one is connected; otherwise the template summary is drawn. */
  narration?: { by: string; items: SummaryItem[] }
}

export type Message = UserMessage | AssistantMessage

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: Message[]
}

export interface Stored {
  version: 1
  activeId: string | null
  conversations: Conversation[]
  settings: Settings | null
}

export const STORAGE_KEY = 'campo-verde-chats'
export const MAX_CONVERSATIONS = 20
export const MAX_MESSAGES = 40
const TITLE_LENGTH = 48

export const emptyStored = (): Stored => ({ version: 1, activeId: null, conversations: [], settings: null })

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/** A conversation's title: the first question, trimmed. */
export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > TITLE_LENGTH ? `${clean.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : clean
}

export function newConversation(now = Date.now()): Conversation {
  return { id: newId(), title: '', createdAt: now, updatedAt: now, messages: [] }
}

/** Add a question and the (still running) answer to it; the first question names the conversation. */
export function addTurn(conversation: Conversation, user: UserMessage, assistant: AssistantMessage): Conversation {
  const messages = [...conversation.messages, user, assistant].slice(-MAX_MESSAGES)
  return { ...conversation, title: conversation.title || titleFrom(user.text), updatedAt: assistant.at, messages }
}

export function updateAssistant(conversation: Conversation, id: string, change: (message: AssistantMessage) => AssistantMessage): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map((m) => (m.role === 'assistant' && m.id === id ? change(m) : m)),
  }
}

/** Put a conversation first in the list (most recent), replacing its older version, within the cap. */
export function upsertConversation(list: Conversation[], conversation: Conversation): Conversation[] {
  return [conversation, ...list.filter((c) => c.id !== conversation.id)].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS)
}

export const removeConversation = (list: Conversation[], id: string) => list.filter((c) => c.id !== id)

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function validMessage(value: unknown): Message | null {
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.at !== 'number') return null
  if (value.role === 'user') return typeof value.text === 'string' ? (value as unknown as UserMessage) : null
  if (value.role !== 'assistant' || !isObject(value.interpretation) || !Array.isArray(value.outcomes)) return null
  const message = value as unknown as AssistantMessage
  // Work that was under way when the page went away will not finish on its own.
  return message.status === 'running' ? { ...message, status: 'interrupted' } : message
}

/** Stored conversations from text, dropping anything malformed instead of failing; empty if the text is unusable. */
export function parseStored(text: string | null): Stored {
  if (!text) return emptyStored()
  try {
    const raw: unknown = JSON.parse(text)
    if (!isObject(raw) || raw.version !== 1 || !Array.isArray(raw.conversations)) return emptyStored()
    const conversations: Conversation[] = []
    for (const c of raw.conversations) {
      if (!isObject(c) || typeof c.id !== 'string' || typeof c.title !== 'string' || !Array.isArray(c.messages)) continue
      const messages = c.messages.map(validMessage).filter((m): m is Message => m !== null)
      conversations.push({ id: c.id, title: c.title, createdAt: Number(c.createdAt) || 0, updatedAt: Number(c.updatedAt) || 0, messages })
    }
    const activeId = typeof raw.activeId === 'string' && conversations.some((c) => c.id === raw.activeId) ? raw.activeId : null
    const settings = isObject(raw.settings) && isObject(raw.settings.economics) ? (raw.settings as unknown as Settings) : null
    return { version: 1, activeId, conversations, settings }
  } catch {
    return emptyStored()
  }
}

export function loadStored(): Stored {
  try {
    return parseStored(localStorage.getItem(scopedKey(STORAGE_KEY)))
  } catch {
    return emptyStored()
  }
}

/**
 * Save, making room if the browser's quota is reached by dropping the oldest conversation until it fits.
 * Returns false only if nothing could be saved (storage blocked); the app keeps working either way.
 */
export function saveStored(stored: Stored): boolean {
  let conversations = stored.conversations
  for (;;) {
    try {
      localStorage.setItem(scopedKey(STORAGE_KEY), JSON.stringify({ ...stored, conversations }))
      return true
    } catch {
      if (conversations.length <= 1) return false
      conversations = conversations.slice(0, -1) // the list is most recent first
    }
  }
}
