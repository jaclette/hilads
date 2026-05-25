import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { fetchVenue } from '../api'
import { cityFlag } from '../cityMeta'
import BackButton from './BackButton'

const CATEGORY_META = {
  bar:  { emoji: '🍻' },
  cafe: { emoji: '☕' },
}

function venueSlug(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

function formatHour(hhmm) {
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h)) return hhmm
  const opts = { hour: 'numeric' }
  if (m) opts.minute = '2-digit'
  return new Date(2000, 0, 1, h, m || 0).toLocaleTimeString(i18n.language, opts)
}

function formatUpdated(unix) {
  if (!unix) return ''
  const d = new Date(unix * 1000)
  return d.toLocaleDateString(i18n.language, { year: 'numeric', month: 'long', day: 'numeric' })
}

export default function VenueScreen({ venueId, onBack, onOpenCity }) {
  const { t } = useTranslation('venue')
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
        <div className="venue-loading">{t('loading')}</div>
      </div>
    )
  }
  if (status === 'not-found') {
    return (
      <div className="full-page venue-screen">
        <BackButton onClick={onBack} />
        <div className="venue-empty">
          <p>{t('notFound')}</p>
        </div>
      </div>
    )
  }
  if (status === 'error' || !venue) {
    return (
      <div className="full-page venue-screen">
        <BackButton onClick={onBack} />
        <div className="venue-empty">
          <p>{t('loadError')}</p>
        </div>
      </div>
    )
  }

  const categoryKey = CATEGORY_META[venue.category] ? venue.category : 'cafe'
  const meta    = CATEGORY_META[categoryKey]
  const opens   = formatHour(venue.hours?.opens)
  const closes  = formatHour(venue.hours?.closes)
  const updated = formatUpdated(venue.updated_at)

  return (
    <div className="full-page venue-screen">
      <BackButton onClick={onBack} />

      <nav className="venue-breadcrumb" aria-label={t('breadcrumb')}>
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
        <p className="venue-type">{t('typeInCity', { category: t(`category.${categoryKey}`), city: venue.city.name })}</p>
      </header>

      <section className="venue-section">
        <h2 className="venue-section-title">{t('address')}</h2>
        <p className="venue-address">{venue.address}</p>
      </section>

      <section className="venue-section">
        <h2 className="venue-section-title">{t('hours')}</h2>
        <p className="venue-hours">{t('openEveryDay', { opens, closes })}</p>
      </section>

      <section className="venue-section venue-cta">
        <p>{t('ctaText', { city: venue.city.name })}</p>
        <button
          type="button"
          className="venue-cta-btn"
          onClick={() => onOpenCity(venue.city)}
        >
          {t('openCity', { city: venue.city.name })}
        </button>
      </section>

      {updated && (
        <p className="venue-updated">{t('lastUpdated', { date: updated })}</p>
      )}
    </div>
  )
}
