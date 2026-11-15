import { useState } from 'react'
import { useI18n } from '../i18n/index.tsx'
import type { LatLon } from '../lib/geo.ts'
import { PinMap, type MapLayer } from './PinMap.tsx'

interface Props {
  value: LatLon | null
  onChange: (point: LatLon) => void
  /** Extra class on the card, e.g. to size the map differently in a question. */
  className?: string
}

/** The map to drop a pin on, with its street / satellite switch, hint and offline notice. */
export function MapCard({ value, onChange, className }: Props) {
  const { t } = useI18n()
  const [layer, setLayer] = useState<MapLayer>('street')
  const [tilesFailed, setTilesFailed] = useState(false)
  return (
    <>
      <div className={`map-card${className ? ` ${className}` : ''}`}>
        <PinMap
          value={value}
          onChange={onChange}
          layer={layer}
          label={t('where.mapLabel')}
          onTilesFailed={setTilesFailed}
        />
        <div className="segmented small map-layers" role="group" aria-label={t('where.layers.label')}>
          {(['street', 'satellite'] as const).map((id) => (
            <button key={id} type="button" aria-pressed={layer === id} onClick={() => setLayer(id)}>
              {t(`where.layers.${id}`)}
            </button>
          ))}
        </div>
        <p className="map-hint">{value ? t('where.hintMove') : t('where.hintPlace')}</p>
        {tilesFailed && (
          <p className="map-offline" role="alert">
            {t('where.offline')}
          </p>
        )}
      </div>
      <p className="help">{t('where.zonesHint')}</p>
    </>
  )
}
