import { useState } from 'react'
import { LazyMapCard } from '../../components/LazyMapCard.tsx'
import { useI18n } from '../../i18n/index.tsx'
import type { LatLon } from '../../lib/geo.ts'

/** Tap the map to put the parcel; confirm with a big button. The map keeps its own street and satellite switch. */
export function MapPicker({ site, initial, onUse, onClose }: { site: LatLon; initial: LatLon | null; onUse: (point: LatLon) => void; onClose: () => void }) {
  const { t } = useI18n()
  const [point, setPoint] = useState<LatLon | null>(initial)
  return (
    <div className="map-picker">
      <p className="help">{t('farmer.parcel.place.mapHint')}</p>
      <LazyMapCard value={point} onChange={setPoint} site={site} className="farmer-map" />
      <div className="row">
        <button type="button" className="btn primary" disabled={!point} onClick={() => point && onUse(point)}>
          {t('farmer.parcel.place.mapUse')}
        </button>
        <button type="button" className="btn secondary" onClick={onClose}>
          {t('farmer.parcel.place.closeMap')}
        </button>
      </div>
    </div>
  )
}
