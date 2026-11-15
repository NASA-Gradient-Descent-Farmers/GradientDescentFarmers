import { useZoneData } from '../../hooks/useZoneData.ts'
import { useI18n } from '../../i18n/index.tsx'
import { zoneFor } from '../../lib/environment.ts'
import type { FarmerState, Parcel } from '../state.ts'
import { EnvironmentPanel } from './EnvironmentPanel.tsx'
import { RotationPlant } from './RotationPlant.tsx'
import { DistrictSection } from './DistrictSection.tsx'
import { ZoneNotice } from './ZoneNotice.tsx'

interface Props {
  state: FarmerState
  parcel: Parcel | null
  onGoParcel: () => void
  onAsk: () => void
}

/**
 * Qué sembrar: what the data service published for the place the parcel is in or nearest to, ordered by what the farmer says
 * matters and scaled to their hectares. A place with a rotation run shows its options and its data; one with only an
 * environmental package shows that. The notice says which place the results are from.
 */
export function PlantPage({ state, parcel, onGoParcel, onAsk }: Props) {
  const { t } = useI18n()
  const published = useZoneData()
  const zone = parcel && published ? zoneFor(parcel.point, published) : null

  // the district engine's answer goes under whatever the WOFOST part shows, as a second, separate tool
  const district = zone ? <DistrictSection placeId={zone.id} app={state.situation} mode="tecnico" /> : null

  if (zone?.rotations) {
    return (
      <>
        <RotationPlant zone={zone} rotations={zone.rotations} situation={state.situation} notice={<ZoneNotice point={parcel!.point} />} onAsk={onAsk} />
        <div className="page">{district}</div>
      </>
    )
  }

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

      {parcel && !zone && (
        <p className="loading" role="status">
          <span className="spinner" aria-hidden="true" />
          {t('farmer.plant.loading')}
        </p>
      )}

      {zone && (
        <>
          <ZoneNotice point={parcel!.point} />
          <EnvironmentPanel zone={zone} />
          {district}
          <button type="button" className="btn secondary" onClick={onAsk}>
            {t('farmer.rec.actions.ask')}
          </button>
        </>
      )}
    </div>
  )
}
