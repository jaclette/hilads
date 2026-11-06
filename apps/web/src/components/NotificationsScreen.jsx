import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import {
  deleteNotifications, fetchInbox, markNotificationCategoriesRead, markNotificationsRead, markNotificationsSeen, markNotificationsUnread,
} from '../api'
import { registerPush } from '../push'
import BackButton from './BackButton'
import Icon from './Icon'
import AvatarWithFlag from './AvatarWithFlag'
import { thumbUrl } from '../lib/imageThumb'
import { CATEGORIES, patchNotifCounts, refreshNotifCounts, useNotifCounts } from '../lib/notifCounts'
import { rowText, sectionOf } from './notifications/inboxText'
import { CATEGORY_EMOJI, categoryColor } from './notifications/categories'

function timeAgo(isoString) {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000)
  if (diff < 60)  return i18n.t('time.justNow', { ns: 'common' })
  if (diff < 3600) return i18n.t('time.mAgo', { ns: 'common', count: Math.floor(diff / 60) })
  if (diff < 86400) return i18n.t('time.hAgo', { ns: 'common', count: Math.floor(diff / 3600) })
  return i18n.t('time.dAgo', { ns: 'common', count: Math.floor(diff / 86400) })
}

const SECTIONS = ['new', 'today', 'yesterday', 'week', 'earlier']
const EMPTY_EMOJI = { all: '📸', social: '💬', game: '🏆', plans: '📅', city: '👋', hilads: '✨' }
const GAME_ICON = { daily_result: '🏆', daily_local_pass: '🎟️', daily_rank: '📈', daily_twist_completed: '🌀', daily_twist_picked: '🌀' }
const PUSH_DISMISSED = 'hilads_push_off_banner_dismissed'
const tint = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})` }

/**
 * Notifications (V6, as in the app): filter chips per category with unread
 * counts, sections (New, Today, Yesterday, This week, Earlier), grouped rows
 * ("Lan and 3 others liked your photo") that open their target, read / unread
 * and delete (buttons on the row, or a swipe on touch screens), endless scroll,
 * a skeleton, a playful empty state per filter, "Mark all read" with a sweep,
 * ⚙️ to the preferences (their own page) and a banner when push is off.
 * `onNavigate(item)` opens an item's target; the list refreshes when new ones arrive.
 */
export default function NotificationsScreen({ onBack, onNavigate, onOpenSettings, incoming }) {
  const { t } = useTranslation('notifications')
  const counts = useNotifCounts()
  const [filter, setFilter] = useState('all')
  const [items, setItems] = useState(null)
  const [cursor, setCursor] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [sweep, setSweep] = useState(0)
  const current = useRef(filter)
  current.current = filter
  const fresh = useRef(new Set())
  const sentinel = useRef(null)

  const load = useCallback(async (mode) => {
    if (mode === 'more' && (!cursor || loadingMore)) return
    if (mode === 'more') setLoadingMore(true)
    const asked = filter
    try {
      const page = await fetchInbox({ categories: filter === 'all' ? [] : [filter], cursor: mode === 'more' ? cursor : null })
      if (current.current !== asked) return
      setItems(prev => {
        if (mode === 'refresh' && prev) page.items.forEach(i => { if (!prev.some(p => p.id === i.id)) fresh.current.add(i.id) })
        return mode === 'more' && prev ? [...prev, ...page.items.filter(i => !prev.some(p => p.id === i.id))] : page.items
      })
      setCursor(page.nextCursor)
    } catch {
      if (current.current === asked) setItems(prev => prev ?? [])
    } finally {
      setLoadingMore(false)
    }
  }, [filter, cursor, loadingMore])

  useEffect(() => { setItems(null); setCursor(null); load('first') }, [filter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Once the first page is drawn (its "New" section), everything is seen.
  const markedSeen = useRef(false)
  useEffect(() => {
    if (items === null || markedSeen.current) return
    markedSeen.current = true
    markNotificationsSeen({ categories: CATEGORIES })
    patchNotifCounts(c => ({ ...c, unseen: { social: 0, game: 0, plans: 0, city: 0, hilads: 0 } }))
  }, [items])

  // New ones (a live notification, or the counts going up): they slide in at the top.
  const lastTotal = useRef(counts.total)
  useEffect(() => {
    if (counts.total > lastTotal.current && items) load('refresh')
    lastTotal.current = counts.total
  }, [counts.total]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (incoming?.id && items) load('refresh') }, [incoming]) // eslint-disable-line react-hooks/exhaustive-deps

  // Endless scroll.
  useEffect(() => {
    const el = sentinel.current
    if (!el || !cursor) return undefined
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) load('more') }, { rootMargin: '300px' })
    io.observe(el)
    return () => io.disconnect()
  }, [cursor, load])

  const readLocally = (ids, read) => setItems(prev => prev?.map(i => (i.ids.some(id => ids.includes(id)) ? { ...i, read } : i)) ?? prev)
  const open = (item) => {
    if (!item.read) { readLocally(item.ids, true); markNotificationsRead(item.ids).then(refreshNotifCounts) }
    onNavigate(item)
  }
  const toggleRead = (item) => {
    readLocally(item.ids, !item.read)
    ;(item.read ? markNotificationsUnread(item.ids) : markNotificationsRead(item.ids)).then(refreshNotifCounts)
  }
  const remove = (item) => {
    setItems(prev => prev?.filter(i => i.id !== item.id) ?? prev)
    deleteNotifications(item.ids).then(refreshNotifCounts)
  }
  const markAll = () => {
    setSweep(s => s + 1)
    setItems(prev => prev?.map(i => ({ ...i, read: true })) ?? prev)
    patchNotifCounts(c => ({ ...c, total: filter === 'all' ? 0 : Math.max(0, c.total - (c.unread[filter] ?? 0)),
      unread: filter === 'all' ? { social: 0, game: 0, plans: 0, city: 0, hilads: 0 } : { ...c.unread, [filter]: 0 } }))
    ;(filter === 'all' ? markNotificationsRead(true) : markNotificationCategoriesRead([filter])).then(refreshNotifCounts)
  }

  const sections = useMemo(() => {
    const by = new Map()
    for (const i of items ?? []) { const k = sectionOf(i); by.set(k, [...(by.get(k) ?? []), i]) }
    return SECTIONS.filter(k => by.has(k)).map(k => ({ key: k, items: by.get(k) }))
  }, [items])
  const anyUnread = filter === 'all' ? counts.total > 0 : (counts.unread[filter] ?? 0) > 0

  return (
    <div className="full-page notif-page n6-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{t('title')}</span>
        {anyUnread && <button type="button" className="notif-mark-all" onClick={markAll}>{t('markAllRead')}</button>}
        <button type="button" className="n6-gear" onClick={onOpenSettings} aria-label={t('inbox.settings')} title={t('inbox.settings')}>
          <Icon name="settings-outline" size={20} />
        </button>
      </div>

      <div className="n6-chips" role="tablist">
        {['all', ...CATEGORIES].map(f => {
          const on = filter === f
          const c = f === 'all' ? null : categoryColor(f)
          const n = f === 'all' ? counts.total : counts.unread[f] ?? 0
          return (
            <button key={f} type="button" role="tab" aria-selected={on} className={`n6-chip${on ? ' n6-chip--on' : ''}`}
                    style={on && c ? { background: c.fill, borderColor: c.fill, color: c.onFill } : undefined} onClick={() => setFilter(f)}>
              {f === 'all' ? t('inbox.all') : `${CATEGORY_EMOJI[f]} ${t(`inbox.cat.${f}`)}`}
              {n > 0 && <span className="n6-chip-count">{n > 99 ? '99+' : n}</span>}
            </button>
          )
        })}
      </div>

      <PushOffBanner />

      <div className="page-body notif-body n6-body">
        {sweep > 0 && <span key={sweep} className="n6-sweep" aria-hidden="true" />}
        {items === null ? (
          <div className="notif-loading">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="notif-skeleton">
                <div className="skel skel-icon" />
                <div className="notif-skeleton-text">
                  <div className="skel skel-line" style={{ width: `${55 + (i * 13) % 35}%` }} />
                  <div className="skel skel-line skel-line--sm" style={{ width: `${40 + (i * 11) % 30}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="n6-empty">
            <span className="n6-empty-bubble" style={{ background: filter === 'all' ? 'var(--primary-tint)' : tint(categoryColor(filter).fill, 0.25) }}>{EMPTY_EMOJI[filter]}</span>
            <p className="n6-empty-text">{t(`inbox.empty.${filter}`)}</p>
          </div>
        ) : (
          sections.map(s => (
            <section key={s.key}>
              <h3 className="n6-section">{t(`inbox.sec.${s.key}`)}</h3>
              {s.items.map(item => (
                <Row key={item.id} item={item} fresh={fresh.current.has(item.id)} onOpen={open} onToggleRead={toggleRead} onDelete={remove} />
              ))}
            </section>
          ))
        )}
        {cursor && <div ref={sentinel} className="n6-sentinel">{loadingMore ? t('loading') : ''}</div>}
      </div>
    </div>
  )
}

function Row({ item, fresh, onOpen, onToggleRead, onDelete }) {
  const { t } = useTranslation('notifications')
  const [dx, setDx] = useState(0)
  const start = useRef(null)
  const moved = useRef(false)
  const text = rowText(item, t)
  const c = categoryColor(item.category)
  const icon = GAME_ICON[item.type]
  const thumb = item.object?.kind === 'photo' ? item.object.thumbUrl : null
  const end = () => {
    if (dx > 80) onToggleRead(item)
    else if (dx < -80) onDelete(item)
    setDx(0)
    start.current = null
  }
  return (
    <div className={`n6-row-wrap${fresh ? ' n6-row-wrap--fresh' : ''}`}>
      <div className="n6-swipe n6-swipe--read" style={{ background: 'var(--primary)' }}>{item.read ? t('inbox.unread') : t('inbox.read')}</div>
      <div className="n6-swipe n6-swipe--delete">{t('inbox.delete')}</div>
      <div className={`n6-row${item.read ? '' : ' n6-row--unread'}`}
           style={{ transform: `translateX(${dx}px)`, background: item.read ? undefined : tint(c.fill, 0.12) }}
           onPointerDown={e => { if (e.pointerType !== 'mouse') { start.current = e.clientX; moved.current = false } }}
           onPointerMove={e => { if (start.current !== null) { const d = e.clientX - start.current; if (Math.abs(d) > 8) moved.current = true; setDx(Math.max(-120, Math.min(120, d))) } }}
           onPointerUp={end} onPointerCancel={() => { setDx(0); start.current = null }}>
        <button type="button" className="n6-row-main" onClick={() => { if (!moved.current) onOpen(item) }}
                aria-label={[text.parts.map(p => p.text).join(''), text.quote, timeAgo(item.created_at)].filter(Boolean).join('. ')}>
          <span className="n6-lead">
            {icon ? <span className="n6-game" style={{ background: tint(c.fill, 0.25) }}>{icon}</span>
              : item.actors.length > 1 ? (
                <span className="n6-stack">
                  <span className="n6-stack-back"><AvatarWithFlag userId={item.actors[1].id} displayName={item.actors[1].name} photoUrl={item.actors[1].photoUrl} size={32} /></span>
                  <span className="n6-stack-front"><AvatarWithFlag userId={item.actors[0].id} displayName={item.actors[0].name} photoUrl={item.actors[0].photoUrl} size={32} /></span>
                </span>
              ) : <AvatarWithFlag userId={item.actors[0]?.id} displayName={item.actors[0]?.name ?? '✨'} photoUrl={item.actors[0]?.photoUrl} size={46} />}
            {!icon && <span className="n6-cat" style={{ background: c.fill }}>{CATEGORY_EMOJI[item.category]}</span>}
          </span>
          <span className="n6-text">
            <span className="n6-sentence">{text.parts.map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>))}</span>
            {text.quote && <span className="n6-quote">“{text.quote}”</span>}
            <span className="n6-time">{timeAgo(item.created_at)}</span>
          </span>
          {thumb && <img loading="lazy" className="notif-thumb" src={thumbUrl(thumb)} alt="" />}
          {!item.read && <span className="n6-dot" style={{ background: c.fill }} />}
        </button>
        <span className="n6-actions">
          <button type="button" onClick={() => onToggleRead(item)} aria-label={item.read ? t('inbox.unread') : t('inbox.read')} title={item.read ? t('inbox.unread') : t('inbox.read')}>
            <Icon name={item.read ? 'ellipse' : 'checkmark-circle-outline'} size={16} />
          </button>
          <button type="button" onClick={() => onDelete(item)} aria-label={t('inbox.delete')} title={t('inbox.delete')}><Icon name="trash-outline" size={16} /></button>
        </span>
      </div>
    </div>
  )
}

/** "Push is off, you might miss your results 🏆 · Turn on" (V6), until on or dismissed. */
export function PushOffBanner() {
  const { t } = useTranslation('notifications')
  const supported = typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator
  const [perm, setPerm] = useState(supported ? Notification.permission : 'unsupported')
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(PUSH_DISMISSED) === '1' } catch { return false } })
  if (!supported || perm === 'granted' || dismissed) return null
  return (
    <div className="n6-push">
      <span className="n6-push-text">{t('inbox.pushOff.text')}</span>
      <span className="n6-push-actions">
        <button type="button" className="n6-push-later" onClick={() => { setDismissed(true); try { localStorage.setItem(PUSH_DISMISSED, '1') } catch { /* private mode */ } }}>
          {t('inbox.pushOff.dismiss')}
        </button>
        {perm !== 'denied' && (
          <button type="button" className="n6-push-on" onClick={() => registerPush().finally(() => setPerm(Notification.permission))}>{t('inbox.pushOff.on')}</button>
        )}
      </span>
    </div>
  )
}
