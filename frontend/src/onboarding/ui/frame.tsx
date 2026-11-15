import { useEffect, useRef, type ReactNode } from 'react'
import { useI18n } from '../../i18n/index.tsx'
import type { Position } from './hooks.ts'

interface FrameProps {
  position: Position
  title: string
  help?: ReactNode
  /** The control(s) that answer the question. */
  children: ReactNode
  /** A focused follow-up or a validation message, shown under the control. */
  notice?: ReactNode
  onSubmit: () => void
  submitDisabled?: boolean
  /** "I don't know yet": a quiet way to move on from a question that is optional. */
  skip?: { label: string; onSkip: () => void }
  /** Wider than a text column: the map question. */
  wide?: boolean
}

/** One question on its own screen: progress, a prominent question, its control and a clear Continue. */
export function StepFrame({ position, title, help, children, notice, onSubmit, submitDisabled, skip, wide }: FrameProps) {
  const { t } = useI18n()
  const heading = useRef<HTMLHeadingElement>(null)
  // A new question takes the focus, so a keyboard or screen-reader user lands on it instead of on the old one.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [])
  return (
    <form
      className={`ob-card${wide ? ' wide' : ''}`}
      noValidate
      aria-labelledby="ob-title"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <p className="ob-eyebrow">{position.editing ? t('onboarding.editing') : t('onboarding.progress', { n: position.number, total: position.total })}</p>
      <h1 id="ob-title" className="ob-title" tabIndex={-1} ref={heading}>
        {title}
      </h1>
      {help && <p className="ob-help">{help}</p>}
      <div className="ob-body">{children}</div>
      <div className="ob-notice" aria-live="polite">
        {notice}
      </div>
      <div className="ob-actions">
        <button type="button" className="ob-back" onClick={position.onBack}>
          ← {position.editing ? t('onboarding.cancel') : t('onboarding.back')}
        </button>
        {skip && (
          <button type="button" className="ob-skip" onClick={skip.onSkip}>
            {skip.label}
          </button>
        )}
        <button type="submit" className="cv-button ob-next" disabled={submitDisabled}>
          {position.editing ? t('onboarding.save') : t('onboarding.continue')}
        </button>
      </div>
    </form>
  )
}

export interface Option {
  id: string
  label: string
  hint?: string
  /** A short flag next to the label, e.g. that the models do not cover this. */
  tag?: string
}

interface ChoiceProps {
  name: string
  legend: string
  type: 'radio' | 'checkbox'
  options: Option[]
  value: string[]
  onChange: (next: string[]) => void
  /** `chips`: short answers in a row; `cards`: longer ones, one per line. */
  variant?: 'chips' | 'cards'
  hideLegend?: boolean
}

/** A group of answers as native radios or checkboxes: arrow keys, space and the screen reader all work as usual. */
export function Choice({ name, legend, type, options, value, onChange, variant = 'chips', hideLegend }: ChoiceProps) {
  return (
    <fieldset className={`ob-choice ${variant}`}>
      <legend className={hideLegend ? 'sr-only' : 'ob-legend'}>{legend}</legend>
      <div className="ob-options">
        {options.map((option) => {
          const checked = value.includes(option.id)
          return (
            <label key={option.id} className="ob-option">
              <input
                type={type}
                name={name}
                value={option.id}
                checked={checked}
                onChange={() => onChange(type === 'radio' ? [option.id] : checked ? value.filter((id) => id !== option.id) : [...value, option.id])}
              />
              <span className="ob-face">
                <span className="ob-label">
                  {option.label}
                  {option.tag && <em className="ob-tag">{option.tag}</em>}
                </span>
                {option.hint && <small>{option.hint}</small>}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
