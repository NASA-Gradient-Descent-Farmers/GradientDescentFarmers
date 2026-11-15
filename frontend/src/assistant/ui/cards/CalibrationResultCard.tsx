import { useI18n } from '../../../i18n/index.tsx'
import type { CalibrationResult } from '../../types.ts'
import { ResultCard, Sources } from '../ResultCard.tsx'

const LABELS = ['calibrated', 'climatology', 'persistence'] as const
const CROPS = ['maize', 'barley', 'fababean']

export function CalibrationResultCard({ result, sources }: { result: CalibrationResult; sources: { file: string; sha256: string }[] }) {
  const { t, fmt } = useI18n()
  const holdout = result.rows.filter((r) => r.split === 'holdout')
  const fit = result.rows.filter((r) => r.split === 'calibration')

  const table = (rows: typeof holdout, caption: string) => (
    <div className="table-scroll">
      <table className="plain">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{t('assistant.cards.calibration.crop')}</th>
            <th scope="col">{t('assistant.cards.calibration.model')}</th>
            <th scope="col" className="num">{t('assistant.cards.calibration.simulated')}</th>
            <th scope="col" className="num">{t('assistant.cards.calibration.observed')}</th>
            <th scope="col" className="num">{t('assistant.cards.calibration.rmse')}</th>
            <th scope="col" className="num">{t('assistant.cards.calibration.correlation')}</th>
            <th scope="col" className="num">{t('assistant.cards.calibration.skill')}</th>
          </tr>
        </thead>
        <tbody>
          {CROPS.flatMap((crop) =>
            LABELS.map((label) => {
              const row = rows.find((r) => r.crop === crop && r.label === label)
              if (!row) return null
              return (
                <tr key={`${crop}${label}`} className={label === 'calibrated' ? 'current' : undefined}>
                  <th scope="row">{label === 'calibrated' ? t(`crops.${crop}`) : ''}</th>
                  <td>{t(`assistant.cards.calibration.${label}`)}</td>
                  <td className="num">{fmt.number(row.simulatedMean, 2)}</td>
                  <td className="num">{fmt.number(row.observedMean, 2)}</td>
                  <td className="num">{fmt.number(row.rmse, 2)}</td>
                  <td className="num">{row.correlation === null ? '–' : fmt.number(row.correlation, 2)}</td>
                  <td className="num">{label === 'climatology' ? '0' : fmt.signed(row.skill, 2)}</td>
                </tr>
              )
            }),
          )}
        </tbody>
      </table>
    </div>
  )

  return (
    <ResultCard
      model="calibration"
      details={
        <>
          {table(fit, t('assistant.cards.calibration.fit', { from: result.fitYears[0], to: result.fitYears[1] }))}
          <p>{t('assistant.details.knobs', { knobs: Object.entries(result.knobs).map(([crop, k]) => `${crop}: ${Object.entries(k).map(([n, v]) => `${n} ${v}`).join(', ')}`).join(' · ') })}</p>
          <Sources files={sources} />
        </>
      }
    >
      <h3 className="card-title">{t('assistant.cards.calibration.title')}</h3>
      <dl className="stat-row">
        <div>
          <dt>{t('planner.world.default.name')}</dt>
          <dd>{fmt.number(result.maizeLevels.standard, 1)} <small>t/ha</small></dd>
        </div>
        <div>
          <dt>{t('planner.world.calibrated.name')}</dt>
          <dd>{fmt.number(result.maizeLevels.calibrated, 1)} <small>t/ha</small></dd>
        </div>
        <div>
          <dt>SIAP</dt>
          <dd>{fmt.number(result.maizeLevels.observed, 1)} <small>t/ha</small></dd>
        </div>
      </dl>
      {table(holdout, t('assistant.cards.calibration.holdout', { from: result.holdoutYears[0], to: result.holdoutYears[1] }))}
      <p className="card-note">{t('assistant.cards.calibration.skillNote')}</p>
      <p className="card-note">{t('assistant.cards.calibration.trial', { pct: fmt.number(result.trial.unfertilizedOverFertilized * 100) })}</p>
    </ResultCard>
  )
}

