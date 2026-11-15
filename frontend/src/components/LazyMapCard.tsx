import { lazy, Suspense, type ComponentProps } from 'react'
import { useI18n } from '../i18n/index.tsx'
import type { MapCard as MapCardComponent } from './MapCard.tsx'

// The map library is large: it is fetched only when a map is opened, which keeps the first screens light on slow connections.
const MapCard = lazy(() => import('./MapCard.tsx').then((module) => ({ default: module.MapCard })))

/** The map, loaded on demand: a short "loading" line shows while it arrives. */
export function LazyMapCard(props: ComponentProps<typeof MapCardComponent>) {
  const { t } = useI18n()
  return (
    <Suspense
      fallback={
        <p className="help" role="status">
          {t('farmer.parcel.place.mapLoading')}
        </p>
      }
    >
      <MapCard {...props} />
    </Suspense>
  )
}
