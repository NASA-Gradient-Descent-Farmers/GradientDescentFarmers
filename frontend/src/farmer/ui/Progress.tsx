import { useI18n } from '../../i18n/index.tsx'

/** "Paso 2 de 5" with a bar: the farmer always knows how much is left. */
export function Progress({ n, total }: { n: number; total: number }) {
  const { t } = useI18n()
  const label = t('farmer.common.step', { n, total })
  return (
    <div className="progress-wrap">
      <p className="progress-label">{label}</p>
      <div className="progress" role="progressbar" aria-label={label} aria-valuemin={1} aria-valuemax={total} aria-valuenow={n}>
        <span style={{ width: `${(n / total) * 100}%` }} />
      </div>
    </div>
  )
}
