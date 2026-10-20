import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { shortCityName } from '../../i18n/cityName'
import { track } from '../../lib/analytics'
import { shareLink } from '../../lib/shareLink'
import { deviceStore, themeName } from '../map/spotsShared'
import { openAppModal } from '../AppModal'
import { CityFlag } from '../CityName'
import Icon from '../Icon'
import { plain } from '../joy/Joy'
import { RankMedal, useDc } from './dailyShared'
import { AnswerChip, BackHomeBlock, useMoney } from './compareShared'

const SLIDE_MS = 6000

/**
 * Yesterday around the world on the web (SPEC 10.7): the full-screen story of
 * a tour. Click or tap to advance (the left third goes back), Esc or swipe
 * down to close; the last slide shows today's challenge and the app's store.
 * Readable without an account; a slide's proof can be shared (its link).
 */
export default function WorldTourViewer({ tour, start = 0, source = 'today', onClose }) {
  const { t } = useDc()
  const money = useMoney()
  const [index, setIndex] = useState(start)
  const [paused, setPaused] = useState(false)
  const seen = useRef(new Set())
  const touch = useRef(null)
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const slides = tour.slides
  const total = slides.length + 1
  const last = index >= slides.length

  useEffect(() => { track('world_tour_opened', { source, start, platform_surface: 'web' }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (seen.current.has(index)) return
    seen.current.add(index)
    if (index < slides.length) track('world_tour_slide_viewed', { city: slides[index].city.name, index, date: tour.date, platform_surface: 'web' })
    else track('world_tour_completed', { date: tour.date, cities: slides.length, platform_surface: 'web' })
  }, [index]) // eslint-disable-line react-hooks/exhaustive-deps

  const go = (next) => {
    if (next < 0) return
    if (next >= total) { onClose(); return }
    setIndex(next)
  }
  // Auto-advance (not on the last slide, while held, or with reduced motion).
  useEffect(() => {
    if (last || paused || reduce) return
    const timer = setTimeout(() => go(index + 1), SLIDE_MS)
    return () => clearTimeout(timer)
  }, [index, paused]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') go(index + 1)
      if (e.key === 'ArrowLeft') go(index - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index]) // eslint-disable-line react-hooks/exhaustive-deps

  const slide = last ? null : slides[index]
  const proof = slide?.proof
  const theme = tour.challenge.theme ? themeName(tour.challenge.theme.key, { special: tour.challenge.special, city: slide?.city.name }) : ''
  const price = proof?.price && !proof.backHome ? money.price(proof.price) : null
  const today = tour.today
  const store = deviceStore()
  const tap = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    go(e.clientX - r.left < r.width / 3 ? index - 1 : index + 1)
  }

  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-label={plain(t('tour.title'))}
         onTouchStart={(e) => { touch.current = e.touches[0].clientY; setPaused(true) }}
         onTouchEnd={(e) => { setPaused(false); if (touch.current !== null && e.changedTouches[0].clientY - touch.current > 80) onClose(); touch.current = null }}>
      {slide ? <img className="tour-photo" src={proof.photoUrl} alt={proof.caption || ''} />
        : today?.coverUrl ? <img className="tour-photo" src={today.coverUrl} alt="" /> : null}
      <div className="tour-shade" />
      <button type="button" className="tour-tap" onClick={tap} onMouseDown={() => setPaused(true)} onMouseUp={() => setPaused(false)}
              aria-label={t('tour.next')} />
      <div className="tour-top">
        <div className="tour-bars">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className="tour-bar">
              <span className={`tour-bar-fill${i < index || (i === index && (last || reduce)) ? ' tour-bar-fill--done' : ''}${i === index && !last && !reduce ? ' tour-bar-fill--run' : ''}`}
                    style={i === index && paused ? { animationPlayState: 'paused' } : undefined} key={`${i}-${index}`} />
            </span>
          ))}
        </div>
        <div className="tour-head">
          {slide && (
            <div className="tour-city">
              <CityFlag country={slide.city.country} size={24} />
              <span>
                <strong>{shortCityName(slide.city.name)}</strong>
                <small>{t('tour.kicker', { theme })}</small>
              </span>
              {slide.podium && <RankMedal rank={slide.podium} size={28} />}
            </div>
          )}
          <button type="button" className="tour-close" onClick={onClose} aria-label={t('tour.close')}><Icon name="close" size={22} /></button>
        </div>
      </div>
      {slide ? (
        <div className="tour-bottom">
          {proof.answer && !proof.backHome && <AnswerChip answer={proof.answer} onDark />}
          <p className="tour-meta">{[price?.main, t(`tour.moment.${slide.moment}`), proof.user.username ? `@${proof.user.username}` : null].filter(Boolean).join('  ·  ')}</p>
          {proof.caption && <p className="tour-caption">{proof.caption}</p>}
          {proof.backHome && <BackHomeBlock proof={proof} />}
          <div className="tour-actions">
            <span className="tour-tagline">{t('worlds.tagline')}</span>
            <button type="button" className="tour-share" aria-label={t('share.shareProof')} onClick={() => {
              track('world_tour_shared', { city: slide.city.name, date: tour.date, platform_surface: 'web' })
              shareLink({ type: 'proof', path: `/p/${proof.id}`, text: t('worlds.tagline'), source: 'world_tour' })
            }}><Icon name="share-social-outline" size={20} /></button>
          </div>
        </div>
      ) : (
        <div className="tour-bottom tour-turn">
          <p className="tour-turn-title">{t('tour.yourTurn')}</p>
          {today && <p className="tour-turn-text">{t('tour.todayIs', { question: today.compare?.question ?? today.text })}</p>}
          {today?.isActive && (
            <button type="button" className="today-cta"
               onClick={() => { track('web_today_take_clicked', { store: store ?? 'ios', surface: 'world_tour' }); openAppModal({ action: 'play', surface: 'world_tour' }) }}>
              <Icon name="camera-outline" size={20} />{t('ctaAnswerNoCity')}
            </button>
          )}
          <button type="button" className="tour-link" onClick={onClose}>{t('tour.close')}</button>
        </div>
      )}
    </div>,
    document.getElementById('root') ?? document.body,
  )
}
