import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../../i18n/index.tsx'
import { loadPlaces, searchPlaces, type IndexedPlace, type Place } from '../places.ts'
import { PinIcon, SearchIcon } from './glyphs.tsx'

/** Search by municipality, on the phone: the list ships with the app, so nothing the farmer types is sent anywhere. */
export function PlaceSearch({ onPick }: { onPick: (place: Place) => void }) {
  const { t } = useI18n()
  const [index, setIndex] = useState<IndexedPlace[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let alive = true
    loadPlaces().then(
      (loaded) => alive && setIndex(loaded),
      () => alive && setFailed(true),
    )
    return () => {
      alive = false
    }
  }, [])

  const results = useMemo(() => (index ? searchPlaces(index, query) : []), [index, query])
  const typed = query.trim().length >= 2

  return (
    <div className="place-search">
      <label htmlFor="place-query" className="field-label">
        {t('farmer.parcel.place.searchLabel')}
      </label>
      <div className="input-wrap">
        <SearchIcon />
        <input
          id="place-query"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('farmer.parcel.place.searchPlaceholder')}
          aria-describedby="place-help"
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="search"
        />
      </div>
      <p id="place-help" className="help">
        {t('farmer.parcel.place.searchHelp')}
      </p>
      {failed && (
        <p className="callout is-error" role="alert">
          {t('farmer.parcel.place.placesError')}
        </p>
      )}
      {!index && !failed && (
        <p className="help" role="status">
          {t('farmer.parcel.place.loadingPlaces')}
        </p>
      )}
      {index && typed && results.length === 0 && (
        <p className="help" role="status">
          {t('farmer.parcel.place.noResults')}
        </p>
      )}
      {results.length > 0 && (
        <ul className="place-list">
          {results.map((place) => (
            <li key={`${place.state}-${place.municipality}`}>
              <button type="button" onClick={() => onPick(place)}>
                <PinIcon />
                <span>
                  <strong>{place.municipality}</strong>
                  <span>{place.state}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
