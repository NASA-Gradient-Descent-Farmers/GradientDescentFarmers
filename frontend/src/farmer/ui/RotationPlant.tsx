import { useI18n } from '../../i18n/index.tsx'
import { bestOption, type RotationOption, type RotationSite } from '../../lib/rotations.ts'
import { Disclosure } from './Disclosure.tsx'
import '../../near.css'

const REGIMES = ['irrigated', 'rainfed'] as const
/** Below this a simulated harvest counts as none (the service flags campaigns under 50 kg/ha). */
const NO_HARVEST_T_HA = 0.05

/** Money to the nearest thousand: the scenarios are not precise to the peso. */
const thousand = (value: number) => Math.round(value / 1000) * 1000
const monthOf = (monthDay: string) => Number(monthDay.slice(0, 2)) - 1

function useFigures() {
  const { t, fmt } = useI18n()
  const money = (value: number | null) => (value === null ? t('whatsapp.rotations.noData') : fmt.number(thousand(value)))
  const span = (sowing: string, end: string) => `${fmt.monthShort(monthOf(sowing))}–${fmt.monthShort(monthOf(end))}`
  const income = (option: RotationOption) => {
    const low = option.gross?.p10 != null ? money(option.gross.p10) : null
    const high = option.gross?.p90 != null ? money(option.gross.p90) : null
    // a range that rounds to one figure says nothing
    const range = low !== null && high !== null && low !== high ? t('whatsapp.rotations.range', { low, high }) : ''
    return t('whatsapp.rotations.income', { amount: money(option.gross?.median ?? null), range })
  }
  return { t, fmt, span, income }
}

function OptionCard({ regime, option }: { regime: (typeof REGIMES)[number]; option: RotationOption }) {
  const { t, fmt, span, income } = useFigures()
  return (
    <article className="near-option">
      <h2>{t(`whatsapp.rotations.regime.${regime}`)}</h2>
      <p className="near-kicker">{t('near.recommended')}</p>
      <ol className="near-seasons">
        {option.campaigns.map((campaign, i) => (
          <li key={i}>
            <strong>{campaign.fallow ? t('near.fallow') : campaign.cropEs}</strong>
            <span className="muted">
              {t('near.year', { year: campaign.planningYear })} · {span(campaign.sowing, campaign.end)}
            </span>
            {!campaign.fallow && (
              <span>
                {campaign.grainTHa === null
                  ? t('whatsapp.rotations.noData')
                  : campaign.grainTHa < NO_HARVEST_T_HA
                    ? t('whatsapp.rotations.harvestNone')
                    : t('whatsapp.rotations.harvestAmount', { amount: fmt.number(campaign.grainTHa, 1) })}
              </span>
            )}
          </li>
        ))}
      </ol>
      <p>{income(option)}</p>
      {regime === 'irrigated' && option.irrigationM3Ha !== null && <p>{t('whatsapp.rotations.water', { amount: fmt.number(Math.round(option.irrigationM3Ha / 100) * 100) })}</p>}
      {option.failedHarvests > 0 && <p className="callout is-warn">{t('whatsapp.rotations.failed', { n: option.failedHarvests })}</p>}
      {option.requiresIrrigationConfirmation && <p className="callout is-warn">{t('whatsapp.rotations.confirmIrrigation')}</p>}
    </article>
  )
}

/**
 * "Qué sembrar" for a parcel close to a point the rotations service has run. The results are exploratory scenarios for
 * that zone, per hectare, so they say so first and do not use the parcel questions. Nothing here is computed: every figure
 * is the file's, rounded for display.
 */
export function RotationPlant({ site, onAsk }: { site: RotationSite; onAsk: () => void }) {
  const { t } = useI18n()
  const { rotations, name } = site
  const { income } = useFigures()
  const years = (() => {
    const first = Math.min(...rotations.weatherYears)
    const last = Math.max(...rotations.weatherYears)
    return first === last ? String(first) : `${first}–${last}`
  })()
  return (
    <div className="page">
      <h1 className="page-title">{t('farmer.plant.title')}</h1>
      <p className="page-question">{t('near.heading', { place: name })}</p>

      <p className="callout is-warn">{t('whatsapp.rotations.label', { years })}</p>
      <p className="muted">{t('near.scope', { place: name })}</p>

      {REGIMES.map((regime) => {
        const option = bestOption(rotations, regime) ?? rotations.options.find((candidate) => candidate.regime === regime)
        return option ? <OptionCard key={regime} regime={regime} option={option} /> : null
      })}

      <Disclosure title={t('near.allOptions', { n: rotations.options.length })}>
        <ul className="near-all">
          {rotations.options.map((option) => (
            <li key={option.id}>
              <strong>{t(`whatsapp.rotations.regime.${option.regime}`)}</strong>
              <span>{option.descriptionEs}</span>
              <span className="muted">{income(option)}</span>
            </li>
          ))}
        </ul>
      </Disclosure>

      <Disclosure title={t('near.confidence')}>
        <p>
          <strong>{rotations.confidence.labelEs}</strong>
        </p>
        <ul>
          {rotations.confidence.reasonsEs.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        <p>{t('whatsapp.rotations.noProbability')}</p>
      </Disclosure>

      <p className="muted">{t('whatsapp.rotations.caution', { years })}</p>
      <button type="button" className="btn secondary" onClick={onAsk}>
        {t('farmer.rec.actions.ask')}
      </button>
    </div>
  )
}
