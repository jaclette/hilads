import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { countryToFlag } from '../lib/countryFlag'
import { fetchChallengeShowcase } from '../api'
import ShowcasePreviewModal from './ShowcasePreviewModal'

const TYPE_ICON = { food: '🍜', place: '📍', culture: '🎭', help: '🤝' }
const MAX = 6
const EVERY = 3000

function Slide({ item, onOpen }) {
  const { t } = useTranslation('challenge')
  const intl     = item.mode === 'international'
  const icon     = TYPE_ICON[item.challenge_type] ?? '🔥'
  const fromFlag = countryToFlag(item.country)
  const toFlag   = countryToFlag(item.target_country)
  const hasProof = item.proof_media_url && item.proof_media_type === 'image'
  const cityLabel = intl
    ? [item.city_name, item.target_city_name].filter(Boolean).join(' → ')
    : item.city_name

  return (
    <button type="button" className="showcase-hero-slide" onClick={onOpen}>
      {hasProof && <img className="showcase-hero-img" src={item.proof_media_url} alt="" />}
      <div className={`showcase-hero-overlay${hasProof ? '' : ' showcase-hero-overlay--flat'}`}>
        <div className="showcase-hero-top">
          <span className={`showcase-hero-pill ${intl ? 'showcase-hero-pill--intl' : 'showcase-hero-pill--local'}`}>
            {intl ? `${fromFlag || '🌐'} → ${toFlag || '🌍'}` : `${fromFlag || '📍'} ${t('showcase.localTag')}`}
          </span>
          <span className="showcase-hero-star">★ {item.avg_stars.toFixed(1)}</span>
        </div>
        <div>
          <div className="showcase-hero-title">{icon} {item.title}</div>
          <div className="showcase-hero-meta">
            {t('showcase.by', { name: item.creator_display_name ?? '?' })}{cityLabel ? ` · ${cityLabel}` : ''}
          </div>
        </div>
      </div>
    </button>
  )
}

function HowItWorksSlide({ onOpen }) {
  const { t } = useTranslation('challenge')
  return (
    <button type="button" className="showcase-hero-slide showcase-hero-slide--howto" onClick={onOpen}>
      <div className="showcase-hero-howto">
        <div className="showcase-hero-howto-emoji">💡</div>
        <div className="showcase-hero-howto-title">{t('howItWorks')}</div>
        <div className="showcase-hero-howto-sub">{t('tabIntro')}</div>
        <div className="showcase-hero-howto-cta">{t('howItWorks')} →</div>
      </div>
    </button>
  )
}

/**
 * Hero carousel at the top of the Challenges tab. Recent success challenges
 * (global, proof-first) followed by a "How it works" slide that is ALWAYS
 * present - even in a city with no success stories yet, so newcomers always
 * have an explainer entry point. Auto-advances every 3s, pauses on swipe.
 */
export default function ShowcaseHero({ onTry, onOpenProfile, onSeeAll, onHowItWorks }) {
  const { t } = useTranslation('challenge')
  const [items,   setItems]   = useState([])
  const [index,   setIndex]   = useState(0)
  const [preview, setPreview] = useState(null)
  const trackRef = useRef(null)
  const paused   = useRef(false)

  // +1 for the trailing How-it-works slide.
  const total = items.length + 1

  useEffect(() => {
    let alive = true
    fetchChallengeShowcase({ limit: MAX }).then(res => { if (alive) setItems(res.items ?? []) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (total < 2) return
    const id = setInterval(() => {
      const track = trackRef.current
      if (!track || paused.current) return
      const w = track.clientWidth
      const next = (Math.round(track.scrollLeft / w) + 1) % total
      track.scrollTo({ left: next * w, behavior: 'smooth' })
    }, EVERY)
    return () => clearInterval(id)
  }, [total])

  const onScroll = () => {
    const track = trackRef.current
    if (!track) return
    setIndex(Math.round(track.scrollLeft / track.clientWidth))
  }

  return (
    <div className="showcase-hero">
      {items.length > 0 && (
        <div className="showcase-hero-head">
          <span className="showcase-hero-head-title">✨ {t('showcase.cta')}</span>
          <button type="button" className="showcase-hero-seeall" onClick={onSeeAll}>{t('seeAll')} ›</button>
        </div>
      )}

      <div
        className="showcase-hero-track"
        ref={trackRef}
        onScroll={onScroll}
        onPointerDown={() => { paused.current = true }}
        onPointerUp={() => { paused.current = false }}
        onPointerLeave={() => { paused.current = false }}
      >
        {items.map(it => <Slide key={it.id} item={it} onOpen={() => setPreview(it)} />)}
        <HowItWorksSlide key="__howto__" onOpen={onHowItWorks} />
      </div>

      {total > 1 && (
        <div className="showcase-hero-dots">
          {Array.from({ length: total }).map((_, i) => (
            <span key={i} className={`showcase-hero-dot${i === index ? ' showcase-hero-dot--on' : ''}`} />
          ))}
        </div>
      )}

      <ShowcasePreviewModal
        item={preview}
        onClose={() => setPreview(null)}
        onTry={(it) => { setPreview(null); onTry(it) }}
        onAvatar={onOpenProfile}
      />
    </div>
  )
}
