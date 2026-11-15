import type { ReactNode } from 'react'
import { CheckIcon } from './glyphs.tsx'

export interface Option<T extends string> {
  value: T
  label: string
  hint?: string
  icon?: ReactNode
}

/** Large, labelled answer buttons: one is selected at a time, shown by a tick and an outline as well as colour. */
export function BigChoice<T extends string>({ options, value, onChange, label }: { options: Option<T>[]; value: T | undefined; onChange: (value: T) => void; label: string }) {
  return (
    <div className="choices" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" className="choice" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.icon && <span className="choice-icon">{option.icon}</span>}
          <span className="choice-text">
            <span className="choice-label">{option.label}</span>
            {option.hint && <span className="choice-hint">{option.hint}</span>}
          </span>
          <span className="choice-check" aria-hidden="true">
            {value === option.value && <CheckIcon />}
          </span>
        </button>
      ))}
    </div>
  )
}
