import type { ReactNode } from 'react'

/** WhatsApp's own markup, the one part used here: *bold*. Everything else is plain text, line breaks kept. */
export function richText(text: string): ReactNode[] {
  return text.split(/(\*[^\s*](?:[^*\n]*[^\s*])?\*)/g).map((part, i) => (part.length > 2 && part.startsWith('*') && part.endsWith('*') ? <strong key={i}>{part.slice(1, -1)}</strong> : part))
}
