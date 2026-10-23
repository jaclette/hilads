import { useEffect, useState } from 'react'
import { fetchDailyTodayCountries, fetchDailyTour } from '../../api'
import { shortCityName } from '../../i18n/cityName'
import { track } from '../../lib/analytics'
import { useBackLayer } from '../../lib/backLayers'
import { thumbFallback } from '../../lib/thumbFallback'
import { openAppModal } from '../AppModal'
import Icon from '../Icon'
import { FlagSticker, themeColor } from '../joy/Joy'
import { answerText } from '../daily/compareShared'
import { compareCountryGroups, rememberCountries } from '../daily/countryOrder'
import { RankMedal, seedProofs, useDaily, useDc, useHere, useVoteCount } from '../daily/dailyShared'
import { hasUnseen, useSeen } from '../daily/seen'
import WorldTourViewer from '../daily/WorldTour'

const MOSAIC_MAX = 6

/**
 * Today's photos by country, right under the hero (the app's TodayCountries,
 * one request: GET /daily/today/countries):
 * - the stories row, "[n] countries played today": a circle per country (its
 *   flag, the city under it), ringed in today's theme color while one of its
 *   photos is unseen; then "+ Your city". A circle opens Today's photos at
 *   that country, the next countries following.
 * - the mosaic, "Same challenge. Different worlds.": up to 6 countries in the
 *   shared order (my country first, then the most voted), each with its top
 *   photo, its answer large and its votes; "See all" opens every country's
 *   photos. "Represent your city" (the app, photos are posted there) fills the
 *   free slot of an odd grid, else a banner under it.
 * Players' photos only (never a Hilads pick).
 */
export default function TodayCountries({ today }) {
  const { t } = useDc()
  const { openDaily } = useDaily()
  const here = useHere()
  useSeen()
  const [data, setData] = useState(null)
  const challenge = today?.challenge ?? null
  const cityId = here?.id ?? today?.city?.id ?? null

  useEffect(() => {
    if (!challenge) return
    let alive = true
    fetchDailyTodayCountries({ cityId }).then(d => {
      if (!alive) return
      seedProofs(d.items.map(i => i.top), !!challenge.isActive)
      rememberCountries(d)
      setData(d)
    }).catch(() => {})
    return () => { alive = false }
  }, [challenge?.id, cityId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!challenge || !data) return null
  const mine = (here?.country ?? today?.city?.country ?? '').toUpperCase()
  // Stories: my country, then unseen, then the most recent (refreshed as photos get seen here).
  const stories = [...data.items].sort((a, b) =>
    Number(b.country === mine) - Number(a.country === mine) || Number(hasUnseen(b)) - Number(hasUnseen(a)) || b.latestAt - a.latestAt)
  const tiles = [...data.items].sort((a, b) => compareCountryGroups(a, b, mine)).slice(0, MOSAIC_MAX)
  const theme = themeColor(challenge.special ? 'special' : challenge.theme?.key)
  const ring = theme.line ?? theme.fill
  const myProof = today?.myProof ?? null
  const canPlay = challenge.isActive && !myProof
  const play = () => { track('today_countries_play', { has_photos: data.items.length > 0, platform_surface: 'web' }); openAppModal({ action: 'play', surface: 'today_countries' }) }
  const represent = (
    <>
      <span className="tc-camera"><Icon name="camera-outline" size={24} /></span>
      <span className="tc-represent-text">{t('countries.represent')}</span>
    </>
  )

  return (
    <div className="tc">
      {data.items.length > 0 && (
        <div className="tc-block">
          <p className="tc-title">{t('countries.played', { count: data.items.length })}</p>
          <div className="tc-stories">
            {stories.map(g => {
              const unseen = hasUnseen(g)
              return (
                <button key={g.country} type="button" className="tc-story" aria-label={t('countries.openCountry', { city: shortCityName(g.city.name) })}
                        onClick={() => { track('today_countries_story', { country: g.country, unseen, platform_surface: 'web' }); openDaily('photos', { country: g.country, source: 'today_stories' }) }}>
                  <span className="tc-ring" style={{ borderColor: unseen ? ring : 'var(--line)' }}><span className="tc-inner"><FlagSticker country={g.country} size={42} /></span></span>
                  <span className={`tc-story-name${unseen ? '' : ' tc-story-name--seen'}`}>{shortCityName(g.city.name)}</span>
                </button>
              )
            })}
            {(canPlay || myProof) && (
              <button type="button" className="tc-story" onClick={() => (myProof ? openDaily('photos', { proofId: myProof.id, source: 'today_stories' }) : play())}>
                <span className="tc-ring tc-ring--mine"><Icon name={myProof ? 'checkmark' : 'add'} size={26} /></span>
                <span className="tc-story-name">{t('countries.yourCity')}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {(data.items.length > 0 || canPlay) && (
        <div className="tc-block">
          <div className="today-card-head">
            <span className="tc-title">{t('worlds.tagline')}</span>
            {data.items.length > 0 && <button type="button" className="dc-link" onClick={() => openDaily('countries', { source: 'today_mosaic' })}>{t('today.seeAll')}</button>}
          </div>
          {data.items.length === 0 && <p className="dc-muted">{t('countries.emptyBody')}</p>}
          <div className="tc-grid">
            {tiles.map(g => <Tile key={g.country} group={g} onOpen={() => { track('today_countries_tile', { country: g.country, platform_surface: 'web' }); openDaily('photos', { proofId: g.top.id, source: 'today_mosaic' }) }} />)}
            {canPlay && tiles.length % 2 === 1 && <button type="button" className="tc-tile tc-represent" onClick={play}>{represent}</button>}
          </div>
          {canPlay && tiles.length % 2 === 0 && <button type="button" className="tc-banner" onClick={play}>{represent}<Icon name="chevron-forward" size={18} /></button>}
        </div>
      )}
    </div>
  )
}

/** A mosaic tile: the country's top photo, its flag and city, its answer (else the caption) large, its votes. */
function Tile({ group, onOpen }) {
  const { i18n } = useDc()
  const p = group.top
  const votes = useVoteCount(p)
  const line = p.answer && !p.backHome ? answerText(p.answer, i18n.language) : p.caption ?? p.spot?.name ?? p.place?.name ?? ''
  return (
    <button type="button" className="tc-tile" onClick={onOpen} aria-label={[shortCityName(group.city.name), line, votes].join(', ')}>
      <img className="tc-photo" src={p.thumbUrl || p.photoUrl} onError={thumbFallback(p.photoUrl)} alt="" loading="lazy" />
      <span className="tc-tile-body">
        <span className="tc-city"><FlagSticker country={group.country} size={16} />{shortCityName(group.city.name)}</span>
        <span className="tc-answer">{line}</span>
        <span className="tc-votes"><Icon name="heart-outline" size={14} />{votes}</span>
      </span>
    </button>
  )
}

/**
 * Yesterday's recap, one card (the app's TodayTour): the winning photo
 * (yesterday's #1, else the most voted), "Yesterday", the question, the
 * winner's flag, city and answer, how many cities played; "Watch" and the
 * card open yesterday's tour at the winner.
 */
export function YesterdayRecap({ today }) {
  const { t, i18n } = useDc()
  const [tour, setTour] = useState(null)
  const [open, setOpen] = useState(null)
  useBackLayer(open !== null, () => setOpen(null))
  const cityId = today?.city?.id ?? null
  const loaded = !!today
  useEffect(() => {
    if (!loaded) return
    let alive = true
    fetchDailyTour(cityId, i18n.language).then(r => { if (alive) setTour(r) }).catch(() => {})
    return () => { alive = false }
  }, [loaded, cityId, i18n.language])
  const slides = tour?.slides ?? []
  if (!tour || slides.length === 0) return null
  let at = slides.findIndex(s => s.podium === 1)
  if (at < 0) at = slides.reduce((best, s, i) => (s.proof.voteCount > slides[best].proof.voteCount ? i : best), 0)
  const win = slides[at]
  const answer = win.proof.answer && !win.proof.backHome ? answerText(win.proof.answer, i18n.language) : null
  const question = tour.challenge.compare?.question ?? tour.challenge.text
  const watch = () => setOpen(at)
  return (
    <div className="today-card">
      <div className="today-card-head">
        <span className="today-card-title">{t('recap.label')}</span>
        <button type="button" className="dc-link" onClick={watch}>{t('tour.watch')}</button>
      </div>
      <button type="button" className="tc-recap" onClick={watch}>
        <span className="tc-recap-photo">
          <img src={win.proof.thumbUrl || win.proof.photoUrl} onError={thumbFallback(win.proof.photoUrl)} alt="" loading="lazy" />
          {win.podium === 1 && <span className="tc-recap-medal"><RankMedal rank={1} size={22} /></span>}
        </span>
        <span className="tc-recap-body">
          <span className="tc-recap-q">{question}</span>
          <span className="tc-city"><FlagSticker country={win.city.country} size={16} />{shortCityName(win.city.name)}{answer && <span className="tc-recap-answer"> · {answer}</span>}</span>
          <span className="dc-muted">{t('recap.cities', { count: slides.length })}</span>
        </span>
      </button>
      {open !== null && <WorldTourViewer tour={tour} start={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
