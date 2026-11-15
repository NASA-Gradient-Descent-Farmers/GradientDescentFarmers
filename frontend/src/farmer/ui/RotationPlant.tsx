import type { ReactNode } from 'react'
import { useI18n } from '../../i18n/index.tsx'
import type { Rotations } from '../../lib/rotations.ts'
import { bestOption, pickForGoal, type RotationGoal, type RotationOption } from '../../lib/rotations.ts'
import type { Situation } from '../state.ts'
import type { Zone } from '../../lib/environment.ts'
import { DataTable } from './DataTable.tsx'
import { Disclosure } from './Disclosure.tsx'
import { EnvironmentPanel } from './EnvironmentPanel.tsx'
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

function OptionCard({ regime, option, goal, hectares }: { regime: (typeof REGIMES)[number]; option: RotationOption; goal: RotationGoal | null; hectares: number | null }) {
  const { t, fmt, span, income } = useFigures()
  const total = hectares !== null && option.gross?.median != null ? Math.round((option.gross.median * hectares) / 1000) * 1000 : null
  return (
    <article className="near-option">
      <h2>{t(`whatsapp.rotations.regime.${regime}`)}</h2>
      <p className="near-kicker">{goal ? t('near.forGoal', { goal: t(`farmer.rec.goals.${goal}`) }) : t('near.recommended')}</p>
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
      {total !== null && hectares !== null && <p>{t('near.forHectares', { ha: fmt.number(hectares, Number.isInteger(hectares) ? 0 : 1), total: fmt.number(total, 0) })}</p>}
      {regime === 'irrigated' && option.irrigationM3Ha !== null && <p>{t('whatsapp.rotations.water', { amount: fmt.number(Math.round(option.irrigationM3Ha / 100) * 100) })}</p>}
      {option.failedHarvests > 0 && <p className="callout is-warn">{t('whatsapp.rotations.failed', { n: option.failedHarvests })}</p>}
      {option.requiresIrrigationConfirmation && <p className="callout is-warn">{t('whatsapp.rotations.confirmIrrigation')}</p>}
    </article>
  )
}

/** How the run was set up and what it used: the settings, the soil model, the prices, and what was discarded. */
function RunDetails({ rotations }: { rotations: Rotations }) {
  const { t, fmt } = useI18n()
  const details = rotations.details
  if (!details) return null
  const crop = (key: string) => {
    const text = t(`env.crop.${key}`)
    return text === `env.crop.${key}` ? key : text
  }
  const settings = details.runSettings
  const soil = details.soilModel
  const years = [...new Set(details.prices.map((row) => row.year))].sort((a, b) => a - b)
  const groups = [...new Set(details.prices.map((row) => `${row.crop}|${row.regime}`))]
  const price = (key: string, year: number) => details.prices.find((row) => `${row.crop}|${row.regime}` === key && row.year === year)?.mxnPerT ?? null
  const fraction = (value: number | undefined) => (value === undefined ? '—' : fmt.number(value, 2))
  return (
    <Disclosure title={t('env.run.title')}>
      {settings && (
        <p>
          {t('env.run.settings', {
            crops: settings.crops.map(crop).join(', '),
            years: settings.horizonYears,
            efficiency: fmt.number(settings.irrigationEfficiency, 2),
            depth: fmt.number(settings.rootableDepthCm, 0),
            water: fmt.number(settings.initialAvailableWaterFraction * 100, 0),
          })}
        </p>
      )}
      {soil && (
        <>
          <p>{t('env.run.soil', { method: soil.method, fc: fraction(soil.parameters.SMFCF), wp: fraction(soil.parameters.SMW), sat: fraction(soil.parameters.SM0) })}</p>
          <h3>{t('env.run.soilAssumptions')}</h3>
          <ul>
            {soil.assumptions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
      {details.cropVarieties && <p>{t('env.run.varieties', { list: Object.entries(details.cropVarieties.varieties).map(([key, name]) => `${crop(key)} (${name})`).join(', ') })}</p>}
      {groups.length > 0 && (
        <>
          <h3>{t('env.run.prices')}</h3>
          <DataTable
            head={[t('env.run.pricesCrop'), ...years.map(String)]}
            rows={groups.map((key) => {
              const [name, regime] = key.split('|')
              return [`${crop(name)} (${t(`env.run.regime.${regime}`)})`, ...years.map((year) => (price(key, year) === null ? '—' : fmt.number(price(key, year)!, 0)))]
            })}
          />
          <p className="muted">{t('env.run.priceNote')}</p>
        </>
      )}
      {details.rejected && <p>{t('env.run.rejected', { n: details.rejected.optimizationRejected.length, fail: details.rejected.modelFailures })}</p>}
    </Disclosure>
  )
}

/**
 * "Qué sembrar" for a parcel close to a point the rotations service has run. The results are exploratory scenarios for
 * that zone, per hectare, so they say so first and do not use the parcel questions. Nothing here is computed: every figure
 * is the file's, rounded for display.
 */
export function RotationPlant({ zone, rotations, situation, notice, onAsk }: { zone: Zone; rotations: Rotations; situation?: Situation; notice?: ReactNode; onAsk: () => void }) {
  const { t } = useI18n()
  const { name } = zone
  const { income } = useFigures()
  const goal = situation?.goal ?? null
  const hectares = situation?.hectares ?? null
  // the regime the farmer says they have comes first; both are always shown
  const order: (typeof REGIMES)[number][] = situation?.water === 'rain' ? ['rainfed', 'irrigated'] : ['irrigated', 'rainfed']
  const years = (() => {
    const first = Math.min(...rotations.weatherYears)
    const last = Math.max(...rotations.weatherYears)
    return first === last ? String(first) : `${first}–${last}`
  })()
  return (
    <div className="page">
      <h1 className="page-title">{t('farmer.plant.title')}</h1>
      <p className="page-question">{t('near.heading', { place: name })}</p>
      {notice}

      <p className="callout is-warn">{t('whatsapp.rotations.label', { years })}</p>
      <p className="muted">{t('near.scope', { place: name })}</p>

      {order.map((regime) => {
        const option = (goal ? pickForGoal(rotations, regime, goal) : bestOption(rotations, regime)) ?? rotations.options.find((candidate) => candidate.regime === regime)
        return option ? <OptionCard key={regime} regime={regime} option={option} goal={goal} hectares={hectares} /> : null
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

      <RunDetails rotations={rotations} />

      <p className="muted">{t('whatsapp.rotations.caution', { years })}</p>

      <EnvironmentPanel zone={zone} />

      <button type="button" className="btn secondary" onClick={onAsk}>
        {t('farmer.rec.actions.ask')}
      </button>
    </div>
  )
}
