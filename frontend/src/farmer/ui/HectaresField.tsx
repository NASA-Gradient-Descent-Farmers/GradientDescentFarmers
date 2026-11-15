import { useState } from 'react'
import { useI18n } from '../../i18n/index.tsx'
import { MAX_HECTARES, validHectares } from '../state.ts'
import { MinusIcon, PlusIcon } from './glyphs.tsx'

const QUICK = [1, 2, 5, 10]

/**
 * Hectares: a big field with minus and plus, and a few common values to tap. Commas count as decimal points. An empty or
 * invalid field reports `undefined`, so what is used is always what is shown.
 */
export function HectaresField({ value, onChange, id = 'hectares' }: { value: number | undefined; onChange: (value: number | undefined) => void; id?: string }) {
  const { t } = useI18n()
  const [text, setText] = useState(value !== undefined ? String(value) : '')
  const parsed = Number(text.replace(',', '.'))
  const valid = text.trim() !== '' && validHectares(parsed)

  const set = (n: number) => {
    const clean = Math.round(n * 100) / 100
    setText(String(clean))
    onChange(validHectares(clean) ? clean : undefined)
  }
  const stepBy = (sign: 1 | -1) => {
    const current = valid ? parsed : 0
    const size = current >= 1 || (sign === 1 && current >= 0.5) ? 1 : 0.5
    set(Math.max(0.5, current + sign * size))
  }

  return (
    <div className="hectares">
      <label htmlFor={id} className="field-label">
        {t('farmer.parcel.hectares.label')}
      </label>
      <div className="stepper">
        <button type="button" className="btn secondary round" onClick={() => stepBy(-1)} aria-label={t('farmer.parcel.hectares.less')}>
          <MinusIcon />
        </button>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            const n = Number(e.target.value.replace(',', '.'))
            onChange(e.target.value.trim() !== '' && validHectares(n) ? n : undefined)
          }}
          aria-invalid={text.trim() !== '' && !valid}
          aria-describedby={`${id}-error`}
          autoComplete="off"
        />
        <button type="button" className="btn secondary round" onClick={() => stepBy(1)} aria-label={t('farmer.parcel.hectares.more')}>
          <PlusIcon />
        </button>
      </div>
      <div className="quick">
        {QUICK.map((n) => (
          <button key={n} type="button" className="chip" aria-pressed={valid && parsed === n} onClick={() => set(n)}>
            {t('farmer.parcel.hectares.quick', { n })}
          </button>
        ))}
      </div>
      <p id={`${id}-error`} className="callout is-error" role="alert" hidden={text.trim() === '' || valid}>
        {t('farmer.parcel.hectares.invalid', { max: MAX_HECTARES })}
      </p>
    </div>
  )
}
