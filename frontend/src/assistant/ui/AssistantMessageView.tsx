import { useMemo } from 'react'
import { LeafMark } from '../../components/Leaf.tsx'
import { VerdictCard } from '../../components/VerdictCard.tsx'
import { useI18n } from '../../i18n/index.tsx'
import type { DashboardData } from '../../lib/types.ts'
import { followUps, summarize, zoneVerdict, type Say } from '../compose.ts'
import type { AssistantMessage } from '../history.ts'
import { MODELS } from '../models.ts'
import type { ModelId, Outcome, PriceItem, Settings, Understood } from '../types.ts'
import { GuidanceCard } from './GuidanceCard.tsx'
import { CalibrationResultCard } from './cards/CalibrationResultCard.tsx'
import { ClimateResultCard } from './cards/ClimateResultCard.tsx'
import { PlannerResultCard } from './cards/PlannerResultCard.tsx'
import { RiskResultCard } from './cards/RiskResultCard.tsx'
import { StatisticalResultCard } from './cards/StatisticalResultCard.tsx'
import { ModelStrip } from './ModelStrip.tsx'

interface Props {
  message: AssistantMessage
  data: DashboardData
  hasPin: boolean
  distanceKm: number | null
  onRetry: (model: ModelId) => void
  onAskAgain: () => void
  onAsk: (question: string) => void
  onEditPin: () => void
  onOpenPlanner: (settings: Settings) => void
  /** Open the farmer's onboarding answers to review or change them. */
  onEditAnswers?: () => void
}

const PRICE_LABEL: Record<PriceItem, string> = {
  maize: 'assistant.cards.planner.priceMaize',
  barley: 'assistant.cards.planner.priceBarley',
  fababean: 'assistant.cards.planner.priceFababean',
  nitrogen: 'assistant.cards.planner.nPrice',
  stover: 'assistant.cards.planner.stoverPrice',
}

export function AssistantMessageView({ message, data, hasPin, distanceKm, onRetry, onAskAgain, onAsk, onEditPin, onOpenPlanner, onEditAnswers }: Props) {
  const { t, fmt, distance } = useI18n()
  const say = useMemo<Say>(() => ({ t, fmt }), [t, fmt])
  const { interpretation, outcomes, status } = message
  const running = status === 'running'
  const unsure = interpretation.models.length === 0

  const summary = useMemo(() => message.narration?.items ?? summarize(outcomes, say), [message.narration, outcomes, say])
  const verdict = useMemo(() => (hasPin ? zoneVerdict(outcomes, distanceKm) : null), [outcomes, distanceKm, hasPin])
  const showZone = verdict && verdict.status !== 'inside' && outcomes.some((o) => o.ok && (o.model === 'planner' || o.model === 'climate'))
  const next = useMemo(() => (running || unsure ? [] : followUps(outcomes, interpretation, hasPin, say)), [running, unsure, outcomes, interpretation, hasPin, say])

  const chip = (u: Understood): string => {
    if (u.kind === 'price') return `${t(PRICE_LABEL[u.item])}: ${fmt.number(u.value, u.item === 'nitrogen' ? 1 : 0)}`
    if (u.kind === 'priceFactor') return t('assistant.message.chipFactor', { label: t(PRICE_LABEL[u.item]), factor: fmt.number(u.factor, 2) })
    if (u.kind === 'world') return t('assistant.message.chipWorld', { world: t(`planner.world.${u.world}.name`) })
    if (u.kind === 'preset') return t('assistant.message.chipPreset', { preset: t(`assistant.presets.${u.preset}`) })
    return t('assistant.message.chipScenario', { scenario: t(`assistant.scenarios.${u.scenario}`) })
  }

  const card = (outcome: Outcome) => {
    if (!outcome.ok) return <ErrorCard key={outcome.model} outcome={outcome} onRetry={() => onRetry(outcome.model)} onEditPin={onEditPin} />
    switch (outcome.model) {
      case 'planner':
        return <PlannerResultCard key="planner" result={outcome.result} gridHash={data.meta.grid_sha256} onOpenPlanner={() => onOpenPlanner(interpretation.settings)} />
      case 'climate':
        return <ClimateResultCard key="climate" result={outcome.result} />
      case 'risk':
        return <RiskResultCard key="risk" result={outcome.result} />
      case 'calibration':
        return <CalibrationResultCard key="calibration" result={outcome.result} sources={data.models.calibration.sources} />
      case 'statistical':
        return <StatisticalResultCard key="statistical" result={outcome.result} sources={data.models.statistical.sources} />
    }
  }
  const anyOk = outcomes.some((o) => o.ok)
  const planner = outcomes.find((o) => o.model === 'planner' && o.ok)

  return (
    <article className="msg assistant" aria-label={t('assistant.message.assistant')} aria-busy={running}>
      <div className="avatar" aria-hidden="true">
        <LeafMark />
      </div>
      <div className="msg-body">
        {unsure ? (
          <div className="notice">
            <strong>{t('assistant.message.unsureTitle')}</strong>
            <p>{t('assistant.message.unsureBody')}</p>
            <Suggestions items={[t('assistant.suggestions.planner'), t('assistant.suggestions.risk'), t('assistant.suggestions.trust')]} onAsk={onAsk} />
          </div>
        ) : (
          <>
            <ModelStrip message={message} />
            {interpretation.added.map((a) => (
              <p key={a.model} className="added-note">
                {t(a.reason === 'water' ? 'assistant.message.addedWater' : 'assistant.message.added', { model: t(`assistant.models.${a.model}.name`), km: distance(distanceKm ?? 0) })}
              </p>
            ))}
            {interpretation.understood.length > 0 && (
              <div className="understood">
                <span className="strip-label">{t('assistant.message.understood')}</span>
                <ul>
                  {interpretation.understood.map((u, i) => (
                    <li key={i}>{chip(u)}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {running && <p className="progress-note">{t('assistant.progress.note')}</p>}
        {status === 'interrupted' && !anyOk && (
          <div className="notice">
            <p>{t('assistant.message.interrupted')}</p>
            <button type="button" className="chip-button" onClick={onAskAgain}>
              {t('assistant.message.rerun')}
            </button>
          </div>
        )}

        {interpretation.farm && planner?.ok && planner.model === 'planner' && (
          <GuidanceCard farm={interpretation.farm} result={planner.result} meta={data.meta} onEdit={onEditAnswers} />
        )}

        {summary.length > 0 && (
          <section className="summary" aria-label={t('assistant.message.summary')}>
            <h3>{t('assistant.message.summary')}</h3>
            <ul>
              {summary.map((item, i) => (
                <li key={i} className={item.caution ? 'caution' : undefined}>
                  <span className="tag">
                    {item.source === 'combined' ? t('assistant.message.combined') : t(`assistant.models.${item.source}.name`).replace(/ \(.*\)$/, '')}
                  </span>
                  {item.caution && <span className="tag warn">{t('assistant.message.caution')}</span>}
                  {item.text}
                </li>
              ))}
            </ul>
            <p className="summary-note">
              {message.narration ? t('assistant.message.narratedBy', { by: message.narration.by }) : t('assistant.message.summaryNote')}
            </p>
          </section>
        )}

        {showZone && verdict && distanceKm !== null && <VerdictCard verdict={verdict} distanceKm={distanceKm} />}

        {outcomes.length > 0 && (
          <div className="results" role="group" aria-label={t('assistant.message.results')}>
            {[...outcomes].sort((a, b) => MODELS.findIndex((m) => m.id === a.model) - MODELS.findIndex((m) => m.id === b.model)).map(card)}
          </div>
        )}

        {!unsure && (
          <details className="tech question-tech">
            <summary>{t('assistant.message.details')}</summary>
            <div className="tech-body">
              <p>{t('assistant.details.models', { models: interpretation.models.map((m) => t(`assistant.models.${m}.name`)).join(' · ') })}</p>
              <p>{t('assistant.details.intents', { intents: interpretation.intents.map((i) => t(`assistant.intents.${i}`)).join(', ') || t('assistant.details.none') })}</p>
              <p>
                {t('assistant.details.world', { world: t(`planner.world.${interpretation.settings.world}.name`) })} ·{' '}
                {t('assistant.details.priority', { preset: t(`assistant.presets.${interpretation.settings.preset}`) })}
              </p>
              <p>{t('assistant.demo.body2')}</p>
            </div>
          </details>
        )}

        {next.length > 0 && (
          <div className="follow-ups">
            <span className="strip-label">{t('assistant.message.followUps')}</span>
            <Suggestions items={next} onAsk={onAsk} />
          </div>
        )}
      </div>
    </article>
  )
}

export function Suggestions({ items, onAsk }: { items: string[]; onAsk: (q: string) => void }) {
  return (
    <ul className="suggestions">
      {items.map((q) => (
        <li key={q}>
          <button type="button" className="chip-button" onClick={() => onAsk(q)}>
            {q}
          </button>
        </li>
      ))}
    </ul>
  )
}

function ErrorCard({ outcome, onRetry, onEditPin }: { outcome: Extract<Outcome, { ok: false }>; onRetry: () => void; onEditPin: () => void }) {
  const { t } = useI18n()
  return (
    <section className="result-card error" role="alert">
      <header className="result-head">
        <h4>{t(`assistant.models.${outcome.model}.name`)}</h4>
        <span className="badge kind-failed">{t('assistant.progress.failed')}</span>
      </header>
      <div className="result-body">
        <strong>{t(`assistant.errors.${outcome.code}.title`)}</strong>
        <p>{t(`assistant.errors.${outcome.code}.body`)}</p>
        <button type="button" className="chip-button strong" onClick={outcome.code === 'needs-pin' ? onEditPin : onRetry}>
          {t(`assistant.errors.${outcome.code}.action`)}
        </button>
        {outcome.code === 'failed' && (
          <details className="tech">
            <summary>{t('assistant.message.details')}</summary>
            <div className="tech-body">
              <code>{outcome.message}</code>
            </div>
          </details>
        )}
      </div>
    </section>
  )
}
