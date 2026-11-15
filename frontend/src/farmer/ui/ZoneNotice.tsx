import { useZoneData } from '../../hooks/useZoneData.ts'
import { useI18n } from '../../i18n/index.tsx'
import type { LatLon } from '../../lib/geo.ts'
import { nearZone } from '../../lib/environment.ts'
import type { Zone } from '../recommend.ts'
import { InfoIcon, WarnIcon } from './glyphs.tsx'

/**
 * Whether the model applies where the parcel is, in words and an icon: the model was fitted with Texcoco fields only, and
 * being close does not make it right. A parcel near a point the rotations service has run (given as `point`) is told that
 * instead, because that is what the app will show for it.
 */
export function ZoneNotice({ zone, point }: { zone: Zone | null; point?: LatLon | null }) {
  const { t, distance } = useI18n()
  const published = useZoneData()
  const site = point && published ? nearZone(point, published) : null
  if (site?.rotations) {
    const where = site.rotations.municipality ? t('near.notice.where', { municipality: site.rotations.municipality }) : ''
    return (
      <div className="callout zone-near" role="status">
        <span className="callout-icon">
          <InfoIcon />
        </span>
        <div>
          <strong>{t('near.notice.title')}</strong>
          <p>{t('near.notice.body', { km: distance(site.km), place: site.name, where })}</p>
        </div>
      </div>
    )
  }
  const key = zone?.key ?? 'pending'
  const status = zone?.status ?? 'unknown'
  const planner = (
    <div className={`callout zone-${status}`} role="status">
      <span className="callout-icon">{status === 'inside' ? <InfoIcon /> : <WarnIcon />}</span>
      <div>
        <strong>{t(`farmer.zone.${key}.title`)}</strong>
        <p>{t(`farmer.zone.${key}.body`, { km: distance(zone?.km ?? 0) })}</p>
      </div>
    </div>
  )
  // data from the environmental package but no rotation results here: say what exists, then what the planner says
  if (site?.environment) {
    return (
      <>
        <div className="callout zone-near" role="status">
          <span className="callout-icon">
            <InfoIcon />
          </span>
          <div>
            <strong>{t('near.noticeEnvironment.title')}</strong>
            <p>{t('near.noticeEnvironment.body', { km: distance(site.km), place: site.name })}</p>
          </div>
        </div>
        {planner}
      </>
    )
  }
  return planner
}
