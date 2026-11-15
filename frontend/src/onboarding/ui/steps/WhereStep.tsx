import { useState } from 'react'
import { MapCard } from '../../../components/MapCard.tsx'
import { ZoneNotice } from '../../../farmer/ui/ZoneNotice.tsx'
import { useI18n } from '../../../i18n/index.tsx'
import { DEMO_LOCATIONS } from '../../../lib/demoLocations.ts'
import type { LatLon } from '../../../lib/geo.ts'
import { StepFrame } from '../frame.tsx'
import { useDraft } from '../hooks.ts'
import type { StepProps } from './types.ts'

/** "¿Dónde piensas sembrar?": a pin on the map, as before, with NASA's climate there and an honest verdict. */
export function WhereStep({ pin, drafts, position, onPin }: StepProps & { onPin: (point: LatLon) => void }) {
  const { t, coords } = useI18n()
  const [point, setPoint] = useDraft<LatLon | null>(drafts, 'where', () => pin)
  const [locating, setLocating] = useState(false)
  const [geoProblem, setGeoProblem] = useState<'unsupported' | 'denied' | 'failed' | null>(null)

  const locate = () => {
    if (!('geolocation' in navigator)) return setGeoProblem('unsupported')
    setGeoProblem(null)
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPoint({ lat: position.coords.latitude, lon: position.coords.longitude })
        setLocating(false)
      },
      (error) => {
        setGeoProblem(error.code === error.PERMISSION_DENIED ? 'denied' : 'failed')
        setLocating(false)
      },
      { timeout: 10000 },
    )
  }

  return (
    <StepFrame
      position={position}
      title={t('onboarding.steps.where.title')}
      help={t('onboarding.steps.where.help')}
      onSubmit={() => point && onPin(point)}
      submitDisabled={!point}
      notice={geoProblem ? <p className="ob-problem" role="alert">{t(`onboarding.where.geo.${geoProblem}`)}</p> : null}
      wide
    >
      <div className="ob-where">
        <MapCard value={point} onChange={setPoint} />
        <div className="ob-where-side">
          <div className="ob-pinline">
            <button type="button" className="chip-button" onClick={locate} disabled={locating}>
              {locating ? t('onboarding.where.locating') : t('onboarding.where.locate')}
            </button>
            {DEMO_LOCATIONS.map((place) => (
              <button key={place.id} type="button" className="chip-button" onClick={() => setPoint({ lat: place.latitude, lon: place.longitude })}>
                {t('where.inPlace', { place: place.name })}
              </button>
            ))}
          </div>
          {point ? (
            <>
              <p className="ob-coords">{coords(point)}</p>
              <ZoneNotice point={point} />
            </>
          ) : (
            <p className="ob-muted">{t('where.noPin')}</p>
          )}
          <p className="ob-muted small">{t('where.privacy')}</p>
        </div>
      </div>
    </StepFrame>
  )
}
