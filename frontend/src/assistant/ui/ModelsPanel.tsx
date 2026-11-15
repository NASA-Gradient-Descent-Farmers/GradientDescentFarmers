import { PricesPanel } from '../../components/PricesPanel.tsx'
import { useI18n } from '../../i18n/index.tsx'
import { PRESETS } from '../../lib/farm.ts'
import type { LatLon } from '../../lib/geo.ts'
import { sameEconomics } from '../../lib/scenario.ts'
import { WORLDS } from '../../lib/types.ts'
import type { Meta } from '../../lib/types.ts'
import { describeAnswer } from '../../onboarding/describe.ts'
import { STEPS, type Profile } from '../../onboarding/types.ts'
import { MODELS, NOT_AVAILABLE } from '../models.ts'
import type { ModelId, Settings } from '../types.ts'

interface Props {
  meta: Meta
  settings: Settings
  onSettings: (settings: Settings) => void
  mode: 'auto' | 'manual'
  onMode: (mode: 'auto' | 'manual') => void
  chosen: ModelId[]
  onChosen: (models: ModelId[]) => void
  hasPin: boolean
  pinText: string | null
  onEditPin: () => void
  /** Models that were part of the latest answer, marked in the list. */
  latest: ModelId[]
  /** What the farmer said in the onboarding, and a way back to those questions. */
  profile: Profile
  pin: LatLon | null
  onEditAnswers?: () => void
}

export function ModelsPanel({ meta, settings, onSettings, mode, onMode, chosen, onChosen, hasPin, pinText, onEditPin, latest, profile, pin, onEditAnswers }: Props) {
  const i18n = useI18n()
  const { t } = i18n
  const answers = STEPS.map((step) => ({ step, ...describeAnswer(step, profile, pin, meta, i18n) })).filter((a) => a.state !== 'open')
  const edited = !sameEconomics(settings.economics, meta.economics)
  const toggle = (id: ModelId) => onChosen(chosen.includes(id) ? chosen.filter((m) => m !== id) : [...chosen, id])

  return (
    <aside className="models-panel" aria-label={t('assistant.panel.title')}>
      <section className="field-card" aria-labelledby="field-title">
        <h2 id="field-title">{t('assistant.field.title')}</h2>
        {answers.length === 0 ? (
          <p className="panel-note">{t('assistant.field.empty')}</p>
        ) : (
          <dl>
            {answers.map(({ step, value }) => (
              <div key={step}>
                <dt>{t(`onboarding.steps.${step}.short`)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {onEditAnswers && (
          <button type="button" className="link" onClick={onEditAnswers}>
            {answers.length === 0 ? t('assistant.field.begin') : t('assistant.field.edit')}
          </button>
        )}
      </section>

      <h2>{t('assistant.panel.title')}</h2>

      <div className="segmented small" role="group" aria-label={t('assistant.panel.modeLabel')}>
        <button type="button" aria-pressed={mode === 'auto'} onClick={() => onMode('auto')}>
          {t('assistant.panel.auto')}
        </button>
        <button type="button" aria-pressed={mode === 'manual'} onClick={() => onMode('manual')}>
          {t('assistant.panel.manual')}
        </button>
      </div>
      <p className="panel-note">{mode === 'auto' ? t('assistant.panel.autoNote') : t('assistant.panel.manualNote')}</p>

      <ul className="model-list">
        {MODELS.map((info) => {
          const blocked = info.needsPin && !hasPin
          const used = mode === 'auto' ? latest.includes(info.id) : chosen.includes(info.id)
          return (
            <li key={info.id} className={`model-item${used ? ' used' : ''}`}>
              <div className="model-top">
                {mode === 'manual' ? (
                  <label className="check">
                    <input type="checkbox" checked={chosen.includes(info.id)} onChange={() => toggle(info.id)} />
                    <span>{t(`assistant.models.${info.id}.name`)}</span>
                  </label>
                ) : (
                  <strong>{t(`assistant.models.${info.id}.name`)}</strong>
                )}
              </div>
              <p className="purpose">{t(`assistant.models.${info.id}.purpose`)}</p>
              <p className="badges">
                <span className={`badge kind-${info.kind}`}>{t(`assistant.panel.status.${info.kind}`)}</span>
                {info.needsInternet && <span className="badge">{t('assistant.panel.status.internet')}</span>}
                {info.needsPin && <span className={`badge${blocked ? ' warn' : ''}`}>{t('assistant.panel.status.pin')}</span>}
              </p>
              {blocked && (
                <button type="button" className="link" onClick={onEditPin}>
                  {t('assistant.settings.setPin')}
                </button>
              )}
              <details className="tech">
                <summary>{t('assistant.message.details')}</summary>
                <dl className="model-facts">
                  <dt>{t('assistant.panel.inputs')}</dt>
                  <dd>{t(`assistant.models.${info.id}.inputs`)}</dd>
                  <dt>{t('assistant.panel.source')}</dt>
                  <dd>{t(`assistant.models.${info.id}.source`)}</dd>
                  <dt>{t('assistant.panel.limits')}</dt>
                  <dd>{t(`assistant.models.${info.id}.limit`)}</dd>
                </dl>
              </details>
            </li>
          )
        })}
      </ul>
      <p className="panel-note">{t('assistant.panel.combine')}</p>

      <div className="unavailable">
        <h3>{t('assistant.panel.unavailableTitle')}</h3>
        {NOT_AVAILABLE.map((id) => (
          <div key={id} className="model-item off">
            <strong>{t(`assistant.models.${id}.name`)}</strong>
            <p className="purpose">{t(`assistant.models.${id}.reason`)}</p>
            <p className="badges">
              <span className="badge">{t('assistant.panel.status.unavailable')}</span>
            </p>
          </div>
        ))}
      </div>

      <h2 className="settings-title">{t('assistant.settings.title')}</h2>
      <div className="setting">
        <span className="setting-label">{t('assistant.settings.pin')}</span>
        <p>
          {pinText ?? t('assistant.settings.noPin')}{' '}
          <button type="button" className="link" onClick={onEditPin}>
            {pinText ? t('assistant.settings.changePin') : t('assistant.settings.setPin')}
          </button>
        </p>
      </div>
      <div className="setting">
        <span className="setting-label">{t('assistant.settings.world')}</span>
        <div className="segmented stacked small" role="group" aria-label={t('assistant.settings.world')}>
          {WORLDS.map((world) => (
            <button key={world} type="button" aria-pressed={settings.world === world} onClick={() => onSettings({ ...settings, world })}>
              {t(`planner.world.${world}.name`)}
            </button>
          ))}
        </div>
      </div>
      <div className="setting">
        <span className="setting-label">{t('assistant.settings.priority')}</span>
        <div className="segmented stacked small" role="group" aria-label={t('assistant.settings.priority')}>
          {PRESETS.map((preset) => (
            <button key={preset} type="button" aria-pressed={settings.preset === preset} onClick={() => onSettings({ ...settings, preset })}>
              {t(`planner.weights.${preset}`)}
            </button>
          ))}
        </div>
      </div>
      <details className="setting prices-setting" open={edited}>
        <summary>
          {t('assistant.settings.prices')}
          {edited ? <span className="badge warn">{t('assistant.settings.edited')}</span> : null}
        </summary>
        <PricesPanel meta={meta} economics={settings.economics} edited={edited} onChange={(economics) => onSettings({ ...settings, economics })} />
      </details>
      <p className="panel-note">{t('assistant.settings.fromText')}</p>
    </aside>
  )
}
