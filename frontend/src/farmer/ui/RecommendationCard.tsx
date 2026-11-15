import type { ReactNode } from 'react'
import type { StrategyView } from '../../assistant/types.ts'
import { useI18n } from '../../i18n/index.tsx'
import type { Precomputed } from '../../lib/precomputed.ts'
import type { Meta } from '../../lib/types.ts'
import { evidenceFor, yearsText } from '../evidence.ts'
import { confidenceOf, DRY_SCENARIOS, nextCrop, roundMoney, type Recommendation } from '../recommend.ts'
import { Disclosure } from './Disclosure.tsx'
import { WarnIcon } from './glyphs.tsx'
import { Tag } from './Tag.tsx'

interface Props {
  rec: Recommendation
  meta: Meta
  models: Precomputed
  /** Buttons under the card (save, ask, change answers). */
  actions?: ReactNode
  /** Heading level of the crop name, so the card fits under the page's own headings. */
  level?: 2 | 3
  /** "brief": the conclusion, one figure, the main risk and how sure it is; the rest sits behind "Ver todos los detalles". */
  variant?: 'full' | 'brief'
}

const same = (a: StrategyView, b: StrategyView) => a.rotation === b.rotation && a.nScale === b.nScale && a.retention === b.retention

/**
 * The answer, drawn so the main conclusion reads in seconds: what to plant, then what it might bring, what could go wrong
 * and how far to trust it. Every figure is the planner's, rounded, and marked as an estimate; the longer explanations
 * are folded away. Nothing is coloured to look surer than it is: the reliability is always written, and never above "low".
 */
export function RecommendationCard({ rec, meta, models, actions, level = 2, variant = 'full' }: Props) {
  const { t, fmt, distance } = useI18n()
  const Heading = level === 2 ? 'h2' : 'h3'
  const { result, situation, zone } = rec
  const pick = result.strategy
  const crops = [...new Set(meta.rotations[pick.rotation])]
  const cropName = (crop: string) => t(`crops.${crop}`)
  const next = nextCrop(pick.rotation, situation.previous, meta)
  const knownPrevious = situation.previous && situation.previous !== 'other' && situation.previous !== 'none'
  const ha = situation.hectares
  const haText = ha === undefined ? '' : Number.isInteger(ha) ? fmt.number(ha) : fmt.number(ha, 1)
  const money = (value: number) => fmt.number(roundMoney(value))
  /** A sum in words: "≈ 5,900 pesos", or, when the model works out a loss, "a loss of ≈ 4,200 pesos" (a minus sign alone is easy to miss). */
  const moneyLine = (value: number, gain: string, loss: string) => (roundMoney(value) < 0 ? t(loss, { n: money(-value) }) : t(gain, { n: money(value) }))
  const confidence = confidenceOf(zone)
  const evidence = evidenceFor(models)
  const km = distance(zone.km)
  const withFertilizer = crops.filter((crop) => (pick.doses[crop] ?? 0) > 0)

  // risk rows: the share of maize harvests that fail, with normal rain and with little
  const riskRows = rec.risk?.rows ?? []
  const failed = (scenario: string) => riskRows.find((row) => row.scenario === scenario)?.failedHarvestFraction
  const percentOf = (share: number) => fmt.number(Math.round(share * 100))
  /** "≈ 5 of 100 go badly", or, when the model saw none, a plain "none" that does not promise it cannot happen. */
  const failedLine = (scenario: string, some: string, none: string) => {
    const share = failed(scenario) ?? 0
    const scenarioName = t(`farmer.rec.risks.scenarios.${scenario}`)
    return Math.round(share * 100) === 0 ? t(none, { scenario: scenarioName }) : t(some, { scenario: scenarioName, n: percentOf(share) })
  }

  const lines: { basis: 'plan' | 'check' | 'limit'; text: string }[] = [{ basis: 'plan', text: t('farmer.rec.how.lines.compared', { n: meta.rotation_order.length }) }]
  if (ha !== undefined) lines.push({ basis: 'check', text: t('farmer.rec.how.lines.land', { ha: haText }) })
  lines.push(situation.water === 'rain' ? { basis: 'check', text: t('farmer.rec.how.lines.waterRain') } : { basis: 'limit', text: t('farmer.parcel.water.note') })
  if (knownPrevious) lines.push({ basis: 'check', text: t('farmer.rec.how.lines.previous', { previous: t(`crops.${situation.previous}`).toLowerCase() }) })
  if (withFertilizer.length > 0) lines.push({ basis: 'limit', text: t('farmer.rec.how.lines.fertilizer') })
  if (meta.placeholders.length > 0) lines.push({ basis: 'limit', text: t('farmer.rec.how.lines.costs') })

  const others = (['profit', 'sustainability'] as const).map((preset) => ({ preset, view: result.picks[preset] }))

  const header = (
    <header className="rec-head">
      <Tag kind="estimate" />
      <p className="rec-kicker">{t('farmer.rec.title')}</p>
      <Heading className="rec-crop">{t(`rotations.${pick.rotation}`)}</Heading>
      <p className="rec-kind">{crops.length > 1 ? t('farmer.rec.kind.alternate') : t('farmer.rec.kind.single')}</p>
      {situation.goal && <p className="rec-goal">{t('farmer.rec.forGoal', { goal: t(`farmer.rec.goals.${situation.goal}`) })}</p>}
      {next && (
        <div className="rec-now">
          <p>{t('farmer.rec.thisSeason', { crop: cropName(next) })}</p>
          <p className="rec-now-sub">{t('farmer.rec.thisSeasonWhy', { previous: t(`crops.${situation.previous}`).toLowerCase() })}</p>
        </div>
      )}
      {!next && knownPrevious && <p className="rec-note">{t('farmer.rec.noMatch')}</p>}
    </header>
  )

  const detail = (
    <>
      <div className="stats">
        <Stat label={t('farmer.rec.net.label')} value={moneyLine(pick.values.net_mxn_ha, 'farmer.rec.net.value', 'farmer.rec.net.loss')} hint={t('farmer.rec.net.hint')} />
        {ha !== undefined && (
          <Stat label={t('farmer.rec.total.label', { ha: haText })} value={moneyLine(pick.values.net_mxn_ha * ha, 'farmer.rec.total.value', 'farmer.rec.total.loss')} hint={t('farmer.rec.total.hint')} />
        )}
        <Stat label={t('farmer.rec.bad.label')} value={moneyLine(pick.values.cvar_net_mxn_ha, 'farmer.rec.bad.value', 'farmer.rec.bad.loss')} hint={t('farmer.rec.bad.hint')} />
      </div>

      <section className="rec-section">
        <h4>{t('farmer.rec.todo.title')}</h4>
        <ul className="checklist">
          <li>{t('farmer.rec.todo.rotation', { rotation: t(`rotations.${pick.rotation}`).toLowerCase() })}</li>
          {withFertilizer.length === 0 ? (
            <li>{t('farmer.rec.todo.fertilizerNone')}</li>
          ) : (
            withFertilizer.map((crop) => <li key={crop}>{t('farmer.rec.todo.fertilizer', { kg: fmt.number(pick.doses[crop]), crops: cropName(crop).toLowerCase() })}</li>)
          )}
          <li>{pick.retention > 0 ? t('farmer.rec.todo.stover', { pct: fmt.number(Math.round(pick.retention * 100)) }) : t('farmer.rec.todo.stoverNone')}</li>
        </ul>
        {withFertilizer.length > 0 && (
          <div className="callout is-warn">
            <Tag kind="unproven" />
            <p>{t('farmer.rec.todo.fertilizerWarn')}</p>
          </div>
        )}
      </section>

      <section className="rec-section">
        <h4>{t('farmer.rec.risks.title')}</h4>
        <ul className="risk-list">
          <Risk>{moneyLine(pick.values.cvar_net_mxn_ha, 'farmer.rec.risks.badYear', 'farmer.rec.risks.badYearLoss')}</Risk>
          {failed('baseline') !== undefined && <Risk>{failedLine('baseline', 'farmer.rec.risks.dryBase', 'farmer.rec.risks.dryBaseNone')}</Risk>}
          {DRY_SCENARIOS.filter((scenario) => failed(scenario) !== undefined).map((scenario) => (
            <Risk key={scenario}>{failedLine(scenario, 'farmer.rec.risks.dry', 'farmer.rec.risks.dryNone')}</Risk>
          ))}
          {situation.water && situation.water !== 'rain' && <Risk>{t('farmer.rec.risks.irrigation')}</Risk>}
          <Risk>{zone.status === 'inside' ? t('farmer.rec.risks.zone', { km }) : t('farmer.rec.risks.zoneNear')}</Risk>
          {meta.placeholders.length > 0 && <Risk>{t('farmer.rec.risks.costs')}</Risk>}
        </ul>
      </section>

      <section className="rec-section confidence">
        <h4>{t('farmer.rec.confidence.title')}</h4>
        <p className="conf-line">
          <Meter level={confidence} />
          <strong>{t(`farmer.rec.confidence.${confidence}`)}</strong>
        </p>
        <p>{confidence === 'none' ? t('farmer.rec.confidence.useWeak') : t('farmer.rec.confidence.use')}</p>
        {confidence !== 'none' && (evidence.level || evidence.holdoutWorse) && (
          <Disclosure title={t('farmer.rec.confidence.why')}>
            <ul className="evidence">
              {evidence.level && (
                <li>
                  <Tag kind="fact" />
                  {t('farmer.rec.confidence.evidenceLevel', {
                    sim: fmt.number(evidence.level.sim, 1),
                    obs: fmt.number(evidence.level.obs, 1),
                    years: yearsText(evidence.level.years),
                  })}
                </li>
              )}
              {evidence.holdoutWorse && (
                <li>
                  <Tag kind="fact" />
                  {t('farmer.rec.confidence.evidenceYears', { holdout: yearsText(evidence.holdoutWorse) })}
                </li>
              )}
              <li>
                <Tag kind="general" />
                {t('farmer.rec.confidence.evidenceSource')}
              </li>
            </ul>
          </Disclosure>
        )}
      </section>

      <Disclosure title={t('farmer.rec.others.title')}>
        <p>{t('farmer.rec.others.intro')}</p>
        <ul className="plain-list">
          {others.map(({ preset, view }) => (
            <li key={preset}>
              <strong>{t(`farmer.rec.others.${preset}`)}:</strong>{' '}
              {same(view, pick) ? t('farmer.rec.others.same') : t(roundMoney(view.values.net_mxn_ha) < 0 ? 'farmer.rec.others.lineLoss' : 'farmer.rec.others.line', { rotation: t(`rotations.${view.rotation}`), n: money(Math.abs(view.values.net_mxn_ha)) })}
            </li>
          ))}
        </ul>
      </Disclosure>

      <Disclosure title={t('farmer.rec.how.title')}>
        <p>{t('farmer.rec.how.intro')}</p>
        <ul className="plain-list">
          {lines.map((line, i) => (
            <li key={i}>
              <span className={`basis ${line.basis}`}>{t(`farmer.rec.how.basis.${line.basis}`)}</span> {line.text}
            </li>
          ))}
        </ul>
      </Disclosure>

      <Disclosure title={t('farmer.rec.details.title')}>
        <ul className="plain-list">
          <li>{t('farmer.rec.details.yield', { n: fmt.number(pick.values.yield_t_ha, 1) })}</li>
          <li>{t('farmer.rec.details.nLoss', { n: fmt.number(pick.values.n_loss_kg_ha) })}</li>
          <li>{t('farmer.rec.details.carbon', { n: fmt.number(pick.values.c_input_t_ha, 1) })}</li>
        </ul>
        <p className="help">{t('farmer.rec.details.note')}</p>
      </Disclosure>
    </>
  )

  const summary = (
    <div className="rec-brief">
      {ha !== undefined ? (
        <Stat label={t('farmer.rec.total.label', { ha: haText })} value={moneyLine(pick.values.net_mxn_ha * ha, 'farmer.rec.total.value', 'farmer.rec.total.loss')} hint={t('farmer.rec.total.hint')} />
      ) : (
        <Stat label={t('farmer.rec.net.label')} value={moneyLine(pick.values.net_mxn_ha, 'farmer.rec.net.value', 'farmer.rec.net.loss')} hint={t('farmer.rec.net.hint')} />
      )}
      <ul className="risk-list">
        <Risk>{moneyLine(pick.values.cvar_net_mxn_ha, 'farmer.rec.risks.badYear', 'farmer.rec.risks.badYearLoss')}</Risk>
      </ul>
      <p className="conf-line">
        <Meter level={confidence} />
        <strong>{t(`farmer.rec.confidence.${confidence}`)}</strong>
      </p>
      <p>{confidence === 'none' ? t('farmer.rec.confidence.useWeak') : t('farmer.rec.confidence.use')}</p>
    </div>
  )

  return (
    <article className={`rec${variant === 'brief' ? ' brief' : ''}`}>
      {header}
      {variant === 'brief' ? (
        <>
          {summary}
          <Disclosure title={t('farmer.rec.brief.more')}>{detail}</Disclosure>
        </>
      ) : (
        detail
      )}

      <p className="fine">{t('farmer.rec.notGuarantee')}</p>
      {actions && <div className="rec-actions">{actions}</div>}
    </article>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  const { t } = useI18n()
  return (
    <div className="stat">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      <p className="stat-hint">{hint}</p>
      <span className="stat-tag">
        <span aria-hidden="true">≈</span> {t('farmer.rec.estimated')}
      </span>
    </div>
  )
}

function Risk({ children }: { children: ReactNode }) {
  return (
    <li>
      <span className="risk-icon">
        <WarnIcon />
      </span>
      <span>{children}</span>
    </li>
  )
}

/** Four steps, of which the model never reaches the top two: the filled part says how far, the word beside it says it too. */
function Meter({ level }: { level: 'low' | 'veryLow' | 'none' }) {
  const filled = level === 'low' ? 2 : level === 'veryLow' ? 1 : 0
  return (
    <span className="conf-meter" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={i < filled ? 'on' : ''} />
      ))}
    </span>
  )
}
