import { useEffect, useState } from 'react'
import { fetchVenue } from '../api'
import { cityFlag } from '../cityMeta'
import BackButton from './BackButton'

const CATEGORY_META = {
  bar:  { emoji: '🍻', label: 'Bar / pub' },
  cafe: { emoji: '☕', label: 'Coffee shop' },
}

function venueSlug(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

function formatHour(hhmm) {
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h)) return hhmm
  const period = h < 12 ? 'AM' : 'PM'
  const h12    = h === 0 ? 12 : (h > 12 ? h - 12 : h)
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`
}

function formatUpdated(unix) {
  if (!unix) return ''
  const d = new Date(unix * 1000)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

export default function VenueScreen({ venueId, onBack, onOpenCity }) {
  const [venue, setVenue] = useState(null)
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'not-found' | 'error'

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    fetchVenue(venueId)
      .then(v => {
        if (cancelled) return
        if (v === null) setStatus('not-found')
        else { setVenue(v); setStatus('ready') }
      })
      .catch(() => { if (!cancelled) setStatus('error') })
    return () => { cancelled = true }
  }, [venueId])

  if (status === 'loading') {
    return (
      <div className="full-page venue-screen">
        <div className="venue-loading">Loading…</div>
      </div>
    )
  }
  if (status === 'not-found') {
    return (
      <div className="full-page venue-screen">
        <BackButton onClick={onBack} />
        <div className="venue-empty">
          <p>This venue isn't on Hilads.</p>
        </div>
      </div>
    )
  }
  if (status === 'error' || !venue) {
    return (
      <div className="full-page venue-screen">
        <BackButton onClick={onBack} />
        <div className="venue-empty">
          <p>Couldn't load this venue. Please try again.</p>
        </div>
      </div>
    )
  }

  const meta    = CATEGORY_META[venue.category] ?? CATEGORY_META.cafe
  const opens   = formatHour(venue.hours?.opens)
  const closes  = formatHour(venue.hours?.closes)
  const updated = formatUpdated(venue.updated_at)

  return (
    <div className="full-page venue-screen">
      <BackButton onClick={onBack} />

      <nav className="venue-breadcrumb" aria-label="Breadcrumb">
        <a
          href={`/city/${venue.city.slug}`}
          onClick={(e) => { e.preventDefault(); onOpenCity(venue.city); }}
        >
          {cityFlag(venue.city.country)} {venue.city.name}
        </a>
        <span aria-hidden="true"> › </span>
        <span aria-current="page">{venue.name}</span>
      </nav>

      <header className="venue-header">
        <div className="venue-category" aria-hidden="true">{meta.emoji}</div>
        <h1 className="venue-name">{venue.name}</h1>
        <p className="venue-type">{meta.label} in {venue.city.name}</p>
      </header>

      <section className="venue-section">
        <h2 className="venue-section-title">Address</h2>
        <p className="venue-address">{venue.address}</p>
      </section>

      <section className="venue-section">
        <h2 className="venue-section-title">Hours</h2>
        <p className="venue-hours">Open every day · {opens} – {closes}</p>
      </section>

      <section className="venue-section venue-cta">
        <p>See who's around in {venue.city.name} right now.</p>
        <button
          type="button"
          className="venue-cta-btn"
          onClick={() => onOpenCity(venue.city)}
        >
          Open {venue.city.name}
        </button>
      </section>

      {updated && (
        <p className="venue-updated">Last updated {updated}</p>
      )}
    </div>
  )
}
