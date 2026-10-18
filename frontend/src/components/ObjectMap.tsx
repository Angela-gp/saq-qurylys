import { useEffect, useMemo, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import { divIcon } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useTranslation } from 'react-i18next'
import { HousingObject } from '../api'
import { formatNumber } from '../i18n'

function MapViewport({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (!points.length) return
    const frame = requestAnimationFrame(() => {
      map.invalidateSize({ animate: false, pan: false })
      if (points.length === 1) {
        map.setView(points[0], 13, { animate: false })
        return
      }
      map.fitBounds(points, { padding: [48, 48], maxZoom: 14, animate: false })
    })
    return () => cancelAnimationFrame(frame)
  }, [map, points])
  return null
}
function MapSizeInvalidator() {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()
    let frame = 0
    const invalidate = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => map.invalidateSize({ animate: false, pan: false }))
    }
    const observer = new ResizeObserver(invalidate)
    observer.observe(container)
    window.addEventListener('resize', invalidate)
    invalidate()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', invalidate)
    }
  }, [map])
  return null
}
function ThemeMapTiles() {
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark')
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.dataset.theme === 'dark'))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return <TileLayer
    attribution={dark ? '&copy; OpenStreetMap contributors &copy; CARTO' : '&copy; OpenStreetMap'}
    url={dark ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'}
  />
}

export default function ObjectMap({ mappableObjects, selectedId, hoveredId, onSelect }: { mappableObjects: HousingObject[]; selectedId: number | null; hoveredId: number | null; onSelect: (id: number) => void }) {
  const { t } = useTranslation()
  const mapPoints = useMemo(() => mappableObjects.map(object => [object.latitude!, object.longitude!] as [number, number]), [mappableObjects])
  return (
            <MapContainer center={[49.96, 82.61]} zoom={12} scrollWheelZoom className="overview-leaflet-map">
              <MapSizeInvalidator />
              <MapViewport points={mapPoints} />
              <ThemeMapTiles />
              {mappableObjects.map((object) => (
                <Marker
                  key={object.id}
                  position={[object.latitude!, object.longitude!]}
                  icon={divIcon({
                    className: 'zone-marker-icon',
                    html: `<span class="map-score-marker ${object.is_demo || object.score.factors.length ? `zone-${object.score.zone}` : 'zone-neutral'} ${selectedId === object.id ? 'selected' : ''} ${hoveredId === object.id ? 'hovered' : ''}">${object.is_demo || object.score.factors.length ? formatNumber(object.score.score) : '—'}${object.is_demo ? `<sup title="${t('common.demoTooltip')}">●</sup>` : ''}</span>`,
                    iconSize: [38, 38],
                    iconAnchor: [19, 19],
                  })}
                  eventHandlers={{ click: () => onSelect(object.id) }}
                >
                  <Popup>
                    <strong>{object.name.replace(/^ДЕМО\s*[·•]\s*/i, '')}</strong>
                    <br />{object.is_demo || object.score.factors.length ? `${formatNumber(object.score.score)} ${t('common.points')} · ${t(`zone.${object.score.zone}`)}` : t('common.notEvaluated')}
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
  )
}
