import { useZoneData } from '../../hooks/useZoneData.ts'
import { useI18n } from '../../i18n/index.tsx'
import { nearestDemoLocation } from '../../lib/demoLocations.ts'
import { nearZone } from '../../lib/environment.ts'
import type { LatLon } from '../../lib/geo.ts'
import { InfoIcon, WarnIcon } from './glyphs.tsx'

/**
 * What exists for the parcel's pin, in words and an icon: rotation results and data for a place the data service has run,
 * only data for one it has not run the rotation model for, or nothing, with the nearest place that has some. It says
 * nothing until the published files have loaded.
 */
export function ZoneNotice({ point }: { point?: LatLon | null }) {
  const { t, distance } = useI18n()
  const published = useZoneData()
  if (!point || !published) return null
  const site = nearZone(point, published)
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
  if (site?.environment) {
    return (
      <div className="callout zone-near" role="status">
        <span className="callout-icon">
          <InfoIcon />
        </span>
        <div>
          <strong>{t('near.noticeEnvironment.title')}</strong>
          <p>{t('near.noticeEnvironment.body', { km: distance(site.km), place: site.name })}</p>
        </div>
      </div>
    )
  }
  const nearest = nearestDemoLocation(point)
  return (
    <div className="callout zone-outside" role="status">
      <span className="callout-icon">
        <WarnIcon />
      </span>
      <div>
        <strong>{t('near.noData.title')}</strong>
        <p>{t('near.noData.body', { place: nearest.place.name, km: distance(nearest.km) })}</p>
      </div>
    </div>
  )
}
