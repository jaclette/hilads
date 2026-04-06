/**
 * LocationPicker — full-screen map modal for location confirmation before sharing.
 *
 * UX flow:
 *   1. Opens centered on user's GPS coords
 *   2. User drags map to adjust — pin stays fixed in center
 *   3. Reverse geocodes the map center (debounced, 500ms)
 *   4. User taps "Share this spot" → onConfirm({ place, address })
 *
 * Uses Leaflet + OpenStreetMap tiles (no API key needed).
 * Nominatim for reverse geocoding (same as existing spot logic).
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

// ── Internal: captures map moveend and forwards center coords ─────────────────

function MapCenterTracker({ onMoveEnd }) {
  const map = useMapEvents({
    moveend: () => {
      const c = map.getCenter()
      onMoveEnd(c.lat, c.lng)
    },
  })
  return null
}

// ── Reverse geocode via Nominatim ─────────────────────────────────────────────

async function reverseGeocode(lat, lng) {
  const resp = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=en`,
    { headers: { 'User-Agent': 'Hilads/1.0' } },
  )
  if (!resp.ok) throw new Error('Nominatim failed')
  const data = await resp.json()
  const addr = data.address ?? {}

  // Place name: prefer POI name > district > neighbourhood > city
  const place = addr.amenity
    ?? addr.shop
    ?? addr.tourism
    ?? addr.building
    ?? addr.quarter
    ?? addr.neighbourhood
    ?? addr.suburb
    ?? addr.city_district
    ?? addr.district
    ?? addr.town
    ?? addr.city
    ?? data.display_name?.split(',')[0]
    ?? ''

  // Human address: road + neighbourhood/quarter + city
  const addressParts = [
    addr.road,
    addr.house_number ? undefined : undefined, // street number is already in road
    addr.quarter ?? addr.neighbourhood ?? addr.suburb,
    addr.city ?? addr.town,
  ].filter(Boolean)
  const address = addressParts.join(', ')

  return { place, address }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function LocationPicker({ initialLat, initialLng, nickname, onConfirm, onClose }) {
  const [place,   setPlace]   = useState('')
  const [address, setAddress] = useState('')
  const [geocoding, setGeocoding] = useState(true)
  const debounceRef = useRef(null)
  // Track current center for the confirm callback
  const centerRef = useRef({ lat: initialLat, lng: initialLng })

  const geocodeCenter = useCallback(async (lat, lng) => {
    centerRef.current = { lat, lng }
    setGeocoding(true)
    try {
      const result = await reverseGeocode(lat, lng)
      setPlace(result.place)
      setAddress(result.address)
    } catch (e) {
      console.error('[loc-picker] geocode failed:', e)
    } finally {
      setGeocoding(false)
    }
  }, [])

  // Initial geocode on mount
  useEffect(() => {
    geocodeCenter(initialLat, initialLng)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleMoveEnd(lat, lng) {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => geocodeCenter(lat, lng), 600)
  }

  function handleConfirm() {
    const label = place || address || 'your spot'
    onConfirm({ place: label, address, lat: centerRef.current.lat, lng: centerRef.current.lng })
  }

  return (
    <div className="loc-picker-overlay">
      <div className="loc-picker">

        {/* ── Header ── */}
        <div className="loc-picker-header">
          <span className="loc-picker-title">Where are you? 👀</span>
          <button className="loc-picker-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* ── Map ── */}
        <div className="loc-picker-map-wrap">
          <MapContainer
            center={[initialLat, initialLng]}
            zoom={16}
            style={{ width: '100%', height: '100%' }}
            zoomControl={false}
            attributionControl={false}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />
            <MapCenterTracker onMoveEnd={handleMoveEnd} />
          </MapContainer>

          {/* Fixed pin — stays centered, map moves underneath */}
          <div className="loc-picker-pin" aria-hidden="true">📍</div>

          {/* Drag hint */}
          <div className="loc-picker-hint">Move the map to adjust</div>
        </div>

        {/* ── Footer: address + actions ── */}
        <div className="loc-picker-footer">
          <div className="loc-picker-address-card">
            {geocoding ? (
              <span className="loc-picker-geocoding">Getting location…</span>
            ) : (
              <>
                <span className="loc-picker-place">{place || 'Your location'}</span>
                {address && <span className="loc-picker-addr">{address}</span>}
              </>
            )}
          </div>

          <button
            className="loc-picker-confirm"
            onClick={handleConfirm}
            disabled={geocoding}
          >
            Share this spot
          </button>
          <button className="loc-picker-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>

      </div>
    </div>
  )
}
