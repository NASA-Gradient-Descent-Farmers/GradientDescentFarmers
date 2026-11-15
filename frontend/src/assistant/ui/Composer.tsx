import { useEffect, useRef, type KeyboardEvent } from 'react'
import { useI18n } from '../../i18n/index.tsx'
import type { ModelId } from '../types.ts'

interface Props {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  busy: boolean
  /** Models picked by hand, or null when they are chosen from the question. */
  manualModels: ModelId[] | null
}

/** The question box. What is typed stays until the question has been accepted, so nothing is lost if sending is blocked. */
export function Composer({ value, onChange, onSend, busy, manualNone, manualModels }: Props & { manualNone: boolean }) {
  const { t } = useI18n()
  const box = useRef<HTMLTextAreaElement>(null)

  // Grow with the text, up to a few lines.
  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`
  }, [value])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter is a new line; never send while an input method is composing a character.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (!busy) onSend()
    }
  }

  const using = manualModels
    ? t('assistant.composer.usingManual', { models: manualModels.map((m) => t(`assistant.models.${m}.name`).replace(/ \(.*\)$/, '')).join(', ') })
    : t('assistant.composer.usingAuto')

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault()
        if (!busy) onSend()
      }}
    >
      <label htmlFor="assistant-input" className="sr-only">
        {t('assistant.composer.label')}
      </label>
      <textarea
        id="assistant-input"
        ref={box}
        rows={1}
        value={value}
        placeholder={t('assistant.composer.placeholder')}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        aria-describedby="assistant-hint"
      />
      <button type="submit" className="send" disabled={busy || value.trim() === ''}>
        {busy ? t('assistant.composer.sending') : t('assistant.composer.send')}
      </button>
      <p id="assistant-hint" className="composer-hint">
        <span>{t('assistant.composer.hint')}</span>
        <span className={manualNone ? 'problem' : undefined} role={manualNone ? 'alert' : undefined}>
          {manualNone ? t('assistant.composer.manualNone') : using}
        </span>
      </p>
    </form>
  )
}
