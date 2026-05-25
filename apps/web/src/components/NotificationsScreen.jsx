import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import {
  fetchNotifications,
  markNotificationsRead,
  fetchNotificationPreferences,
  updateNotificationPreferences,
} from '../api'
import BackButton from './BackButton'

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(isoString) {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000)
  if (diff < 60)  return i18n.t('time.justNow', { ns: 'common' })
  if (diff < 3600) return i18n.t('time.mAgo', { ns: 'common', count: Math.floor(diff / 60) })
  if (diff < 86400) return i18n.t('time.hAgo', { ns: 'common', count: Math.floor(diff / 3600) })
  return i18n.t('time.dAgo', { ns: 'common', count: Math.floor(diff / 86400) })
}

const TYPE_ICONS = {
  dm_message:              '💬',
  event_message:           '🔥',
  event_join:              '👥',
  new_event:               '🔥',
  mention:                 '💬',
  channel_message:         '💬',
  city_join:               '👋',
  friend_request_received: '👋',
  friend_request_accepted: '🎉',
  friend_added:            '👋',  // legacy
  vibe_received:           '✨',
  profile_view:            '👀',
}

// ── Toggle component ──────────────────────────────────────────────────────────

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      className={`notif-toggle${checked ? ' on' : ''}`}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
    />
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const PREVIEW_LIMIT = 5

export default function NotificationsScreen({ onBack, onNavigate, onUnreadChange, account }) {
  const { t } = useTranslation('notifications')
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading]             = useState(true)
  const [loadingAll, setLoadingAll]       = useState(false)
  const [showAll, setShowAll]             = useState(false)
  const [unreadCount, setUnreadCount]     = useState(0)
  const [prefs, setPrefs]                 = useState(null)
  const [prefsSaving, setPrefsSaving]     = useState(false)

  useEffect(() => {
    if (!account) return  // preferences require a registered account

    let cancelled = false
    setLoading(true)
    fetchNotifications({ limit: PREVIEW_LIMIT })
      .then(data => {
        if (cancelled) return
        setNotifications(data.notifications)
        setUnreadCount(data.unread_count)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })

    fetchNotificationPreferences()
      .then(data => { if (!cancelled) setPrefs(data.preferences) })
      .catch((err) => { console.error('[notifications] preferences fetch failed:', err) })

    return () => { cancelled = true }
  }, [account])

  function handleSeeAll() {
    if (showAll) return
    setLoadingAll(true)
    fetchNotifications({ limit: 100 })
      .then(data => {
        setNotifications(data.notifications)
        setShowAll(true)
      })
      .catch(() => {})
      .finally(() => setLoadingAll(false))
  }

  function handleMarkAllRead() {
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    setUnreadCount(0)
    onUnreadChange(0)
    markNotificationsRead(true)
  }

  function handleClickNotif(notif) {
    if (!notif.is_read) {
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n))
      setUnreadCount(prev => Math.max(0, prev - 1))
      onUnreadChange(Math.max(0, unreadCount - 1))
      markNotificationsRead([notif.id])
    }
    onNavigate(notif)
  }

  async function handleTogglePref(key, value) {
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    setPrefsSaving(true)
    try {
      const data = await updateNotificationPreferences(next)
      setPrefs(data.preferences)
    } catch {
      setPrefs(prefs) // revert on error
    } finally {
      setPrefsSaving(false)
    }
  }

  return (
    <div className="full-page notif-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{t('title')}</span>
        {unreadCount > 0 && (
          <button className="notif-mark-all" onClick={handleMarkAllRead}>
            {t('markAllRead')}
          </button>
        )}
      </div>

      <div className="page-body notif-body">
        {/* ── Notification list ── */}
        {loading ? (
          <div className="notif-loading">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="notif-skeleton">
                <div className="skel skel-icon" />
                <div className="notif-skeleton-text">
                  <div className="skel skel-line" style={{ width: `${55 + (i * 13) % 35}%` }} />
                  <div className="skel skel-line skel-line--sm" style={{ width: `${40 + (i * 11) % 30}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <div className="notif-empty">
            <p className="notif-empty-icon">✨</p>
            <p className="notif-empty-title">{t('empty.title')}</p>
            <p className="notif-empty-sub">{t('empty.sub')}</p>
          </div>
        ) : (
          <div className="notif-list">
            {notifications.map(n => (
              <button
                key={n.id}
                className={`notif-row${n.is_read ? ' read' : ''}`}
                onClick={() => handleClickNotif(n)}
              >
                <span className="notif-icon">{TYPE_ICONS[n.type] ?? '🔔'}</span>
                <div className="notif-content">
                  <span className="notif-title">{n.title}</span>
                  {n.body && <span className="notif-body-text">{n.body}</span>}
                  <span className="notif-time">{timeAgo(n.created_at)}</span>
                </div>
                {!n.is_read && <span className="notif-unread-dot" />}
              </button>
            ))}
          </div>
        )}

        {/* ── See all CTA ── */}
        {!loading && !showAll && (
          <button
            className="notif-see-all"
            onClick={handleSeeAll}
            disabled={loadingAll}
          >
            {loadingAll ? t('loading') : t('seeAll')}
          </button>
        )}

        {/* ── Preferences ──
            DM, event-chat, and city-chat toggles live on the Conversations
            screen now — they govern the envelope icon's behaviour, not the bell. */}
        <div className="notif-prefs">
          <div className="notif-prefs-title">{t('prefs.title')}</div>

          <div className="notif-pref-row">
            <div className="notif-pref-label">
              <span className="notif-pref-name">{t('prefs.mentionName')}</span>
              <span className="notif-pref-desc">{t('prefs.mentionDesc')}</span>
            </div>
            <Toggle
              checked={prefs?.mention_push ?? true}
              onChange={v => handleTogglePref('mention_push', v)}
              disabled={prefsSaving || !prefs}
            />
          </div>

          <div className="notif-pref-row">
            <div className="notif-pref-label">
              <span className="notif-pref-name">{t('prefs.newEventName')}</span>
              <span className="notif-pref-desc">{t('prefs.newEventDesc')}</span>
            </div>
            <Toggle
              checked={prefs?.new_event_push ?? false}
              onChange={v => handleTogglePref('new_event_push', v)}
              disabled={prefsSaving || !prefs}
            />
          </div>

          <div className="notif-pref-row">
            <div className="notif-pref-label">
              <span className="notif-pref-name">{t('prefs.friendName')}</span>
              <span className="notif-pref-desc">{t('prefs.friendDesc')}</span>
            </div>
            <Toggle
              checked={prefs?.friend_request_push ?? true}
              onChange={v => handleTogglePref('friend_request_push', v)}
              disabled={prefsSaving || !prefs}
            />
          </div>

          <div className="notif-pref-row">
            <div className="notif-pref-label">
              <span className="notif-pref-name">{t('prefs.notesName')}</span>
              <span className="notif-pref-desc">{t('prefs.notesDesc')}</span>
            </div>
            <Toggle
              checked={prefs?.vibe_received_push ?? true}
              onChange={v => handleTogglePref('vibe_received_push', v)}
              disabled={prefsSaving || !prefs}
            />
          </div>

          <div className="notif-pref-row">
            <div className="notif-pref-label">
              <span className="notif-pref-name">{t('prefs.profileViewName')}</span>
              <span className="notif-pref-desc">{t('prefs.profileViewDesc')}</span>
            </div>
            <Toggle
              checked={prefs?.profile_view_push ?? true}
              onChange={v => handleTogglePref('profile_view_push', v)}
              disabled={prefsSaving || !prefs}
            />
          </div>

          <div className="notif-pref-row">
            <div className="notif-pref-label">
              <span className="notif-pref-name">{t('prefs.announcementName')}</span>
              <span className="notif-pref-desc">{t('prefs.announcementDesc')}</span>
            </div>
            <Toggle
              checked={prefs?.admin_announcement_push ?? true}
              onChange={v => handleTogglePref('admin_announcement_push', v)}
              disabled={prefsSaving || !prefs}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
