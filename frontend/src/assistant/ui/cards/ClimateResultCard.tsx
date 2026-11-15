import { RainBars } from '../../../components/RainBars.tsx'
import { useI18n } from '../../../i18n/index.tsx'
import type { ClimateResult } from '../../types.ts'
import { ResultCard } from '../ResultCard.tsx'

export function ClimateResultCard({ result }: { result: ClimateResult }) {
  const { t, fmt } = useI18n()
  const { here, comparison: c } = result
  const stat = (label: string, value: string, unit: string, delta: string) => (
    <div>
      <dt>{label}</dt>
      <dd>
        {value} <small>{unit}</small>
      </dd>
      <dd className="delta">{t('assistant.cards.climate.vs', { delta })}</dd>
    </div>
  )
  return (
    <ResultCard
      model="climate"
      details={
        <>
          <p>NASA POWER · PRECTOTCORR, T2M, T2M_MIN</p>
          <p>{t('assistant.cards.climate.coldNote')}</p>
        </>
      }
    >
      <h3 className="card-title">{t('assistant.cards.climate.title')}</h3>
      <dl className="stat-row">
        {stat(t('assistant.cards.climate.rain'), fmt.number(here.rainAnnualMm), 'mm', `${fmt.signed(c.rainDiffShare * 100)}%`)}
        {stat(t('assistant.cards.climate.temp'), fmt.number(here.meanTempC, 1), '°C', `${fmt.signed(c.meanTempDiffC, 1)} °C`)}
        {stat(t('assistant.cards.climate.cold'), fmt.number(here.lowestMinC, 1), '°C', `${fmt.signed(c.lowestMinDiffC, 1)} °C`)}
      </dl>
      <h5>{t('assistant.cards.climate.chart')}</h5>
      <RainBars here={here.rainMonthlyMm} reference={result.reference.rainMonthlyMm} />
    </ResultCard>
  )
}
