import { useEffect, useRef, useState } from 'react'
import { fetchRanks } from '../../api'
import { shortCityName } from '../../i18n/cityName'
import { track } from '../../lib/analytics'
import { thumbUrl } from '../../lib/imageThumb'
import AvatarWithFlag from '../AvatarWithFlag'
import { FlagSticker, themeColor } from '../joy/Joy'
import { getLastToday, useDaily, useDc } from '../daily/dailyShared'
import { MEDAL, MEDAL_EMOJI, Movement, Podium, RaceBar, RankRow, YouBar } from './parts'

const PERIODS = { photos: ['today', 'yesterday', 'week', 'alltime'], players: ['today', 'week', 'alltime'], cities: ['today', 'week', 'alltime'] }
const GOLD = themeColor('sip')

/**
 * RANKS (V6, as in the app), the game hub: 📸 Photos, 🙋 Players, 🌍 Cities,
 * for today, this week or all time (photos: also yesterday's results), in my
 * city or the World. A podium for the top 3, a list with movement since
 * yesterday, a sticky "You" bar. `initial`: {tab, period, scope, cityId} from
 * a deep link, a notification or Passport.
 */
export default function RanksScreen({ header, initial }) {
  const { t } = useDc()
  const { cityId: browsedCity } = useDaily()
  const [tab, setTab] = useState(initial?.tab ?? 'photos')
  const [period, setPeriod] = useState(initial?.period ?? 'today')
  const [scope, setScope] = useState(initial?.scope ?? 'world')
  const [resp, setResp] = useState(null)
  const [failed, setFailed] = useState(false)
  const cityId = Number(initial?.cityId) || Number(browsedCity) || null
  const cityName = getLastToday()?.city?.name ?? null
  const key = `${tab}|${period}|${scope}|${cityId}`
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
    fetchRanks(tab, { period, scope, cityId })
      .then(d => { if (alive) setResp({ key, data: d }) })
      .catch(() => { if (alive) setFailed(true) })
    track('ranks_viewed', { tab, period, scope, platform_surface: 'web' })
    return () => { alive = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="full-page full-page--tab r6-page">
      {header && <div className="tab-app-header">{header}</div>}
      <div className="page-body r6-body">
        <div className="r6-controls">
          <div className="leaderboard-seg r6-seg" role="tablist">
            {['photos', 'players', 'cities'].map(k => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={`leaderboard-seg-item${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)}>
                {t(`ranks.seg.${k}`)}
              </button>
            ))}
          </div>
          <div className="r6-chips">
            {PERIODS[tab].map(p => <Chip key={p} on={period === p} onClick={() => setPeriod(p)}>{t(`ranks.period.${p}`)}</Chip>)}
            {tab !== 'cities' && <span className="r6-sep" />}
            {tab !== 'cities' && ['city', 'world'].map(s => (
              <Chip key={s} on={scope === s} onClick={() => setScope(s)}>
                {s === 'city' ? (cityName ? shortCityName(cityName) : t('ranks.scope.city')) : t('ranks.scope.world')}
              </Chip>
            ))}
          </div>
        </div>
        {tab === 'photos' && <Photos data={data} failed={failed} period={period} />}
        {tab === 'players' && <Players data={data} failed={failed} period={period} />}
        {tab === 'cities' && <Cities data={data} failed={failed} period={period} myCityId={Number(browsedCity) || null} />}
      </div>
    </div>
  )
}

function Chip({ on, onClick, children }) {
  return <button type="button" className={`r6-chip${on ? ' r6-chip--on' : ''}`} style={on ? { background: GOLD.fill, borderColor: GOLD.fill, color: GOLD.onFill } : undefined} onClick={onClick}>{children}</button>
}

function Empty({ text, failed, loading }) {
  const { t } = useDc()
  if (loading) return <div className="r6-empty"><span className="r6-spinner" /></div>
  return <div className="r6-empty"><span className="r6-empty-emoji">{failed ? '📡' : '🏆'}</span><p>{failed ? t('loadFailed') : text}</p></div>
}

const handle = (u) => (u?.username ? `@${u.username}` : u?.displayName ?? '')

function Photos({ data, failed, period }) {
  const { t } = useDc()
  const { openDaily } = useDaily()
  const items = data?.items ?? []
  const proofs = items.map(i => i.proof)
  const open = (list, p) => openDaily('photos', { list, proofId: p.id, source: 'ranks' })
  const hours = data?.endsAt ? Math.max(0, Math.floor((data.endsAt * 1000 - Date.now()) / 3600000)) : null
  const grid = period === 'week' || period === 'alltime'
  const podium = items.slice(0, 3).map(i => ({
    key: i.proof.id, rank: i.rank, label: handle(i.proof.user), value: i.proof.voteCount, format: n => `${n} ❤️`, onClick: () => open(proofs, i.proof),
    lead: <img className="r6-podium-photo" style={{ borderColor: MEDAL[i.rank - 1] }} src={thumbUrl(i.proof.thumbUrl || i.proof.photoUrl)} alt="" loading="lazy" />,
  }))
  if (!data) return <Empty loading={!failed} failed={failed} />
  return (
    <>
      {period === 'today' && hours !== null && <p className="r6-banner">{hours > 0 ? t('ranks.timeLeft', { count: hours }) : t('ranks.timeLeftMin')}</p>}
      {!items.length && <Empty text={t('ranks.empty.photos')} />}
      {items.length > 0 && !grid && <Podium items={podium} />}
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
      {grid ? (
        <div className="r6-hof">
          {items.map(i => (
            <button key={i.proof.id} type="button" className="r6-hof-item" onClick={() => open(proofs, i.proof)} aria-label={`#${i.rank}, ${i.proof.voteCount} ❤️`}>
              <img src={thumbUrl(i.proof.thumbUrl || i.proof.photoUrl)} alt="" loading="lazy" />
              {i.rank <= 3 && <span className="r6-hof-medal">{MEDAL_EMOJI[i.rank - 1]}</span>}
              <span className="r6-hof-likes">{i.proof.voteCount} ❤️</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="r6-list">
          {items.slice(3).map(i => (
            <RankRow key={i.proof.id} rank={i.rank} value={`${i.proof.voteCount} ❤️`} onClick={() => open(proofs, i.proof)} title={handle(i.proof.user)}
                     lead={<img className="r6-row-photo" src={thumbUrl(i.proof.thumbUrl || i.proof.photoUrl)} alt="" loading="lazy" />}
                     sub={<><FlagSticker country={i.proof.city?.country} size={14} />{shortCityName(i.proof.city?.name ?? '')}</>} />
          ))}
        </div>
      )}
    </>
  )
}

function Players({ data, failed, period }) {
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
      {entries.length > 0 && <Podium items={podium} />}
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

function Cities({ data, failed, period, myCityId }) {
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
      {entries.length > 0 && <Podium items={podium} />}
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
