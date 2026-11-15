import { useZoneData } from '../../hooks/useZoneData.ts'
import { useI18n } from '../../i18n/index.tsx'
import { zoneFor } from '../../lib/environment.ts'
import type { LatLon } from '../../lib/geo.ts'
import { InfoIcon } from './glyphs.tsx'

/**
 * Which place the pin's results come from, in words and an icon: its own place when the pin is inside the area a place's data
 * covers, otherwise the nearest place, named with its distance. It says nothing until the published files have loaded.
 */
export function ZoneNotice({ point }: { point?: LatLon | null }) {
  const { t, distance } = useI18n()
  const published = useZoneData()
  if (!point || !published) return null
  const zone = zoneFor(point, published)
  if (!zone) return null
  const key = zone.exact ? (zone.rotations ? 'notice' : 'noticeEnvironment') : 'nearest'
  const where = zone.exact && zone.rotations?.municipality ? t('near.notice.where', { municipality: zone.rotations.municipality }) : ''
  return (
    <div className="callout zone-near" role="status">
      <span className="callout-icon">
        <InfoIcon />
      </span>
      <div>
        <strong>{t(`near.${key}.title`)}</strong>
        <p>{t(`near.${key}.body`, { km: distance(zone.km), place: zone.name, where })}</p>
      </div>
    </div>
  )
}
