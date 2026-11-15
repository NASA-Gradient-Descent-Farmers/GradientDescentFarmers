import { useEffect, useRef, useState } from 'react'
import { useRotations } from '../../hooks/useRotations.ts'
import { useI18n } from '../../i18n/index.tsx'
import { nearRotationSite } from '../../lib/rotations.ts'
import type { DashboardData } from '../../lib/types.ts'
import { recommend, type Recommendation, type Zone } from '../recommend.ts'
import { isComplete, missing, type FarmerState, type Parcel } from '../state.ts'
import { CheckIcon } from './glyphs.tsx'
import { RecommendationCard } from './RecommendationCard.tsx'
import { RotationPlant } from './RotationPlant.tsx'
import { ZoneNotice } from './ZoneNotice.tsx'

type Run = { key: string; status: 'loading' | 'ready' | 'error'; rec?: Recommendation; message?: string }

interface Props {
  data: DashboardData
  state: FarmerState
  parcel: Parcel | null
  zone: Zone | null
  saved: Recommendation[]
  onSave: (rec: Recommendation) => void
  onGoParcel: () => void
  onAsk: () => void
}

const UNKNOWN_ZONE: Zone = { status: 'unknown', key: null, km: 0 }

/**
 * Qué sembrar: the one question the whole app answers. It needs the parcel and the four answers; with them it asks the planner
 * (right in the browser, no connection needed) and draws the recommendation. Outside the zone the model was fitted for, it says
 * so first and shows nothing for the parcel; Texcoco's options are offered only as a clearly labelled reference.
 */
export function PlantPage(props: Props) {
  const rotations = useRotations()
  const { parcel, onAsk } = props
  // a parcel close to a point the rotations service has run gets those results; anywhere else, the planner (or its refusal)
  const site = parcel && rotations ? nearRotationSite(parcel.point, rotations) : null
  return site ? <RotationPlant site={site} onAsk={onAsk} /> : <PlannerPlantPage {...props} />
}

function PlannerPlantPage({ data, state, parcel, zone, saved, onSave, onGoParcel, onAsk }: Props) {
  const { t } = useI18n()
  const { situation } = state
  const ready = parcel !== null && isComplete(situation)
  const outside = zone?.status === 'outside'
  const [showReference, setShowReference] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [run, setRun] = useState<Run | null>(null)

  const key = ready ? JSON.stringify([parcel.point, situation, zone?.status ?? 'unknown', attempt]) : ''
  const wanted = ready && (!outside || showReference)
  const inputs = useRef({ data, parcel, situation, zone })
  useEffect(() => {
    inputs.current = { data, parcel, situation, zone } // the effect below runs on the key alone, with the latest inputs
  })

  useEffect(() => {
    const { data: d, parcel: p, situation: s, zone: z } = inputs.current
    if (!wanted || !p) return
    let alive = true
    setRun({ key, status: 'loading' })
    recommend({ data: d, point: p.point, place: p.label, situation: s, zone: z ?? UNKNOWN_ZONE }).then(
      (rec) => alive && setRun({ key, status: 'ready', rec }),
      (error: unknown) => alive && setRun({ key, status: 'error', message: error instanceof Error ? error.message : String(error) }),
    )
    return () => {
      alive = false
    }
  }, [wanted, key])

  const current = run && run.key === key ? run : null
  const lacking = [...(parcel ? [] : ['parcel']), ...missing(situation)].map((item) => t(`farmer.plant.items.${item}`))

  return (
    <div className="page">
      <h1 className="page-title">{t('farmer.plant.title')}</h1>
      <p className="page-question">{t('farmer.plant.question')}</p>

      {!ready && (
        <div className="empty-card">
          <h2>{t('farmer.plant.needTitle')}</h2>
          <p>{t('farmer.plant.needBody', { items: lacking.join(', ') })}</p>
          <button type="button" className="btn primary big block" onClick={onGoParcel}>
            {t('farmer.plant.go')}
          </button>
        </div>
      )}

      {ready && outside && (
        <>
          <ZoneNotice zone={zone} />
          <div className="empty-card">
            <h2>{t('farmer.plant.outsideTitle')}</h2>
            <p>{t('farmer.plant.outsideBody')}</p>
            <button type="button" className="btn secondary block" onClick={() => setShowReference((shown) => !shown)} aria-expanded={showReference}>
              {showReference ? t('farmer.plant.hideReference') : t('farmer.plant.showReference')}
            </button>
          </div>
          {showReference && <p className="callout is-warn">{t('farmer.plant.referenceNote')}</p>}
        </>
      )}

      {wanted && current?.status === 'loading' && (
        <p className="loading" role="status">
          <span className="spinner" aria-hidden="true" />
          {t('farmer.plant.loading')}
        </p>
      )}
      {wanted && current?.status === 'error' && (
        <div className="callout is-error" role="alert">
          <p>{t('farmer.plant.error', { message: current.message ?? '' })}</p>
          <button type="button" className="btn secondary" onClick={() => setAttempt((n) => n + 1)}>
            {t('farmer.common.retry')}
          </button>
        </div>
      )}
      {wanted && current?.status === 'ready' && current.rec && (
        <RecommendationCard
          rec={current.rec}
          meta={data.meta}
          models={data.models}
          actions={
            <>
              <SaveButton rec={current.rec} saved={saved} onSave={onSave} />
              <button type="button" className="btn secondary" onClick={onAsk}>
                {t('farmer.rec.actions.ask')}
              </button>
              <button type="button" className="btn ghost" onClick={onGoParcel}>
                {t('farmer.rec.actions.edit')}
              </button>
            </>
          }
        />
      )}
    </div>
  )
}

export function SaveButton({ rec, saved, onSave }: { rec: Recommendation; saved: Recommendation[]; onSave: (rec: Recommendation) => void }) {
  const { t } = useI18n()
  const done = saved.some((item) => item.id === rec.id)
  return (
    <button type="button" className="btn primary" onClick={() => onSave(rec)} disabled={done}>
      {done && <CheckIcon />}
      {done ? t('farmer.rec.actions.saved') : t('farmer.rec.actions.save')}
    </button>
  )
}
