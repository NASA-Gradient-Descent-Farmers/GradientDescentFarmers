import type { ReactNode } from 'react'
import { ChevronIcon } from './glyphs.tsx'

/** An expandable explanation: native <details>, so it works with the keyboard and screen readers and needs no script. */
export function Disclosure({ title, children, defaultOpen = false }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="disclosure" open={defaultOpen}>
      <summary>
        <span>{title}</span>
        <ChevronIcon />
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  )
}
