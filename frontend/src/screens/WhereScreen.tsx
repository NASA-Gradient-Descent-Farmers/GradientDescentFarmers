import { useState } from 'react'
import { LangToggle } from '../components/LangToggle.tsx'
import type { WipeOrigin } from '../components/LeafTransition.tsx'
import { LazyMapCard } from '../components/LazyMapCard.tsx'
import { ZoneNotice } from '../farmer/ui/ZoneNotice.tsx'
import { useZoneData } from '../hooks/useZoneData.ts'
import { useI18n } from '../i18n/index.tsx'
import { DEMO_LOCATIONS, nearestDemoLocation } from '../lib/demoLocations.ts'
import { nearZone } from '../lib/environment.ts'
import type { LatLon } from '../lib/geo.ts'

interface Props {
  initial: LatLon | null
  onConfirm: (point: LatLon, from: WipeOrigin) => void
  onBack: (from: WipeOrigin) => void
}

const centreOf = (el: HTMLElement): WipeOrigin => {
  const box = el.getBoundingClientRect()
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}

/** "¿Dónde está tu parcela?": a map with the predetermined places to drop a pin on, and what exists for the pin. */
export function WhereScreen({ initial, onConfirm, onBack }: Props) {
  const { t, distance, coords } = useI18n()
  const [pin, setPin] = useState<LatLon | null>(initial)
  const published = useZoneData()
  // a pin close to a place with published data is told about that; otherwise how far the nearest one is
  const near = pin && published ? nearZone(pin, published) : null
  const nearest = pin ? nearestDemoLocation(pin) : null

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

          <LazyMapCard value={pin} onChange={setPin} />
        </section>

        <aside className="where-side">
          <div className="pin-status">
            <h2>{t('where.pin')}</h2>
            {pin && nearest ? (
              <>
                <p className="pin-coords">{coords(pin)}</p>
                <p className="pin-distance">{near ? t('where.distanceZone', { km: distance(near.km), place: near.name }) : t('where.distanceNearest', { km: distance(nearest.km), place: nearest.place.name })}</p>
              </>
            ) : (
              <p className="pin-distance">{t('where.noPin')}</p>
            )}
            {DEMO_LOCATIONS.map((place) => (
              <button key={place.id} type="button" className="link-quiet" onClick={() => setPin({ lat: place.latitude, lon: place.longitude })}>
                {t('where.inPlace', { place: place.name })}
              </button>
            ))}
          </div>

          {pin && <ZoneNotice point={pin} />}

          <button
            type="button"
            className="cv-button"
            disabled={!pin}
            onClick={(e) => pin && onConfirm(pin, centreOf(e.currentTarget))}
          >
            {pin ? t('where.continue') : t('where.needPin')}
          </button>

          <p className="where-foot">{t('where.privacy')}</p>
        </aside>
      </div>
    </div>
  )
}
