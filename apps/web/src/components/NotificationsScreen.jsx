import { useState, useEffect } from 'react'
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
  if (diff < 60)  return 'just now'
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
  return Math.floor(diff / 86400) + 'd ago'
}

const TYPE_ICONS = {
  dm_message:     '💬',
  event_message:  '🔥',
  event_join:     '👥',
  new_event:      '🔥',
  channel_message:'💬',
  city_join:      '👋',
  friend_added:   '👋',
  vibe_received:  '✨',
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

export default function NotificationsScreen({ onBack, onNavigate, onUnreadChange }) {
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading]             = useState(true)
  const [unreadCount, setUnreadCount]     = useState(0)
  const [prefs, setPrefs]                 = useState(null)
  const [prefsSaving, setPrefsSaving]     = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchNotifications()
      .then(data => {
        if (cancelled) return
        setNotifications(data.notifications)
        setUnreadCount(data.unread_count)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })

    fetchNotificationPreferences()
      .then(data => { if (!cancelled) setPrefs(data.preferences) })
      .catch(() => {})

    return () => { cancelled = true }
  }, [])

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
        <span className="page-title">Notifications</span>
        {unreadCount > 0 && (
          <button className="notif-mark-all" onClick={handleMarkAllRead}>
            Mark all read
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
            <p className="notif-empty-title">All caught up</p>
            <p className="notif-empty-sub">Notifications will appear here</p>
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

        {/* ── Preferences ── */}
        <div className="notif-prefs">
          <div className="notif-prefs-title">Notification preferences</div>

          <div className="notif-pref-row">
            <div className="notif-pref-label">
              <span className="notif-pref-name">New direct messages</span>
              <span className="notif-pref-desc">In-app · Push coming soon</span>
            </div>
            <Toggle
              checked={prefs?.dm_push ?? true}
              onChange={v => handleTogglePref('dm_push', v)}
              disabled={prefsSaving || !prefs}
            />
          </div>

          <div className="notif-pref-row">
            <div className="notif-pref-label">
              <span className="notif-pref-name">Event chat messages</span>
              <span className="notif-pref-desc">When someone messages in an event you joined</span>
            </div>
            <Toggle
              checked={prefs?.event_message_push ?? true}
              onChange={v => handleTogglePref('event_message_push', v)}
              disabled={prefsSaving || !prefs}
            />
          </div>

          <div className="notif-pref-row">
            <div className="notif-pref-label">
              <span className="notif-pref-name">New events in your city</span>
              <span className="notif-pref-desc">When someone creates an event while you're online</span>
            </div>
            <Toggle
              checked={prefs?.new_event_push ?? false}
              onChange={v => handleTogglePref('new_event_push', v)}
              disabled={prefsSaving || !prefs}
            />
          </div>

          <div className="notif-pref-row">
            <div className="notif-pref-label">
              <span className="notif-pref-name">Friend requests</span>
              <span className="notif-pref-desc">When someone adds you as a friend</span>
            </div>
            <Toggle
              checked={prefs?.friend_added_push ?? true}
              onChange={v => handleTogglePref('friend_added_push', v)}
              disabled={prefsSaving || !prefs}
            />
          </div>

          <div className="notif-pref-row">
            <div className="notif-pref-label">
              <span className="notif-pref-name">Vibes ✨</span>
              <span className="notif-pref-desc">When someone leaves a vibe on your profile</span>
            </div>
            <Toggle
              checked={prefs?.vibe_received_push ?? true}
              onChange={v => handleTogglePref('vibe_received_push', v)}
              disabled={prefsSaving || !prefs}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
