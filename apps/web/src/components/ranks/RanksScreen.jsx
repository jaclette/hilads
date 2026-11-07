import { useEffect, useRef, useState } from 'react'
import { fetchRanks } from '../../api'
import { shortCityName } from '../../i18n/cityName'
import { track } from '../../lib/analytics'
import { thumbUrl } from '../../lib/imageThumb'
import AvatarWithFlag from '../AvatarWithFlag'
import { FlagSticker, themeColor } from '../joy/Joy'
import { getLastToday, useDaily, useDc } from '../daily/dailyShared'
import { shareLink } from '../../lib/shareLink'
import i18n from '../../i18n'
import Icon from '../Icon'
import { themeIcon } from '../../lib/icons'
import { Confetti, FitText, MEDAL, Movement, Podium, RaceBar, RankRow, ScopeToggle, YouBar } from './parts'

const PERIODS = { photos: ['today', 'yesterday', 'week', 'alltime'], players: ['today', 'week', 'alltime'], cities: ['today', 'week', 'alltime'] }
const GOLD = themeColor('sip')

/**
 * RANKS (V6, as in the app), the game hub: 📸 Photos, 🙋 Players, 🌍 Cities,
 * for today, this week or all time (photos: also yesterday's results), in my
 * city or the World. A podium for the top 3, a list with movement since
 * yesterday, a sticky "You" bar. `initial`: {tab, period, scope, cityId} from
 * a deep link, a notification or Passport.
 * Filters (V6.4): the periods as equal chips (no scrolling), then the info line
 * with the scope toggle on its right ("🇻🇳 Saigon | 🌍 World", the header's city;
 * none on Cities); a podium short of 3 shows dashed ghost places leading to Today.
 */
export default function RanksScreen({ header, initial }) {
  const { t } = useDc()
  const { cityId: browsedCity, openToday } = useDaily()
  const [tab, setTab] = useState(initial?.tab ?? 'photos')
  const [period, setPeriod] = useState(initial?.period ?? 'today')
  // The scope follows the city chosen in the header (World without one).
  const [scope, setScope] = useState(initial?.scope ?? 'city')
  const [resp, setResp] = useState(null)
  const [failed, setFailed] = useState(false)
  const cityId = Number(initial?.cityId) || Number(browsedCity) || null
  const cityName = getLastToday()?.city?.name ?? null
  const cityCountry = getLastToday()?.city?.country ?? null
  const scopeNow = cityId ? scope : 'world'
  const key = `${tab}|${period}|${scopeNow}|${cityId}`
  // Each answer is kept with what it was asked for: a view only gets its own shape.
  const data = resp?.key === key ? resp.data : null

  useEffect(() => {
    if (!initial) return
    if (initial.tab) setTab(initial.tab)
    if (initial.period) setPeriod(initial.period)
    if (initial.scope) setScope(initial.scope)
  }, [initial?.at]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!PERIODS[tab].includes(period)) setPeriod('today') }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true
    setFailed(false)
    fetchRanks(tab, { period, scope: scopeNow, cityId })
      .then(d => { if (alive) setResp({ key, data: d }) })
      .catch(() => { if (alive) setFailed(true) })
    track('ranks_viewed', { tab, period, scope: scopeNow, platform_surface: 'web' })
    return () => { alive = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  // The info line (today's photos: the time left to vote), on the left of the scope toggle.
  const endsAt = tab === 'photos' && period === 'today' ? data?.endsAt ?? null : null
  const hours = endsAt ? Math.max(0, Math.floor((endsAt * 1000 - Date.now()) / 3600000)) : null
  const info = hours === null ? '' : hours > 0 ? t('ranks.timeLeft', { count: hours }) : t('ranks.timeLeftMin')
  const showToggle = tab !== 'cities' && !!cityId
  // An empty podium place (as the app): a past period has nobody to call ("Nobody took this spot");
  // today, before I've played: play (Today: the web has no camera); once I've played: invite a
  // friend (my photo's link, else today's challenge).
  const played = !!data?.played
  const tap = (action, go) => () => { track('ranks_ghost_tapped', { tab, period, action, platform_surface: 'web' }); go() }
  const invite = () => {
    const today = getLastToday()
    if (today?.myProof?.id) shareLink({ type: 'proof', path: `/p/${today.myProof.id}`, text: t('worlds.tagline'), source: 'ranks_ghost' })
    else shareLink({ type: 'today', path: '/today', text: i18n.t('shareLink.textToday', { ns: 'common', challenge: today?.challenge?.text ?? '' }), source: 'ranks_ghost' })
  }
  const ghost = (rank) => {
    if (period !== 'today') return { label: t('ranks.ghost.empty'), icon: 'close' }
    if (tab === 'cities') return { label: t('ranks.ghost.city'), icon: 'flag-outline', onClick: tap('today', openToday) }
    if (played) return { label: t('ranks.ghost.invite', { rank }), icon: 'person-add-outline', onClick: tap('invite', invite) }
    return { label: t(tab === 'photos' ? 'ranks.ghost.photo' : 'ranks.ghost.player'), icon: 'camera-outline', onClick: tap('play', openToday) }
  }

  return (
    <div className="full-page full-page--tab r6-page">
      {header && <div className="tab-app-header">{header}</div>}
      <div className="page-body r6-body">
        <div className="r6-controls">
          <div className="leaderboard-seg r6-seg" role="tablist">
            {['photos', 'players', 'cities'].map(k => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={`leaderboard-seg-item${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)}>
                <FitText>{t(`ranks.seg.${k}`)}</FitText>
              </button>
            ))}
          </div>
          {/* The periods: equal chips across the width, no scrolling (nothing hidden off screen). */}
          <div className="r6-chips" role="tablist">
            {PERIODS[tab].map(p => <Chip key={p} on={period === p} onClick={() => setPeriod(p)}><FitText>{t(`ranks.period.${p}`)}</FitText></Chip>)}
          </div>
          {(showToggle || info) && (
            <div className="r6-info-row">
              <span className="r6-info"><FitText min={0.75}>{info}</FitText></span>
              {showToggle && (
                <ScopeToggle value={scope} onChange={setScope} worldLabel={t('ranks.scope.world')} country={cityCountry}
                             city={cityName ? shortCityName(cityName) : t('ranks.scope.city')} />
              )}
            </div>
          )}
        </div>
        {tab === 'photos' && <Photos data={data} failed={failed} period={period} ghost={ghost}
                                     loadMore={(offset) => fetchRanks('photos', { period, scope: scopeNow, cityId, offset })}
                                     focusAt={initial?.focus === 'me' ? initial.at : null} />}
        {tab === 'players' && <Players data={data} failed={failed} period={period} ghost={ghost} />}
        {tab === 'cities' && <Cities data={data} failed={failed} period={period} myCityId={Number(browsedCity) || null} ghost={ghost} />}
      </div>
    </div>
  )
}

function Chip({ on, onClick, children }) {
  return <button type="button" role="tab" aria-selected={on} className={`r6-chip${on ? ' r6-chip--on' : ''}`} style={on ? { background: GOLD.fill, borderColor: GOLD.fill, color: GOLD.onFill } : undefined} onClick={onClick}>{children}</button>
}

function Empty({ text, failed, loading }) {
  const { t } = useDc()
  if (loading) return <div className="r6-empty"><span className="r6-spinner" /></div>
  return <div className="r6-empty"><span className="r6-empty-emoji">{failed ? '📡' : '🏆'}</span><p>{failed ? t('loadFailed') : text}</p></div>
}

const handle = (u) => (u?.username ? `@${u.username}` : u?.displayName ?? '')

function Photos({ data, failed, period, ghost, loadMore, focusAt = null }) {
  const { t } = useDc()
  const { openDaily, account } = useDaily()
  const rows = useRef({})
  const end = useRef(null)
  // Later pages, appended at the end of the list (each photo keeps the rank the server gave it).
  const [more, setMore] = useState(null)
  const [loading, setLoading] = useState(false)
  const extra = more?.base === data ? more : null
  const items = data ? [...(data.items ?? []), ...(extra?.items ?? [])] : []
  const next = extra ? extra.next : data?.nextOffset ?? null
  const proofs = items.map(i => i.proof)
  const open = (list, p) => openDaily('photos', { list, proofId: p.id, source: 'ranks' })
  useEffect(() => {
    const el = end.current
    if (!el || next === null || next === undefined || !data || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting || loading) return
      setLoading(true)
      loadMore(next)
        .then(p => setMore(m => ({ base: data, items: [...(m?.base === data ? m.items : []), ...p.items], next: p.nextOffset ?? null })))
        .catch(() => {})
        .finally(() => setLoading(false))
    }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [next, data, loading]) // eslint-disable-line react-hooks/exhaustive-deps
  // The results card's click (focusAt): my photo's row in view and a burst of confetti, once.
  const [burst, setBurst] = useState(false)
  const handled = useRef(null)
  useEffect(() => {
    if (!focusAt || !data || handled.current === focusAt) return undefined
    handled.current = focusAt
    const mine = data.me
    if (!mine) return undefined
    setBurst(true)
    navigator.vibrate?.([10, 40, 10])
    const id = setTimeout(() => rows.current[mine.proofId]?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 350)
    const end = setTimeout(() => setBurst(false), 2200)
    return () => { clearTimeout(id); clearTimeout(end) }
  }, [focusAt, data])
  if (!data) return <Empty loading={!failed} failed={failed} />

  const top = items.filter(i => i.rank <= 3)
  const rest = items.filter(i => i.rank > 3)
  const podium = top.map(i => ({
    key: i.proof.id, rank: i.rank, label: handle(i.proof.user), value: i.proof.voteCount, format: n => `${n} ❤️`, onClick: () => open(proofs, i.proof),
    lead: <img className="r6-podium-photo" style={{ borderColor: MEDAL[i.rank - 1] }} src={thumbUrl(i.proof.thumbUrl || i.proof.photoUrl)} alt="" loading="lazy" />,
  }))
  // The "You" bar: my best photo of the period and the likes it needs to pass the one above.
  const me = data.me ?? null
  const you = me
    ? me.rank === 1 ? t('ranks.you.photoTop') : t('ranks.you.photo', { rank: me.rank, count: me.gap ?? 1, next: me.rank - 1 })
    : !account || (period === 'today' && !data.played) ? t('ranks.you.none') : t('ranks.you.photoNone')
  const onYou = () => {
    if (!me) return
    const el = rows.current[me.proofId]
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    else { const p = items.find(x => x.proof.id === me.proofId); if (p) open(proofs, p.proof) }
  }
  return (
    <>
      {!items.length && <Empty text={t('ranks.empty.photos')} />}
      {items.length > 0 && <Podium items={podium} ghost={ghost} />}
      {period === 'yesterday' && data.cityBest?.length > 0 && (
        <div className="r6-best">
          <h3>{t('ranks.bestPerCity')}</h3>
          <div className="r6-best-row">
            {data.cityBest.map(({ proof }) => (
              <button key={proof.id} type="button" className="r6-best-card" onClick={() => open(data.cityBest.map(x => x.proof), proof)}>
                <img src={thumbUrl(proof.thumbUrl || proof.photoUrl)} alt="" loading="lazy" />
                <span><FlagSticker country={proof.city?.country} size={18} />{shortCityName(proof.city?.name ?? '')}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="r6-list r6-list--you">
        {rest.map(i => <PhotoRow key={i.proof.id} item={i} week={period === 'week'} mine={me?.proofId === i.proof.id} rowRef={el => { rows.current[i.proof.id] = el }} onClick={() => open(proofs, i.proof)} />)}
        <div ref={end} className="r6-more">{loading && <span className="r6-spinner" />}</div>
      </div>
      <YouBar text={you} onClick={onYou} />
      {burst && <div className="r6-burst"><Confetti run /></div>}
    </>
  )
}

/** A photo from #4: the big rank, the thumbnail, the challenge and its theme, the author, "4 ❤️ · 2 💬" (ties: comments, then the earliest posted). */
function PhotoRow({ item, mine, week, onClick, rowRef }) {
  const p = item.proof
  const theme = p.context?.theme?.key ?? null
  const who = handle(p.user)
  return (
    <button type="button" ref={rowRef} className={`r6-prow${mine ? ' r6-row--mine' : ''}`} onClick={onClick}
            aria-label={`#${item.rank}, ${who}, ${p.voteCount} ❤️, ${p.commentCount ?? 0} 💬`}>
      <span className="r6-prank-box">
        <span className="r6-prank">{item.rank}</span>
        {/* Week: since yesterday (▲2, ▼1, new), when the server sends it. */}
        {week && item.prevRank !== undefined && <Movement rank={item.rank} prevRank={item.prevRank} show />}
      </span>
      <img className="r6-pthumb" src={thumbUrl(p.thumbUrl || p.photoUrl)} alt="" loading="lazy" />
      <span className="r6-pbody">
        {p.context?.text && <span className="r6-ptitle">{p.context.text}</span>}
        {theme && (
          // The theme's text color (light / dark), not its fill: the peach ones (and the retired themes of
          // older challenges, on the special day's peach) vanished on their own tint.
          <span className="r6-pchip" style={{ '--chip-l': themeColor(theme).light, '--chip-d': themeColor(theme).dark }}>
            <Icon name={themeIcon(theme)} size={11} /><span>{p.context.theme.name}</span>
          </span>
        )}
        <span className="r6-pwho">
          <AvatarWithFlag userId={p.user.id} displayName={p.user.displayName ?? p.user.username} photoUrl={p.user.photoUrl} size={18} />
          <span className="r6-pname">{who}</span>
          <FlagSticker country={p.city?.country} size={14} />
        </span>
      </span>
      <span className="r6-pill">{p.voteCount} ❤️ · {p.commentCount ?? 0} 💬</span>
    </button>
  )
}

function Players({ data, failed, period, ghost }) {
  const { t } = useDc()
  const { openProfile } = useDaily()
  const rows = useRef({})
  const entries = data?.entries ?? []
  const me = data?.me ?? null
  const pts = (n) => t('ranks.pts', { count: n })
  if (!data) return <Empty loading={!failed} failed={failed} />
  const podium = entries.slice(0, 3).map(e => ({
    key: e.user.id, rank: e.rank, label: handle(e.user), value: e.points, format: pts, onClick: () => openProfile(e.user.id, e.user.displayName),
    lead: <span className="r6-podium-avatar" style={{ borderColor: MEDAL[e.rank - 1] }}><AvatarWithFlag userId={e.user.id} displayName={e.user.displayName ?? e.user.username} photoUrl={e.user.photoUrl} size={56} /></span>,
  }))
  const you = me ? (me.rank === 1 ? t('ranks.you.top') : t('ranks.you.player', { rank: me.rank, gap: me.gap ?? 0, name: me.next ? handle(me.next) : '' })) : t('ranks.you.none')
  return (
    <>
      {!entries.length && <Empty text={t('ranks.empty.players')} />}
      {entries.length > 0 && <Podium items={podium} ghost={ghost} />}
      <div className="r6-list r6-list--you">
        {entries.slice(3).map(e => (
          <RankRow key={e.user.id} rowRef={el => { rows.current[e.user.id] = el }} rank={e.rank} title={handle(e.user)} value={pts(e.points)} mine={me?.user.id === e.user.id}
                   onClick={() => openProfile(e.user.id, e.user.displayName)}
                   movement={<Movement rank={e.rank} prevRank={e.prevRank} show={period !== 'today'} />}
                   lead={<AvatarWithFlag userId={e.user.id} displayName={e.user.displayName ?? e.user.username} photoUrl={e.user.photoUrl} size={40} />}
                   sub={<>{e.city && <FlagSticker country={e.city.country} size={14} />}<span className={`r6-badge ${e.user.isLocal ? 'r6-badge--local' : ''}`}>{e.user.isLocal ? t('local') : t('traveler')}</span></>} />
        ))}
      </div>
      <YouBar text={you} onClick={() => me && rows.current[me.user.id]?.scrollIntoView({ block: 'center', behavior: 'smooth' })} />
    </>
  )
}

function Cities({ data, failed, period, myCityId, ghost }) {
  const { t } = useDc()
  const { openDaily } = useDaily()
  const rows = useRef({})
  const entries = data?.entries ?? []
  const mine = data?.mine ?? null
  if (!data) return <Empty loading={!failed} failed={failed} />
  const leader = entries[0]?.photos ?? 1
  const name = (c) => shortCityName(c.name)
  const openCity = (c) => (period === 'today' ? openDaily('stories', { city: c.id, source: 'ranks' }) : openDaily('countries', { country: c.country, source: 'ranks' }))
  const line = mine ? (mine.rank === 1 ? t('ranks.city.lineTop', { city: name(mine.city) })
    : t('ranks.city.line', { city: name(mine.city), rank: mine.rank, count: mine.gap ?? 1, next: mine.next ? shortCityName(mine.next.name) : '' })) : null
  const podium = entries.slice(0, 3).map(e => ({
    key: String(e.city.id), rank: e.rank, label: name(e.city), value: e.photos, format: n => t('today.proofs', { count: n }),
    lead: <FlagSticker country={e.city.country} size={52} />, onClick: () => openCity(e.city),
  }))
  return (
    <>
      {line && <p className="r6-fun">{mine && <FlagSticker country={mine.city.country} size={22} />}<span>{line}</span></p>}
      {!entries.length && <Empty text={t('ranks.empty.cities')} />}
      {entries.length > 0 && <Podium items={podium} ghost={ghost} />}
      <div className="r6-list r6-list--you">
        {entries.map((e, i) => (
          <RankRow key={e.city.id} rowRef={el => { rows.current[e.city.id] = el }} rank={e.rank} title={name(e.city)} value={t('today.proofs', { count: e.photos })}
                   mine={e.city.id === myCityId} onClick={() => openCity(e.city)}
                   movement={<Movement rank={e.rank} prevRank={e.prevRank} show={period !== 'today'} />}
                   lead={<FlagSticker country={e.city.country} size={34} />}
                   sub={<>{t('mosaic.players', { count: e.players })} · {e.likes} ❤️</>}
                   extra={<RaceBar ratio={e.photos / Math.max(1, leader)} color={e.city.id === myCityId ? 'var(--cta)' : GOLD.fill} delay={Math.min(i, 8) * 60} />} />
        ))}
      </div>
      {mine && (
        <YouBar text={mine.rank === 1 ? t('ranks.city.lineTop', { city: name(mine.city) })
          : t('ranks.city.youBar', { city: name(mine.city), rank: mine.rank, count: mine.gap ?? 1, next: mine.next ? shortCityName(mine.next.name) : '' })}
                onClick={() => rows.current[mine.city.id]?.scrollIntoView({ block: 'center', behavior: 'smooth' })} />
      )}
    </>
  )
}
