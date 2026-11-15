import { useI18n } from '../../i18n/index.tsx'
import type { Zone } from '../recommend.ts'
import { InfoIcon, WarnIcon } from './glyphs.tsx'

/** Whether the model applies where the parcel is, in words and an icon: the model was fitted with Texcoco fields only, and being close does not make it right. */
export function ZoneNotice({ zone }: { zone: Zone | null }) {
  const { t, distance } = useI18n()
  const key = zone?.key ?? 'pending'
  const status = zone?.status ?? 'unknown'
  return (
    <div className={`callout zone-${status}`} role="status">
      <span className="callout-icon">{status === 'inside' ? <InfoIcon /> : <WarnIcon />}</span>
      <div>
        <strong>{t(`farmer.zone.${key}.title`)}</strong>
        <p>{t(`farmer.zone.${key}.body`, { km: distance(zone?.km ?? 0) })}</p>
      </div>
    </div>
  )
}
