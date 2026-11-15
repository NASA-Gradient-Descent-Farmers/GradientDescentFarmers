import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../../i18n/index.tsx'
import type { LatLon } from '../../lib/geo.ts'
import { isComplete, loadState, parcelAt, saveState, type FarmerState, type Parcel, type Situation } from '../state.ts'
import { AskPage } from './AskPage.tsx'
import { ChatIcon, PinIcon, SproutIcon } from './glyphs.tsx'
import { ParcelPage } from './ParcelPage.tsx'
import { PlantPage } from './PlantPage.tsx'

type Tab = 'parcel' | 'plant' | 'ask'

const TABS: { id: Tab; icon: ReactNode }[] = [
  { id: 'parcel', icon: <PinIcon /> },
  { id: 'plant', icon: <SproutIcon /> },
  { id: 'ask', icon: <ChatIcon /> },
]

interface Props {
  pin: LatLon | null
  /** Sets the pin the whole app shares. */
  onPin: (point: LatLon) => void
  /** Only used to know the data has loaded before the map is offered. */
  site: LatLon
}

/**
 * Técnico: the parcel tools in one place. The guided questions (Mi parcela), the results for the parcel's place (Qué sembrar,
 * with its rotation options and data) and the assistant (Preguntar a YolIA), all reading and writing the same parcel and
 * answers as the Agricultor home.
 */
export function ParcelTools({ pin, onPin, site }: Props) {
  const { t } = useI18n()
  const [state, setState] = useState<FarmerState>(loadState)
  const parcel = useMemo(() => parcelAt(state, pin), [state, pin])
  const [tab, setTab] = useState<Tab>(() => (parcelAt(state, pin) && isComplete(state.situation) ? 'plant' : 'parcel'))
  const region = useRef<HTMLDivElement>(null)

  useEffect(() => saveState(state), [state])

  const setParcel = useCallback(
    (next: Parcel) => {
      onPin(next.point)
      setState((current) => ({ ...current, parcel: next }))
    },
    [onPin],
  )
  const patchSituation = useCallback((patch: Situation) => setState((current) => ({ ...current, situation: { ...current.situation, ...patch } })), [])

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
        {tab === 'parcel' && <ParcelPage state={state} parcel={parcel} site={site} onParcel={setParcel} onSituation={patchSituation} onPlant={() => go('plant')} />}
        {tab === 'plant' && <PlantPage state={state} parcel={parcel} onGoParcel={() => go('parcel')} onAsk={() => go('ask')} />}
        {tab === 'ask' && (
          <AskPage
            state={state}
            parcel={parcel}
            heading={t('farmer.nav.ask')}
            lede={t('farmer.home.lede')}
            onSituation={patchSituation}
            onGoParcel={() => go('parcel')}
            seed={null}
            onSeedUsed={() => undefined}
          />
        )}
      </div>
    </div>
  )
}
