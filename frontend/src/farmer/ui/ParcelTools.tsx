import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CoverageInfo } from '../../hooks/useCoverage.ts'
import { useI18n } from '../../i18n/index.tsx'
import type { LatLon } from '../../lib/geo.ts'
import type { DashboardData } from '../../lib/types.ts'
import { zoneOf, type Recommendation } from '../recommend.ts'
import { loadSaved, storeSaved, withoutSaved, withSaved } from '../saved.ts'
import { isComplete, loadState, parcelAt, saveState, type FarmerState, type Parcel, type Situation } from '../state.ts'
import { PinIcon, SavedIcon, SproutIcon } from './glyphs.tsx'
import { ParcelPage } from './ParcelPage.tsx'
import { PlantPage } from './PlantPage.tsx'
import { SavedPage } from './SavedPage.tsx'

type Tab = 'parcel' | 'plant' | 'saved'

const TABS: { id: Tab; icon: ReactNode }[] = [
  { id: 'parcel', icon: <PinIcon /> },
  { id: 'plant', icon: <SproutIcon /> },
  { id: 'saved', icon: <SavedIcon /> },
]

interface Props {
  data: DashboardData
  pin: LatLon | null
  /** Sets the pin the whole app shares (the assistant and the planner read the same one). */
  onPin: (point: LatLon) => void
  /** The one site the crop model was fitted to. */
  site: LatLon
  coverage: CoverageInfo | null
  /** Opens the assistant of this mode. */
  onAsk: () => void
}

/**
 * Parcel tools, inside Técnico: the guided questions (Mi parcela), the full recommendation card (Qué sembrar) and the
 * recommendations kept for later (Mis recomendaciones). These are the pages a first-time farmer is walked through; here they
 * are simply available. They read and write the same parcel and answers as the Agricultor home.
 */
export function ParcelTools({ data, pin, onPin, site, coverage, onAsk }: Props) {
  const { t } = useI18n()
  const [state, setState] = useState<FarmerState>(loadState)
  const [saved, setSaved] = useState<Recommendation[]>(loadSaved)
  const parcel = useMemo(() => parcelAt(state, pin), [state, pin])
  const [tab, setTab] = useState<Tab>(() => (parcelAt(state, pin) && isComplete(state.situation) ? 'plant' : 'parcel'))
  const zone = useMemo(() => (coverage ? zoneOf(coverage.verdict, coverage.distanceKm) : null), [coverage])
  const region = useRef<HTMLDivElement>(null)

  useEffect(() => saveState(state), [state])
  useEffect(() => storeSaved(saved), [saved])

  const setParcel = useCallback(
    (next: Parcel) => {
      onPin(next.point)
      setState((current) => ({ ...current, parcel: next }))
    },
    [onPin],
  )
  const patchSituation = useCallback((patch: Situation) => setState((current) => ({ ...current, situation: { ...current.situation, ...patch } })), [])
  const save = useCallback((rec: Recommendation) => setSaved((list) => withSaved(list, rec)), [])
  const remove = useCallback((id: string) => setSaved((list) => withoutSaved(list, id)), [])

  const go = (next: Tab) => {
    setTab(next)
    region.current?.focus({ preventScroll: true })
  }

  return (
    <div className="parcel-tools">
      <nav className="fa-nav inline" aria-label={t('farmer.nav.label')}>
        {TABS.map(({ id, icon }) => (
          <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => go(id)}>
            {icon}
            <span>{t(`farmer.nav.${id}`)}</span>
          </button>
        ))}
      </nav>
      <div ref={region} tabIndex={-1} role="region" aria-label={t(`farmer.nav.${tab}`)} className="parcel-tools-body">
        {tab === 'parcel' && (
          <ParcelPage state={state} parcel={parcel} site={site} zone={zone} onParcel={setParcel} onSituation={patchSituation} onPlant={() => go('plant')} />
        )}
        {tab === 'plant' && (
          <PlantPage data={data} state={state} parcel={parcel} zone={zone} saved={saved} onSave={save} onGoParcel={() => go('parcel')} onAsk={onAsk} />
        )}
        {tab === 'saved' && <SavedPage saved={saved} meta={data.meta} models={data.models} onRemove={remove} onGoPlant={() => go('plant')} />}
      </div>
    </div>
  )
}
