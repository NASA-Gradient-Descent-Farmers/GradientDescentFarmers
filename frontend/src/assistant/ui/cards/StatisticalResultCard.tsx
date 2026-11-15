import { useI18n } from '../../../i18n/index.tsx'
import { capitalize } from '../../../lib/format.ts'
import type { StatRow } from '../../../lib/precomputed.ts'
import type { StatisticalResult } from '../../types.ts'
import { ResultCard, Sources } from '../ResultCard.tsx'

export function StatisticalResultCard({ result, sources }: { result: StatisticalResult; sources: { file: string; sha256: string }[] }) {
  const { t, fmt } = useI18n()

  const table = (title: string, rows: StatRow[], span: [number, number], baseline?: string) => {
    const models = [...new Set(rows.map((r) => r.model))]
    const holdoutOf = (model: string) => rows.find((r) => r.model === model && r.split === 'holdout')
    const cvOf = (model: string) => rows.find((r) => r.model === model && r.split === 'cv_pooled')
    models.sort((a, b) => (holdoutOf(a)?.rmse ?? 0) - (holdoutOf(b)?.rmse ?? 0))
    return (
      <div className="table-scroll">
        <table className="plain">
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">{t('assistant.cards.statistical.model')}</th>
              <th scope="col" className="num">{t('assistant.cards.statistical.holdout', { from: span[0], to: span[1] })}: {t('assistant.cards.statistical.error')}</th>
              <th scope="col" className="num">R²</th>
              <th scope="col" className="num">{t('assistant.cards.statistical.cv')}: {t('assistant.cards.statistical.error')}</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <tr key={model} className={model === baseline ? 'current' : undefined}>
                <th scope="row">{capitalize(t(`assistant.statModels.${model}`))}</th>
                <td className="num">{fmt.number(holdoutOf(model)?.rmse ?? NaN, 2)}</td>
                <td className="num">{fmt.number(holdoutOf(model)?.r2 ?? NaN, 2)}</td>
                <td className="num">{fmt.number(cvOf(model)?.rmse ?? NaN, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <ResultCard
      model="statistical"
      details={
        <>
          {table(t('assistant.cards.statistical.emulationTitle'), result.emulation.rows, result.emulation.holdoutYears)}
          <p>{result.observed.features.join(', ')}</p>
          <Sources files={sources} />
        </>
      }
    >
      <h3 className="card-title">{t('assistant.cards.statistical.title')}</h3>
      {table(t('assistant.cards.statistical.observedTitle'), result.observed.rows, result.observed.holdoutYears, result.baseline.model)}
      <p className="card-note">{t('assistant.cards.statistical.note')}</p>
    </ResultCard>
  )
}
