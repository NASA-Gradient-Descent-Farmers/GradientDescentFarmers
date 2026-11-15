import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import { INSIDE_KM } from '../lib/coverage.ts'
import { DEMO_LOCATIONS } from '../lib/demoLocations.ts'
import type { LatLon } from '../lib/geo.ts'

export type MapLayer = 'street' | 'satellite'

// Street map: OpenStreetMap. Satellite: NASA GIBS "Blue Marble Next Generation" (about 500 m per pixel, so it
// is for seeing the land around, while the street map is for finding the exact spot).
const STREET = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  options: { maxZoom: 17, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
}
const SATELLITE = {
  url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
  options: { maxNativeZoom: 8, maxZoom: 11, attribution: 'Imagery &copy; NASA EOSDIS GIBS' },
}
/** The map opens on the predetermined places, with room around them. */
const PLACES_BOUNDS = L.latLngBounds(DEMO_LOCATIONS.map((place) => [place.latitude, place.longitude] as [number, number]))
const TILE_ERRORS_BEFORE_GIVING_UP = 6

/** A teardrop pin in the brand orange with a leaf cut out of it. */
const PIN_ICON = L.divIcon({
  className: 'cv-pin-holder',
  html: `<div class="cv-pin"><svg viewBox="0 0 40 52" width="40" height="52" aria-hidden="true">
    <path d="M20 50C20 50 4 33 4 20a16 16 0 0 1 32 0c0 13-16 30-16 30z" fill="#c4582e" stroke="#111111" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M20 31C13 29 12 21 15 14c8 1 12 6 10 13z" fill="#ffffff"/>
    <path d="M20 31c1-5 2-9 4-13" stroke="#c4582e" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  </svg></div>`,
  iconSize: [40, 52],
  iconAnchor: [20, 50],
})

interface Props {
  value: LatLon | null
  onChange: (point: LatLon) => void
  layer: MapLayer
  label: string
  onTilesFailed: (failed: boolean) => void
}

const toLatLon = ({ lat, lng }: L.LatLng): LatLon => ({ lat, lon: lng })

export function PinMap({ value, onChange, layer, label, onTilesFailed }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const marker = useRef<L.Marker | null>(null)
  const tiles = useRef<L.TileLayer | null>(null)
  const latest = useRef({ onChange, onTilesFailed })
  useEffect(() => {
    latest.current = { onChange, onTilesFailed }
  })

  // The map itself, the predetermined places and the ways to place the pin.
  useEffect(() => {
    const element = host.current
    if (!element) return
    const instance = L.map(element, { zoomControl: true, minZoom: 3, worldCopyJump: true })
    instance.fitBounds(PLACES_BOUNDS, { padding: [40, 40] })
    // each predetermined place: the area its data covers, and a point with its name that places the pin when tapped
    for (const place of DEMO_LOCATIONS) {
      L.circle([place.latitude, place.longitude], {
        radius: INSIDE_KM * 1000,
        color: '#ad4b25',
        weight: 2,
        dashArray: '6 6',
        fillColor: '#c4582e',
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(instance)
      L.circleMarker([place.latitude, place.longitude], { radius: 8, color: '#111111', weight: 2.5, fillColor: '#ffffff', fillOpacity: 1, bubblingMouseEvents: false })
        .bindTooltip(place.name, { permanent: true, direction: 'right', offset: [10, 0], className: 'cv-site-tip' })
        .on('click', () => latest.current.onChange({ lat: place.latitude, lon: place.longitude }))
        .addTo(instance)
    }
    instance.on('click', (e: L.LeafletMouseEvent) => latest.current.onChange(toLatLon(e.latlng)))
    // From the keyboard: arrows move the map, Enter drops the pin at its centre.
    const dropAtCentre = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.target === instance.getContainer()) latest.current.onChange(toLatLon(instance.getCenter()))
    }
    instance.getContainer().addEventListener('keydown', dropAtCentre)
    map.current = instance
    return () => {
      instance.getContainer().removeEventListener('keydown', dropAtCentre)
      instance.remove()
      map.current = null
      marker.current = null
      tiles.current = null
    }
  }, [])

  // The tile layer: swapped when the visitor changes layer.
  useEffect(() => {
    const instance = map.current
    if (!instance) return
    const source = layer === 'street' ? STREET : SATELLITE
    const tileLayer = L.tileLayer(source.url, source.options).addTo(instance)
    let errors = 0
    let loaded = 0
    latest.current.onTilesFailed(false)
    tileLayer.on('tileload', () => {
      loaded++
      if (loaded === 1) latest.current.onTilesFailed(false)
    })
    tileLayer.on('tileerror', () => {
      errors++
      if (loaded === 0 && errors >= TILE_ERRORS_BEFORE_GIVING_UP) latest.current.onTilesFailed(true)
    })
    instance.setMaxZoom(source.options.maxZoom)
    tiles.current = tileLayer
    return () => {
      tileLayer.remove()
      tiles.current = null
    }
  }, [layer])

  // The pin follows `value`; a pin set from outside the map (or off screen) brings the map to it.
  useEffect(() => {
    const instance = map.current
    if (!instance) return
    if (!value) {
      marker.current?.remove()
      marker.current = null
      return
    }
    const at: L.LatLngExpression = [value.lat, value.lon]
    if (!marker.current) {
      const pin = L.marker(at, { icon: PIN_ICON, draggable: true, title: label }).addTo(instance)
      pin.on('dragend', () => latest.current.onChange(toLatLon(pin.getLatLng())))
      marker.current = pin
    } else {
      marker.current.setLatLng(at)
    }
    if (!instance.getBounds().pad(-0.15).contains(at) || instance.getZoom() < 6) instance.flyTo(at, Math.max(instance.getZoom(), 9))
    // Restart the drop animation of the pin.
    const el = marker.current.getElement()?.querySelector('.cv-pin')
    if (el) {
      el.classList.remove('drop')
      void (el as HTMLElement).offsetWidth
      el.classList.add('drop')
    }
  }, [value, label])

  return <div className="pin-map" ref={host} role="application" aria-label={label} tabIndex={0} />
}
