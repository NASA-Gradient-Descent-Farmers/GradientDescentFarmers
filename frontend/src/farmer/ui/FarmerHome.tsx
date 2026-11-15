import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAccount } from '../../account/AccountContext.ts'
import { TopBar } from '../../components/TopBar.tsx'
import type { CoverageInfo } from '../../hooks/useCoverage.ts'
import { useI18n } from '../../i18n/index.tsx'
import type { LatLon } from '../../lib/geo.ts'
import type { DashboardData } from '../../lib/types.ts'
import { zoneOf } from '../recommend.ts'
import { isComplete, loadState, parcelAt, saveState, type FarmerState, type Parcel, type Situation } from '../state.ts'
import { AskPage } from './AskPage.tsx'
import { PinIcon } from './glyphs.tsx'
import { ParcelPage } from './ParcelPage.tsx'

interface Props {
  data: DashboardData
  pin: LatLon | null
  /** Sets the pin the whole app shares. */
  onPin: (point: LatLon) => void
  /** The one site the crop model was fitted to. */
  site: LatLon
  coverage: CoverageInfo | null
}

/**
 * Agricultor, for someone who has already said where their parcel is: one page with the parcel in a line and the assistant
 * below it. The first time (no parcel or answers yet) it starts with the short guided questions of Mi parcela, then brings the
 * person here and asks the recommendation for them. The fuller pages (recommendation, saved list) live in Técnico.
 */
export function FarmerHome({ data, pin, onPin, site, coverage }: Props) {
  const { t, fmt } = useI18n()
  const { user } = useAccount()
  const name = user?.name ?? ''
  const [state, setState] = useState<FarmerState>(loadState)
  const parcel = useMemo(() => parcelAt(state, pin), [state, pin])
  const ready = parcel !== null && isComplete(state.situation)
  const [view, setView] = useState<'setup' | 'home'>(ready ? 'home' : 'setup')
  const [firstTime] = useState(() => state.parcel === null && Object.keys(state.situation).length === 0)
  const [seed, setSeed] = useState<{ text: string; nonce: number } | null>(null)
  const zone = useMemo(() => (coverage ? zoneOf(coverage.verdict, coverage.distanceKm) : null), [coverage])
  const main = useRef<HTMLElement>(null)

  useEffect(() => saveState(state), [state])

  const setParcel = useCallback(
    (next: Parcel) => {
      onPin(next.point)
      setState((current) => ({ ...current, parcel: next }))
    },
    [onPin],
  )
  const patchSituation = useCallback((patch: Situation) => setState((current) => ({ ...current, situation: { ...current.situation, ...patch } })), [])
  const seedUsed = useCallback(() => setSeed(null), [])

  const go = (next: 'setup' | 'home') => {
    setView(next)
    window.scrollTo(0, 0)
    // a change of page moves the keyboard and screen reader focus to the new page
    main.current?.focus({ preventScroll: true })
  }
  /** The questions are answered: back to the assistant, which gives the recommendation straight away. */
  const finishSetup = () => {
    setSeed({ text: t('farmer.home.firstQuestion'), nonce: Date.now() })
    go('home')
  }

  const place = parcel ? (parcel.label ?? t(parcel.source === 'gps' ? 'farmer.parcel.place.fromGps' : 'farmer.parcel.place.fromMap')) : ''
  const { hectares, water, goal } = state.situation
  const facts = [
    hectares !== undefined ? `${Number.isInteger(hectares) ? fmt.number(hectares) : fmt.number(hectares, 1)} ha` : null,
    water ? t(`farmer.parcel.water.${water}.label`) : null,
    goal ? t(`farmer.parcel.goal.${goal}.label`) : null,
  ].filter(Boolean)

  return (
    <div className="fa fa-solo">
      <a className="skip-link" href="#fa-main">
        {t('farmer.app.skip')}
      </a>
      <TopBar />
      <main id="fa-main" ref={main} tabIndex={-1}>
        {view === 'setup' ? (
          <>
            {firstTime && !ready && <p className="setup-welcome">{t('farmer.setup.welcome', { name })}</p>}
            {!firstTime && ready && (
              <button type="button" className="btn ghost back-home" onClick={() => go('home')}>
                ← {t('farmer.setup.backHome')}
              </button>
            )}
            <ParcelPage state={state} parcel={parcel} site={site} zone={zone} onParcel={setParcel} onSituation={patchSituation} onPlant={finishSetup} />
          </>
        ) : (
          <>
            <section className="home-parcel" aria-label={t('farmer.home.yourParcel')}>
              <span className="home-parcel-icon" aria-hidden="true">
                <PinIcon />
              </span>
              <div className="home-parcel-text">
                <p className="home-parcel-place">{place}</p>
                {facts.length > 0 && <p className="home-parcel-facts">{facts.join(' · ')}</p>}
              </div>
              <button type="button" className="btn ghost" onClick={() => go('setup')}>
                {t('farmer.home.change')}
              </button>
            </section>
            <AskPage
              data={data}
              state={state}
              parcel={parcel}
              zone={zone}
              heading={t('farmer.home.hello', { name })}
              lede={t('farmer.home.lede')}
              onSituation={patchSituation}
              onGoParcel={() => go('setup')}
              seed={seed}
              onSeedUsed={seedUsed}
            />
          </>
        )}
      </main>
    </div>
  )
}
