import { useI18n } from '../../../i18n/index.tsx'
import { capitalize } from '../../../lib/format.ts'
import { riskRow } from '../../compose.ts'
import type { RiskResult } from '../../types.ts'
import { ResultCard } from '../ResultCard.tsx'

const ROTATION_ORDER = ['maize', 'maize-barley', 'maize-fababean', 'maize-barley-fababean']

export function RiskResultCard({ result }: { result: RiskResult }) {
  const { t, fmt } = useI18n()
  const scenarios = ['baseline', ...result.scenarios.filter((s) => s !== 'baseline')]
  const rotations = ROTATION_ORDER.filter((r) => result.rows.some((row) => row.rotation === r))
  const ref = result.referenceRotation

  return (
    <ResultCard
      model="risk"
      details={
        <>
          <p>{t('assistant.details.settingsRisk', { draws: fmt.number(result.settings.draws), harvests: result.settings.harvests, seed: result.settings.seed })}</p>
          <p>{t('assistant.details.method', { method: result.method })}</p>
          <table className="plain">
            <thead>
              <tr>
                <th scope="col">{t('assistant.cards.risk.scenario')}</th>
                <th scope="col">{t('assistant.cards.risk.rotation')}</th>
                <th scope="col" className="num">{t('assistant.cards.risk.advantage')}</th>
                <th scope="col">{t('assistant.cards.risk.interval')}</th>
              </tr>
            </thead>
            <tbody>
              {result.rows
                .filter((row) => row.rotation !== ref)
                .map((row) => (
                  <tr key={`${row.scenario}${row.rotation}`}>
                    <th scope="row">{capitalize(t(`assistant.scenarios.${row.scenario}`))}</th>
                    <td>{t(`rotations.${row.rotation}`)}</td>
                    <td className="num">{fmt.signed(row.advantage, 2)}</td>
                    <td>
                      {fmt.signed(row.ciLow, 2)} … {fmt.signed(row.ciHigh, 2)}
                      {row.ciLow <= 0 && row.ciHigh >= 0 ? ` (${t('assistant.cards.risk.unclear')})` : ''}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      }
    >
      <h3 className="card-title">{t('assistant.cards.risk.title')}</h3>
      <p className="card-note first">{t('assistant.cards.risk.lede')}</p>
      <div className="table-scroll">
        <table className="plain matrix">
          <caption className="sr-only">{t('assistant.cards.risk.yield')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('assistant.cards.risk.scenario')}</th>
              {rotations.map((r) => (
                <th scope="col" key={r} className="num">
                  {t(`rotations.${r}`)}
                  {r === ref ? <small> ({t('assistant.cards.risk.reference')})</small> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scenarios.map((scenario) => (
              <tr key={scenario}>
                <th scope="row">{capitalize(t(`assistant.scenarios.${scenario}`))}</th>
                {rotations.map((rotation) => {
                  const row = riskRow(result, scenario, rotation)
                  return (
                    <td key={rotation} className="num">
                      {row ? (
                        <>
                          {fmt.number(row.meanYield, 1)}
                          <small className="sub">{fmt.percent(row.failedHarvestFraction)}</small>
                        </>
                      ) : (
                        '–'
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="card-note">
        {t('assistant.cards.risk.yield')} · {t('assistant.cards.risk.failed')}:{' '}
        {t('assistant.cards.risk.failedNote', { threshold: result.settings.failureThresholdTHa, harvests: result.settings.harvests })}
      </p>
    </ResultCard>
  )
}
