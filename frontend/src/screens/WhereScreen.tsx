import { useState } from 'react'
import { ClimateCard } from '../components/ClimateCard.tsx'
import { LangToggle } from '../components/LangToggle.tsx'
import type { WipeOrigin } from '../components/LeafTransition.tsx'
import { LazyMapCard } from '../components/LazyMapCard.tsx'
import { VerdictCard } from '../components/VerdictCard.tsx'
import { useCoverage } from '../hooks/useCoverage.ts'
import { useZoneData } from '../hooks/useZoneData.ts'
import { zoneOf } from '../farmer/recommend.ts'
import { ZoneNotice } from '../farmer/ui/ZoneNotice.tsx'
import { DEMO_LOCATIONS } from '../lib/demoLocations.ts'
import { nearZone } from '../lib/environment.ts'
import { useI18n } from '../i18n/index.tsx'
import type { LatLon } from '../lib/geo.ts'

interface Props {
  initial: LatLon | null
  /** The one site the crop model covers. */
  site: LatLon
  onConfirm: (point: LatLon, from: WipeOrigin) => void
  onBack: (from: WipeOrigin) => void
}

const centreOf = (el: HTMLElement): WipeOrigin => {
  const box = el.getBoundingClientRect()
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}

/** "¿Dónde está tu parcela?": a map to drop a pin on, and what NASA says about the climate there. */
export function WhereScreen({ initial, site, onConfirm, onBack }: Props) {
  const { t, distance, coords } = useI18n()
  const [pin, setPin] = useState<LatLon | null>(initial)
  const info = useCoverage(pin, site)
  const published = useZoneData()
  // a pin close to a place with published data is told about that, not only how far it is from Texcoco
  const near = pin && published ? nearZone(pin, published) : null

  return (
    <div className="where">
      <div className="where-top">
        <button type="button" className="where-back" onClick={(e) => onBack(centreOf(e.currentTarget))}>
          ← {t('where.back')}
        </button>
        <LangToggle />
      </div>

      <div className="where-grid">
        <section className="where-main" aria-labelledby="where-title">
          <p className="where-eyebrow">{t('where.eyebrow')}</p>
          <h1 id="where-title" className="where-title">
            {t('where.title')}
          </h1>
          <p className="where-lede">{t('where.lede')}</p>

          <LazyMapCard value={pin} onChange={setPin} site={site} />
        </section>

        <aside className="where-side">
          <div className="pin-status">
            <h2>{t('where.pin')}</h2>
            {pin && info ? (
              <>
                <p className="pin-coords">{coords(pin)}</p>
                <p className="pin-distance">{near ? t('where.distanceZone', { km: distance(near.km), place: near.name }) : t('where.distance', { km: distance(info.distanceKm) })}</p>
              </>
            ) : (
              <p className="pin-distance">{t('where.noPin')}</p>
            )}
            <button type="button" className="link-quiet" onClick={() => setPin(site)}>
              {t('where.inTexcoco')}
            </button>
            {DEMO_LOCATIONS.map((place) => (
              <button key={place.id} type="button" className="link-quiet" onClick={() => setPin({ lat: place.latitude, lon: place.longitude })}>
                {t('where.inPlace', { place: place.name })}
              </button>
            ))}
          </div>

          {near && info ? <ZoneNotice zone={zoneOf(info.verdict, info.distanceKm)} point={pin} /> : info && <VerdictCard verdict={info.verdict} distanceKm={info.distanceKm} />}

          <button
            type="button"
            className="cv-button"
            disabled={!pin}
            onClick={(e) => pin && onConfirm(pin, centreOf(e.currentTarget))}
          >
            {pin ? t('where.continue') : t('where.needPin')}
          </button>

          {info && <ClimateCard climate={info.climate} onRetry={info.retry} />}
          <p className="where-foot">{t('where.privacy')}</p>
        </aside>
      </div>
    </div>
  )
}
