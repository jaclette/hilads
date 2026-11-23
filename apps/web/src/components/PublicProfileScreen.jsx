import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { shortCityName } from '../i18n/cityName'
import {
  fetchPublicProfile, fetchUserDaily, fetchProfileCard, fetchUserPhotos, fetchUserDuels, fetchUserFriends, fetchUserEvents,
  sendFriendRequest, acceptFriendRequest, cancelFriendRequest, removeFriend, submitReport, fetchReportStatus, DuplicateReportError, submitBlock,
} from '../api'
import BackButton from './BackButton'
import Icon from './Icon'
import AvatarWithFlag from './AvatarWithFlag'
import { FlagSticker, themeColor } from './joy/Joy'
import { RankMedal } from './daily/dailyShared'
import { CityPage, PioneerBadges, SpecialStamps } from './passport/PassportScreen'
import { SeasonMedals } from './passport/ScoringCards'
import { themeName } from './map/spotsShared'
import { useBackLayer } from '../lib/backLayers'
import { track } from '../lib/analytics'

/**
 * A player's profile, the "mini Passport" (as the app's features/profile/PlayerProfile,
 * docs/mockups/hilads_profile_mockup.html): the wavy cover, who they are, this season, stamps,
 * photos (best first), you vs them, plans they host; Message and the friendship in a sticky bar,
 * report / block in the ⋯ menu. `preview`: my own profile as others see it.
 */
export default function PublicProfileScreen({ userId, account, onBack, onSendDm, onOpenPhotos, preview = false }) {
  const { t } = useTranslation('publicProfile')
  const tp = (k, o) => t(`p2.${k}`, o)
  const isSelf = account?.id === userId
  const showActions = !preview && !isSelf && !!account
  const [user, setUser] = useState(null)
  const [stats, setStats] = useState(null)
  const [card, setCard] = useState(null)
  const [friends, setFriends] = useState(null)
  const [plans, setPlans] = useState([])
  const [failed, setFailed] = useState(null)
  const [friendState, setFriendState] = useState('none')
  const [reqId, setReqId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState(false)
  const [report, setReport] = useState(false)
  const [reported, setReported] = useState(false)
  const [reason, setReason] = useState('')
  const [sheet, setSheet] = useState(null)   // 'photos' | 'duels'
  useBackLayer(menu || report || sheet !== null, () => { setMenu(false); setReport(false); setSheet(null) })

  const load = useCallback(() => {
    setFailed(null)
    fetchPublicProfile(userId).then(({ user: u }) => {
      setUser(u)
      if (u.isFriend) { setFriendState('friend'); setReqId(null) }
      else if (u.pendingFriendRequest) { setFriendState(u.pendingFriendRequest.direction === 'outgoing' ? 'pending_out' : 'pending_in'); setReqId(u.pendingFriendRequest.id) }
      else { setFriendState('none'); setReqId(null) }
    }).catch(() => setFailed('gone'))
    fetchUserDaily(userId, i18n.language).then(setStats).catch(() => {})
    fetchProfileCard(userId).then(setCard).catch(() => {})
    fetchUserFriends(userId, { page: 1, limit: 1 }).then(f => setFriends(f.total ?? null)).catch(() => {})
    fetchUserEvents(userId).then(r => {
      const now = Date.now() / 1000
      const evs = r?.events ?? r ?? []
      setPlans(evs.filter(e => e.created_by === userId && (e.ends_at ?? e.starts_at) > now).slice(0, 3))
    }).catch(() => {})
    if (showActions) fetchReportStatus({ targetUserId: userId }).then(r => setReported(!!r?.reported)).catch(() => {})
    track('viewed_profile', { self: isSelf, preview, platform_surface: 'web' })
  }, [userId, showActions, isSelf, preview])
  useEffect(() => { load() }, [load])

  const handle = user?.username ? `@${user.username}` : user?.displayName ?? ''
  const run = async (fn) => { setBusy(true); try { await fn() } catch { /* unchanged */ } finally { setBusy(false) } }
  const friendPress = () => {
    if (!user || busy) return
    if (friendState === 'friend') { if (window.confirm(t('actions.unfriend') + ' ' + handle + '?')) run(async () => { await removeFriend(user.id); setFriendState('none') }) }
    else if (friendState === 'pending_out') { if (window.confirm(t('actions.cancelRequest') + '?')) run(async () => { if (reqId) await cancelFriendRequest(reqId); setFriendState('none'); setReqId(null) }) }
    else if (friendState === 'pending_in') run(async () => { if (reqId) await acceptFriendRequest(reqId); setFriendState('friend'); setReqId(null) })
    else run(async () => {
      const r = await sendFriendRequest(user.id)
      if (r.friend) { setFriendState('friend'); setReqId(null) } else if (r.request) { setFriendState('pending_out'); setReqId(r.request.id) }
    })
  }
  const block = async () => {
    setMenu(false)
    if (!user || !window.confirm(i18n.t('blockTitle', { ns: 'dm', name: handle, defaultValue: `Block ${handle}?` }))) return
    try { await submitBlock({ targetUserId: user.id, targetNickname: user.displayName }); onBack() } catch { /* stays */ }
  }
  const sendReport = async () => {
    if (reason.trim().length < 10) return
    try { await submitReport({ reason, targetUserId: userId, targetNickname: user?.displayName }); setReported(true); setReport(false) }
    catch (e) { if (e instanceof DuplicateReportError) { setReported(true); setReport(false) } }
  }

  if (failed) {
    return (
      <div className="full-page pp2">
        <div className="pp2-nav"><BackButton onClick={onBack} /></div>
        <div className="pp2-empty pp2-empty--page"><p className="pp2-empty-title">{tp('goneTitle')}</p><p className="dc-muted">{tp('goneBody')}</p>
          <button type="button" className="today-cta btn-primary" onClick={load}>{tp('retry')}</button></div>
      </div>
    )
  }

  const home = stats?.homeCity ?? null
  const cityName = home?.name ? shortCityName(home.name) : user?.currentCity ? shortCityName(user.currentCity) : null
  const cityCountry = home?.country ?? user?.currentCityCountry ?? null
  const streak = stats?.currentStreak ?? 0
  const since = stats?.memberSince ? new Date(stats.memberSince * 1000).toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' }) : null
  const photos = card?.photos?.items ?? []
  const passes = [...(stats?.localPassProgress ?? [])].sort((a, b) => Number(b.earned) - Number(a.earned) || b.done - a.done)
  const pass = passes[0] ?? null
  const openPhoto = (list, id) => onOpenPhotos?.(list, id)
  const duels = card?.duels ?? null

  return (
    <div className="full-page pp2">
      <div className="pp2-scroll">
        <div className="pp2-cover">
          <svg viewBox="0 0 330 26" preserveAspectRatio="none" aria-hidden="true"><path d="M0 18 C60 28 110 2 170 8 C230 13 270 26 330 12 L330 27 L0 27Z" /></svg>
        </div>
        <div className="pp2-nav">
          <BackButton onClick={onBack} />
          {preview && <span className="pp2-preview"><Icon name="eye-outline" size={14} />{tp('previewBanner')}</span>}
          {showActions && <button type="button" className="pp2-navbtn" aria-label={t('actions.reportTitle')} onClick={() => setMenu(true)}><Icon name="ellipsis-horizontal" size={20} /></button>}
        </div>

        <div className="pp2-head">
          <div className="pp2-avatar">
            {user ? <AvatarWithFlag userId={user.id} displayName={user.displayName} photoUrl={user.avatarUrl ?? user.thumbAvatarUrl} size={86} /> : <span className="pp2-skel pp2-skel--av" />}
            {card?.crown && <span className="pp2-crown" role="img" aria-label={tp('crownA11y')}>👑</span>}
          </div>
          {user ? <h1 className="pp2-name">{handle}</h1> : <span className="pp2-skel pp2-skel--name" />}
          <div className="pp2-tags">
            {cityName && <span className="pp2-tag"><FlagSticker country={cityCountry} size={16} />{cityName}</span>}
            {user?.mode && <span className={`pp2-tag${user.mode === 'local' ? ' pp2-tag--local' : ''}`}>{i18n.t(user.mode === 'local' ? 'dc.local' : 'dc.traveler', { ns: 'challenge', defaultValue: user.mode === 'local' ? 'Local' : 'Traveler' })}</span>}
            {streak > 0 && <span className="pp2-tag">🔥 {i18n.t('dc.streak', { ns: 'challenge', count: streak })}</span>}
          </div>
          {since && <p className="pp2-since">{tp('since', { date: since })}</p>}
          {friends > 0 && <p className="pp2-since">{tp('friends', { count: friends })}</p>}
          {stats?.invitedBy && <p className="pp2-since">{i18n.t('pp.crew.invitedBy', { ns: 'profile', name: stats.invitedBy.username ? '@' + stats.invitedBy.username : stats.invitedBy.displayName ?? '' })}</p>}
        </div>

        <div className="pp2-body">
          <div className="pp2-stats">
            {[[stats?.photos, 'photos'], [stats?.likesReceived, 'likes'], [card?.wins, 'wins']].map(([v, k]) => (
              <div key={k} className="pp2-stat">{v !== undefined && v !== null ? <b>{v}</b> : <span className="pp2-skel pp2-skel--num" />}<span>{tp(k, { count: v ?? 0 })}</span></div>
            ))}
          </div>

          {card && (card.season.city || card.season.world) && (<>
            <h2 className="pp2-h">{card.season.pre ? tp('preSeason') : tp('season')}</h2>
            <div className="pp2-ranks">
              {card.season.city && <div className="pp2-rank pp2-rank--city"><b>#{card.season.city.rank}</b><div>{tp('inCity', { city: shortCityName(card.season.city.city.name ?? '') })}<span><FlagSticker country={card.season.city.city.country} size={12} /> {i18n.t('dc.ranks.pts', { ns: 'challenge', count: card.season.city.points })}</span></div></div>}
              {card.season.world && <div className="pp2-rank pp2-rank--world"><b>#{card.season.world.rank}</b><div>{tp('world')}<span>🌍 {i18n.t('dc.ranks.pts', { ns: 'challenge', count: card.season.world.points })}</span></div></div>}
            </div>
          </>)}

          {pass && pass.done > 0 && (<>
            <h2 className="pp2-h">{tp('stamps')}<small>{tp('stampsOf', { done: pass.done, total: pass.total, city: shortCityName(pass.city.name ?? '') })}</small></h2>
            <CityPage cityName={shortCityName(pass.city.name ?? '')} country={pass.city.country} themes={pass.themes} stamps={pass.stamps} total={pass.total} earned={pass.earned} todayTheme={null} tomorrowTheme={null} />
          </>)}
          {(stats?.specialStamps?.length ?? 0) > 0 && <SpecialStamps stamps={stats.specialStamps} />}
          {(stats?.pioneerOf?.length ?? 0) > 0 && <PioneerBadges pioneers={stats.pioneerOf} />}
          {(stats?.seasonMedals?.length ?? 0) > 0 && <SeasonMedals medals={stats.seasonMedals} />}

          <h2 className="pp2-h">{tp('photosTitle')}
            {card && card.photos.total > photos.length && <button type="button" className="pp2-more" onClick={() => setSheet('photos')}>{tp('seeAll', { n: card.photos.total })}</button>}</h2>
          {!card ? <div className="pp2-grid">{[0, 1, 2].map(i => <span key={i} className="pp2-skel pp2-skel--tile" />)}</div>
            : photos.length === 0 ? (
              <div className="pp2-empty"><span aria-hidden="true">📸</span><p className="pp2-empty-title">{isSelf ? tp('noPhotosSelf') : tp('noPhotos', { name: handle })}</p><p className="dc-muted">{tp('noPhotosText')}</p></div>
            ) : <PhotoGrid items={photos} onOpen={(id) => openPhoto(photos.map(p => p.proof), id)} tp={tp} />}

          {!isSelf && !preview && duels && (<>
            <h2 className="pp2-h">{tp('vsTitle', { name: handle })}{duels.total > 0 && <small>{tp('duels', { count: duels.total })}</small>}</h2>
            {duels.total === 0 ? <div className="pp2-empty"><p className="dc-muted">{tp('noDuels')}</p></div> : (
              <div className="pp2-vs">
                <div className="pp2-score" aria-label={tp('scoreA11y', { me: duels.me, them: duels.them, name: handle })}>
                  <b>{duels.me}</b><span>{tp('you')}</span><u>VS</u><span>{handle}</span><b>{duels.them}</b>
                </div>
                {duels.duels.map(d => <DuelRow key={d.date} duel={d} onOpen={() => openPhoto([d.mine, d.theirs], d.mine.id)} />)}
                {duels.total > duels.duels.length && <button type="button" className="today-cta dc-full btn-secondary" onClick={() => setSheet('duels')}>{tp('seeAllDuels')}</button>}
              </div>
            )}
          </>)}

          {plans.length > 0 && (<>
            <h2 className="pp2-h">{tp('plans')}</h2>
            {plans.map(e => <div key={e.id} className="pp2-plan"><Icon name="calendar-outline" size={16} /><span className="pp-ellipsis">{e.title}</span>
              <span className="dc-muted">{new Date(e.starts_at * 1000).toLocaleString(i18n.language, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span></div>)}
          </>)}
        </div>
      </div>

      {showActions && user && (
        <div className="pp2-bar">
          <button type="button" className="today-cta btn-primary" onClick={() => onSendDm?.(user.id)}><Icon name="chatbubble-outline" size={18} />{tp('message')}</button>
          <button type="button" className="today-cta btn-secondary" disabled={busy} onClick={friendPress}>
            <Icon name={friendState === 'friend' ? 'checkmark-circle-outline' : friendState === 'pending_out' ? 'time-outline' : 'person-add-outline'} size={18} />
            {friendState === 'friend' ? tp('friendsState') : friendState === 'pending_out' ? tp('requested') : friendState === 'pending_in' ? tp('accept') : tp('addFriend')}
          </button>
        </div>
      )}

      {menu && (
        <div className="v3-sheet-wrap" role="dialog" aria-modal="true" aria-label={handle}>
          <button type="button" className="v3-sheet-scrim" onClick={() => setMenu(false)} aria-label={t('actions.cancel')} />
          <div className="v3-sheet">
            <p className="v3-sheet-title">{handle}</p>
            <button type="button" className="pp2-menu-row" disabled={reported} onClick={() => { setMenu(false); setReport(true) }}><Icon name="flag-outline" size={18} />{reported ? tp('reported') : tp('report')}</button>
            <button type="button" className="pp2-menu-row pp2-menu-row--danger" onClick={block}><Icon name="ban-outline" size={18} />{tp('block')}</button>
          </div>
        </div>
      )}
      {report && (
        <div className="v3-sheet-wrap" role="dialog" aria-modal="true" aria-label={t('actions.reportTitle')}>
          <button type="button" className="v3-sheet-scrim" onClick={() => setReport(false)} aria-label={t('actions.cancel')} />
          <div className="v3-sheet">
            <p className="v3-sheet-title">{t('actions.reportTitle')}</p>
            <textarea className="modal-input" rows={4} value={reason} onChange={e => setReason(e.target.value)} placeholder={t('report.placeholder')} />
            <button type="button" className="today-cta dc-full btn-primary" disabled={reason.trim().length < 10} onClick={sendReport}>{t('report.submit')}</button>
          </div>
        </div>
      )}
      {sheet === 'photos' && <AllPhotos userId={userId} tp={tp} onClose={() => setSheet(null)} onOpen={openPhoto} />}
      {sheet === 'duels' && <AllDuels userId={userId} handle={handle} tp={tp} onClose={() => setSheet(null)} onOpen={openPhoto} />}
    </div>
  )
}

function PhotoGrid({ items, onOpen, tp }) {
  return (
    <div className="pp2-grid">
      {items.map(p => (
        <button key={p.proof.id} type="button" className="pp2-tile" onClick={() => onOpen(p.proof.id)}
                aria-label={[p.podium ? tp('podiumA11y', { rank: p.podium }) : null, `❤️ ${p.proof.voteCount}`].filter(Boolean).join(', ')}>
          <img src={p.proof.thumbUrl ?? p.proof.photoUrl} alt="" loading="lazy" />
          {p.podium && p.podium <= 3 && <span className="pp2-tile-medal"><RankMedal rank={p.podium} podium size={22} /></span>}
          <em>❤️ {p.proof.voteCount}</em>
        </button>
      ))}
    </div>
  )
}

function DuelRow({ duel, onOpen }) {
  const tc = themeColor(duel.theme)
  return (
    <button type="button" className="pp2-duel" onClick={onOpen} aria-label={themeName(duel.theme)}>
      <span className="pp2-duel-ph"><img src={duel.mine.thumbUrl ?? duel.mine.photoUrl} alt="" loading="lazy" />{duel.winner === 'me' && <i>👑</i>}</span>
      <span className="pp2-duel-mid"><b style={{ color: tc.light }}>{themeName(duel.theme)}</b><small>{duel.mine.voteCount} – {duel.theirs.voteCount}</small></span>
      <span className="pp2-duel-ph"><img src={duel.theirs.thumbUrl ?? duel.theirs.photoUrl} alt="" loading="lazy" />{duel.winner === 'them' && <i>👑</i>}</span>
    </button>
  )
}

function AllPhotos({ userId, tp, onClose, onOpen }) {
  const [items, setItems] = useState(null)
  useEffect(() => { fetchUserPhotos(userId, 0).then(p => setItems(p.items)).catch(() => setItems([])) }, [userId])
  return (
    <div className="full-page pp2 pp2-sub">
      <div className="pp2-subhead"><BackButton onClick={onClose} /><h1>{tp('photosTitle')}</h1></div>
      <div className="pp2-body">{items === null ? <p className="dc-muted">…</p> : <PhotoGrid items={items} tp={tp} onOpen={(id) => onOpen(items.map(p => p.proof), id)} />}</div>
    </div>
  )
}

function AllDuels({ userId, handle, tp, onClose, onOpen }) {
  const [data, setData] = useState(null)
  useEffect(() => { fetchUserDuels(userId, 0).then(setData).catch(() => setData({ me: 0, them: 0, total: 0, duels: [] })) }, [userId])
  return (
    <div className="full-page pp2 pp2-sub">
      <div className="pp2-subhead"><BackButton onClick={onClose} /><h1>{tp('vsTitle', { name: handle })}</h1></div>
      <div className="pp2-body">
        {data === null ? <p className="dc-muted">…</p> : (<>
          <div className="pp2-score"><b>{data.me}</b><span>{tp('you')}</span><u>VS</u><span>{handle}</span><b>{data.them}</b></div>
          {data.duels.map(d => <DuelRow key={d.date} duel={d} onOpen={() => onOpen([d.mine, d.theirs], d.mine.id)} />)}
        </>)}
      </div>
    </div>
  )
}
