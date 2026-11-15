import { useZoneData } from '../../hooks/useZoneData.ts'
import { useI18n } from '../../i18n/index.tsx'
import { nearZone } from '../../lib/environment.ts'
import type { Parcel } from '../state.ts'
import { EnvironmentPanel } from './EnvironmentPanel.tsx'
import { RotationPlant } from './RotationPlant.tsx'
import { ZoneNotice } from './ZoneNotice.tsx'

interface Props {
  parcel: Parcel | null
  onGoParcel: () => void
  onAsk: () => void
}

/**
 * Qué sembrar: what the data service has published for the place the parcel is near. A parcel close to Sonora or Sinaloa gets
 * the rotation options and the place's data; one close to Guanajuato gets the place's data and is told the rotation model has
 * not been run there; anywhere else it says there is no data yet and where the nearest is. It never fills the gap with
 * results computed for another place.
 */
export function PlantPage({ parcel, onGoParcel, onAsk }: Props) {
  const { t } = useI18n()
  const published = useZoneData()
  const zone = parcel && published ? nearZone(parcel.point, published) : null

  if (zone?.rotations) return <RotationPlant zone={zone} rotations={zone.rotations} onAsk={onAsk} />

  return (
    <div className="page">
      <h1 className="page-title">{t('farmer.plant.title')}</h1>
      <p className="page-question">{t('farmer.plant.question')}</p>

      {!parcel && (
        <div className="empty-card">
          <h2>{t('farmer.plant.needTitle')}</h2>
          <p>{t('farmer.plant.needBody', { items: t('farmer.plant.items.parcel') })}</p>
          <button type="button" className="btn primary big block" onClick={onGoParcel}>
            {t('farmer.plant.go')}
          </button>
        </div>
      )}

      {parcel && !published && (
        <p className="loading" role="status">
          <span className="spinner" aria-hidden="true" />
          {t('farmer.plant.loading')}
        </p>
      )}

      {parcel && published && !zone && (
        <>
          <ZoneNotice point={parcel.point} />
          <div className="empty-card">
            <h2>{t('near.noDataCard.title')}</h2>
            <p>{t('near.noDataCard.body')}</p>
            <button type="button" className="btn primary big block" onClick={onGoParcel}>
              {t('farmer.common.change')}
            </button>
          </div>
        </>
      )}

      {zone && !zone.rotations && (
        <>
          <p className="callout is-warn">{t('near.noRotations', { place: zone.name })}</p>
          <EnvironmentPanel zone={zone} />
          <button type="button" className="btn secondary" onClick={onAsk}>
            {t('farmer.rec.actions.ask')}
          </button>
        </>
      )}
    </div>
  )
}
