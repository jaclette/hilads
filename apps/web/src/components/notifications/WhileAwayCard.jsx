import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchInbox, markNotificationsRead, markNotificationsSeen } from '../../api'
import AvatarWithFlag from '../AvatarWithFlag'
import Icon from '../Icon'
import { patchNotifCounts, refreshNotifCounts, useNotifCounts } from '../../lib/notifCounts'
import { track } from '../../lib/analytics'
import { useDaily } from '../daily/dailyShared'
import { setAwayCardShowing } from '../../lib/awayResults'
import { holdScreen } from '../../lib/celebrationQueue'
import { awayLine, byImportance, sameObject } from './inboxText'
import { ackRankAway, useRaceSeasonId, useRaceSignals } from '../contest/raceSignals'

/**
 * "While you were away" (V6, as the app), at the top of Today: unseen Social or
 * Game notifications as stacked avatars and one line, most important first
 * (cut with an ellipsis). A click on it opens that most important thing itself
 * (new comments: the photo's comments on the latest; a like: the photo;
 * results: Ranks); when every item is about the same photo, the whole card goes
 * there. The others are a "+3" pill next to ✕, which opens the notifications on
 * just those. Opening marks the related notifications read and the card slides
 * away; ✕ dismisses it (seen, not read). No swipe on the web.
 */
export default function WhileAwayCard({ account, openTrip }) {
  const { t } = useTranslation('notifications')
  const { openNotification, openNotifications } = useDaily()
  const { unseen } = useNotifCounts()
  const pending = (unseen.social ?? 0) + (unseen.game ?? 0)
  const [items, setItems] = useState(null)
  const [leaving, setLeaving] = useState(false)
  // My rank changed in the campaign's race (raceSignals): a line here until it's seen.
  const seasonId = useRaceSeasonId()
  const { change } = useRaceSignals(seasonId)
  const tPp = useTranslation('profile', { keyPrefix: 'pp' }).t
  const raceChange = account && change && !change.awayAck ? change : null
  const race = raceChange ? tPp(raceChange.to < raceChange.from ? 'trip.away.up' : 'trip.away.down', { rank: raceChange.to }) : null

  useEffect(() => {
    if (!account || pending === 0) { setItems(null); return undefined }
    let alive = true
    fetchInbox({ categories: ['social', 'game'], unseen: true, limit: 8 }).then(r => { if (alive) { setItems(r.items); setLeaving(false) } }).catch(() => {})
    return () => { alive = false }
  }, [account, pending])

  useEffect(() => {
    setAwayCardShowing(!!items?.length || !!race)   // one card at a time above the hero: the results card waits
    return () => setAwayCardShowing(false)
  }, [items, race])

  // No celebration pops over the card while it arrives (a moment to read it).
  const showing = !!items?.length || !!race
  useEffect(() => {
    if (!showing) return undefined
    const release = holdScreen('away-intro')
    const id = setTimeout(release, 2500)
    return () => { clearTimeout(id); release() }
  }, [showing])

  const ids = useMemo(() => (items ?? []).flatMap(i => i.ids), [items])
  const seen = () => {
    ackRankAway()
    if (!ids.length) { setItems(null); return }
    markNotificationsSeen({ ids })
    patchNotifCounts(c => ({ ...c, unseen: { ...c.unseen, social: 0, game: 0 } }))
    setItems(null)
  }
  if (!items?.length && !race) return null
  const list = items ?? []
  const sorted = byImportance(list)
  const main = sorted[0] ?? null
  const single = list.length <= 1 || sameObject(list) !== null
  // The race line leads (no results): a click goes to the Trip tab, every notification is in "+N".
  const raceFirst = !!race && main?.type !== 'daily_result'
  const more = raceFirst ? list.length : single ? 0 : list.length - 1
  const actors = []
  for (const i of sorted) for (const a of i.actors ?? []) {
    if (actors.length < 3 && !actors.some(x => (x.id ?? x.name) === (a.id ?? a.name))) actors.push(a)
  }
  const line = awayLine(list, t, 3, race)
  const key = (i) => (i.object?.id ? `${i.object.kind}:${i.object.id}` : i.type)

  // The card slides out, then the item opens (its notifications read: the related ones, or all on the same object).
  const leave = (then, readIds) => {
    if (readIds?.length) markNotificationsRead(readIds).then(refreshNotifCounts)
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    setLeaving(true)
    setTimeout(() => { seen(); then() }, reduced ? 0 : 200)
  }
  const openMain = () => {
    if (!main || raceFirst) {
      track('away_card_opened', { type: 'trip_rank', single, more, platform_surface: 'web' })
      leave(() => openTrip?.(), null)
      return
    }
    track('away_card_opened', { type: main.type, single, more, platform_surface: 'web' })
    leave(() => openNotification(main), single ? ids : sorted.filter(i => key(i) === key(main)).flatMap(i => i.ids))
  }
  const openMore = () => {
    track('away_card_more', { count: more, platform_surface: 'web' })
    leave(() => openNotifications(list.map(i => i.id)), null)
  }

  return (
    <div className={`n6-away${leaving ? ' n6-away--leaving' : ''}`}>
      <button type="button" className="n6-away-body" onClick={openMain} aria-label={`${t('away.title')}. ${line}`}>
        {actors.length > 0 && (
          <span className="n6-away-stack" style={{ width: 30 + (actors.length - 1) * 18 }}>
            {actors.map((a, i) => (
              <span key={a.id ?? a.name} className="n6-away-avatar" style={{ left: i * 18, zIndex: 3 - i }}>
                <AvatarWithFlag userId={a.id} displayName={a.name} photoUrl={a.photoUrl} size={30} />
              </span>
            ))}
          </span>
        )}
        <span className="n6-away-text">
          <span className="n6-away-title">{t('away.title')}</span>
          <span className="n6-away-line">{line}</span>
        </span>
      </button>
      {more > 0 && <button type="button" className="n6-away-more" onClick={openMore} aria-label={t('away.more', { count: more })}>+{more}</button>}
      <button type="button" className="n6-away-close" onClick={seen} aria-label={t('away.dismiss')}><Icon name="close" size={18} /></button>
    </div>
  )
}
