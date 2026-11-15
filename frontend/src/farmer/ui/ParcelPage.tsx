import { useState, type ReactNode } from 'react'
import { useI18n } from '../../i18n/index.tsx'
import type { LatLon } from '../../lib/geo.ts'
import { currentPosition, GeoError, type GeoErrorCode } from '../geolocate.ts'
import { placeLabel, type Place } from '../places.ts'
import type { Zone } from '../recommend.ts'
import { FIELDS, missing, validHectares, type Field, type FarmerState, type Goal, type Parcel, type Previous, type Situation } from '../state.ts'
import { BigChoice } from './BigChoice.tsx'
import { LocateIcon, MapIcon, PinIcon } from './glyphs.tsx'
import { HectaresField } from './HectaresField.tsx'
import { MapPicker } from './MapPicker.tsx'
import { goalOptions, previousOptions, waterOptions } from './options.tsx'
import { PlaceSearch } from './PlaceSearch.tsx'
import { Progress } from './Progress.tsx'
import { ZoneNotice } from './ZoneNotice.tsx'

type Step = 'place' | Field | 'summary'
const ORDER = ['place', ...FIELDS] as const


interface Props {
  state: FarmerState
  parcel: Parcel | null
  site: LatLon | null
  zone: Zone | null
  onParcel: (parcel: Parcel) => void
  onSituation: (patch: Situation) => void
  onPlant: () => void
}

const firstStep = (parcel: Parcel | null, situation: Situation): Step => (!parcel ? 'place' : (missing(situation)[0] ?? 'summary'))

/**
 * Mi parcela: where the field is, then four short questions, one at a time with large buttons, then a summary the farmer
 * can correct line by line. Choosing never moves on by itself: "Continuar" does, so nothing happens unexpectedly.
 */
export function ParcelPage({ state, parcel, site, zone, onParcel, onSituation, onPlant }: Props) {
  const { t, coords } = useI18n()
  const { situation } = state
  const [step, setStep] = useState<Step>(() => firstStep(parcel, situation))
  const [editing, setEditing] = useState(false)

  const parcelText = (p: Parcel) => p.label ?? t(p.source === 'gps' ? 'farmer.parcel.place.fromGps' : 'farmer.parcel.place.fromMap')

  const next = () => {
    if (editing) {
      setEditing(false)
      setStep('summary')
      return
    }
    const at = ORDER.indexOf(step as (typeof ORDER)[number])
    setStep(at >= 0 && at < ORDER.length - 1 ? ORDER[at + 1] : 'summary')
  }
  const back = () => {
    const at = ORDER.indexOf(step as (typeof ORDER)[number])
    setEditing(false)
    setStep(at > 0 ? ORDER[at - 1] : step)
  }
  const edit = (target: Step) => {
    setEditing(true)
    setStep(target)
  }

  if (step === 'summary') {
    return (
      <div className="page">
        <h1 className="page-title">{t('farmer.parcel.title')}</h1>
        <p className="page-lede">{t('farmer.parcel.summary.title')}</p>
        <dl className="parcel-summary">
          <SummaryRow label={t('farmer.parcel.summary.where')} onChange={() => edit('place')}>
            {parcel ? (
              <>
                <strong>{parcelText(parcel)}</strong>
                <span className="muted">{coords(parcel.point)}</span>
              </>
            ) : (
              '—'
            )}
          </SummaryRow>
          <SummaryRow label={t('farmer.parcel.steps.previous.q')} onChange={() => edit('previous')}>
            <strong>{situation.previous ? t(`farmer.parcel.previous.${situation.previous}`) : '—'}</strong>
          </SummaryRow>
          <SummaryRow label={t('farmer.parcel.steps.hectares.q')} onChange={() => edit('hectares')}>
            <strong>{situation.hectares !== undefined ? t('farmer.parcel.hectares.quick', { n: situation.hectares }) : '—'}</strong>
          </SummaryRow>
          <SummaryRow label={t('farmer.parcel.steps.water.q')} onChange={() => edit('water')}>
            <strong>{situation.water ? t(`farmer.parcel.water.${situation.water}.label`) : '—'}</strong>
            {situation.water && situation.water !== 'rain' && <span className="muted">{t('farmer.parcel.water.note')}</span>}
          </SummaryRow>
          <SummaryRow label={t('farmer.parcel.steps.goal.q')} onChange={() => edit('goal')}>
            <strong>{situation.goal ? t(`farmer.parcel.goal.${situation.goal}.label`) : '—'}</strong>
          </SummaryRow>
        </dl>
        {parcel && <ZoneNotice zone={zone} point={parcel.point} />}
        <button type="button" className="btn primary big block" onClick={onPlant} disabled={!parcel || missing(situation).length > 0}>
          {t('farmer.parcel.summary.cta')}
        </button>
        <p className="help center">{t('farmer.parcel.summary.ctaHint')}</p>
      </div>
    )
  }

  const number = ORDER.indexOf(step) + 1
  const canGoOn =
    step === 'place' ? parcel !== null : step === 'hectares' ? validHectares(situation.hectares) : situation[step] !== undefined

  return (
    <div className="page">
      <h1 className="page-title">{t('farmer.parcel.title')}</h1>
      <Progress n={number} total={ORDER.length} />
      <h2 className="step-q">{t(`farmer.parcel.steps.${step}.q`)}</h2>
      <p className="page-lede">{t(`farmer.parcel.steps.${step}.hint`)}</p>

      {step === 'place' && <PlaceStep parcel={parcel} site={site} zone={zone} parcelText={parcelText} onParcel={onParcel} />}

      {step === 'previous' && (
        <BigChoice<Previous>
          label={t('farmer.parcel.steps.previous.q')}
          value={situation.previous}
          onChange={(previous) => onSituation({ previous })}
          options={previousOptions(t)}
        />
      )}

      {step === 'hectares' && <HectaresField value={situation.hectares} onChange={(hectares) => onSituation({ hectares })} />}

      {step === 'water' && (
        <>
          <BigChoice
            label={t('farmer.parcel.steps.water.q')}
            value={situation.water}
            onChange={(water) => onSituation({ water })}
            options={waterOptions(t)}
          />
          {situation.water && situation.water !== 'rain' && <p className="callout is-warn">{t('farmer.parcel.water.note')}</p>}
        </>
      )}

      {step === 'goal' && (
        <BigChoice<Goal>
          label={t('farmer.parcel.steps.goal.q')}
          value={situation.goal}
          onChange={(goal) => onSituation({ goal })}
          options={goalOptions(t)}
        />
      )}

      <div className="step-actions">
        <button type="button" className="btn primary big" onClick={next} disabled={!canGoOn}>
          {t('farmer.common.next')}
        </button>
        {step !== 'place' && (
          <button type="button" className="btn secondary big" onClick={back}>
            {t('farmer.common.back')}
          </button>
        )}
      </div>
    </div>
  )
}

function SummaryRow({ label, onChange, children }: { label: string; onChange: () => void; children: ReactNode }) {
  const { t } = useI18n()
  return (
    <div className="sum-row">
      <div>
        <dt>{label}</dt>
        <dd>{children}</dd>
      </div>
      <button type="button" className="btn ghost" onClick={onChange} aria-label={`${t('farmer.common.change')}: ${label}`}>
        {t('farmer.common.change')}
      </button>
    </div>
  )
}

function PlaceStep({ parcel, site, zone, parcelText, onParcel }: { parcel: Parcel | null; site: LatLon | null; zone: Zone | null; parcelText: (p: Parcel) => string; onParcel: (p: Parcel) => void }) {
  const { t, coords } = useI18n()
  const [changing, setChanging] = useState(false)
  const [showMap, setShowMap] = useState(false)
  const [geo, setGeo] = useState<{ status: 'idle' | 'busy' | 'error'; code?: GeoErrorCode }>({ status: 'idle' })

  const chosen = (next: Parcel) => {
    onParcel(next)
    setChanging(false)
    setShowMap(false)
    setGeo({ status: 'idle' })
  }
  const locate = () => {
    setGeo({ status: 'busy' })
    currentPosition().then(
      (point) => chosen({ label: null, source: 'gps', point }),
      (error: unknown) => setGeo({ status: 'error', code: error instanceof GeoError ? error.code : 'unavailable' }),
    )
  }

  if (parcel && !changing) {
    return (
      <div className="place-chosen">
        <div className="chosen-card">
          <span className="chosen-icon">
            <PinIcon />
          </span>
          <div>
            <p className="chosen-label">{t('farmer.parcel.place.chosen')}</p>
            <p className="chosen-name">{parcelText(parcel)}</p>
            <p className="muted">
              {coords(parcel.point)} · {t('farmer.parcel.place.approximate')}
            </p>
          </div>
        </div>
        <ZoneNotice zone={zone} point={parcel.point} />
        <button type="button" className="btn secondary" onClick={() => setChanging(true)}>
          {t('farmer.common.change')}
        </button>
        <p className="help">{t('farmer.parcel.place.privacy')}</p>
      </div>
    )
  }

  return (
    <div className="place-pick">
      <PlaceSearch onPick={(place: Place) => chosen({ label: placeLabel(place), source: 'search', point: place.point })} />
      <div className="or">—</div>
      <button type="button" className="btn secondary block" onClick={locate} disabled={geo.status === 'busy'}>
        <LocateIcon />
        {geo.status === 'busy' ? t('farmer.parcel.place.locating') : t('farmer.parcel.place.useLocation')}
      </button>
      {geo.status === 'error' && (
        <p className="callout is-error" role="alert">
          {t(`farmer.parcel.place.geo.${geo.code ?? 'unavailable'}`)}
        </p>
      )}
      {site && !showMap && (
        <button type="button" className="btn secondary block" onClick={() => setShowMap(true)}>
          <MapIcon />
          {t('farmer.parcel.place.chooseMap')}
        </button>
      )}
      {site && showMap && (
        <MapPicker site={site} initial={parcel?.point ?? null} onUse={(point) => chosen({ label: null, source: 'map', point })} onClose={() => setShowMap(false)} />
      )}
      {parcel && (
        <button type="button" className="btn ghost" onClick={() => setChanging(false)}>
          {t('farmer.common.back')}
        </button>
      )}
      <p className="help">{t('farmer.parcel.place.privacy')}</p>
    </div>
  )
}
