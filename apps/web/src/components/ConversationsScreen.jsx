import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { fetchConversations, fetchNotificationPreferences, updateNotificationPreferences } from '../api'
import BackButton from './BackButton'

// Toggle copied from NotificationsScreen so we don't introduce a shared
// component for one usage. Kept identical so styling stays consistent.
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

// Formats a timestamp string as a short relative label for DM rows.
// Handles both ISO-8601 ("2024-01-15T14:30:00Z") and MySQL datetime
// ("2024-01-15 14:30:00") formats — the latter is invalid in Safari's
// Date constructor so we normalise the space to "T" before parsing.
// Returns null for missing/invalid values — caller must guard against null.
function formatConvTime(isoStr) {
  if (!isoStr) return null
  const normalised = typeof isoStr === 'string' ? isoStr.replace(' ', 'T') : isoStr
  const d = new Date(normalised)
  if (isNaN(d.getTime())) return null
  const diff = Date.now() - d.getTime()
  if (diff < 60_000)           return i18n.t('time.nowShort', { ns: 'common' })
  if (diff < 3_600_000)        return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000)       return `${Math.floor(diff / 3_600_000)}h`
  if (diff < 7 * 86_400_000)   return d.toLocaleDateString(i18n.language, { weekday: 'short' })
  return d.toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' })
}

const AVATAR_PALETTES = [
  ['#7c6aff', '#c084fc'], ['#ff6a9f', '#fb7185'], ['#22d3ee', '#38bdf8'],
  ['#4ade80', '#34d399'], ['#fb923c', '#fbbf24'], ['#f472b6', '#e879f9'],
  ['#818cf8', '#60a5fa'], ['#2dd4bf', '#a3e635'],
]

function avatarColors(name) {
  const hash = (name || '?').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length]
}

const FILTERS = ['all', 'dms', 'events']

export default function ConversationsScreen({ account, conversations, onConversationsLoaded, onBack, onOpenDm, onOpenEvent }) {
  const { t } = useTranslation('dm')
  const [fetchError, setFetchError] = useState(false)
  const [activeFilter, setActiveFilter] = useState('all')

  // Envelope-scoped notification preferences. The DM, event-chat, and city-chat
  // toggles live here because their notifications surface in the envelope icon,
  // not the bell. The remaining toggles stay on the bell prefs screen.
  const [prefs, setPrefs] = useState(null)
  const [prefsSaving, setPrefsSaving] = useState(false)

  useEffect(() => {
    if (!account) return
    setFetchError(false)
    fetchConversations()
      .then(data => {
        setFetchError(false)
        onConversationsLoaded(data)
      })
      .catch(err => {
        console.warn('[hilads] Messages failed to load:', err?.message ?? String(err))
        setFetchError(true)
      })
    fetchNotificationPreferences().then(setPrefs).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleTogglePref(key, value) {
    if (!prefs || prefsSaving) return
    const previous = prefs
    setPrefs({ ...prefs, [key]: value })
    setPrefsSaving(true)
    try { await updateNotificationPreferences({ [key]: value }) }
    catch { setPrefs(previous) }
    finally { setPrefsSaving(false) }
  }

  const dms    = conversations?.dms    ?? []
  const events = conversations?.events ?? []
  const loading = conversations === null && !fetchError

  const dmUnread     = dms.some(dm => dm.has_unread)
  const eventsUnread = events.some(ev => ev.has_unread)

  // Which sections to render based on active filter
  const showDMs    = activeFilter === 'all' || activeFilter === 'dms'
  const showEvents = activeFilter === 'all' || activeFilter === 'events'

  const filteredEmpty =
    !loading && !fetchError &&
    (showDMs    ? dms.length === 0    : true) &&
    (showEvents ? events.length === 0 : true)

  return (
    <div className="full-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{t('title')}</span>
      </div>

      {/* Filter pills */}
      <div className="conv-filters">
        {FILTERS.map(key => {
          const isActive  = activeFilter === key
          const hasUnread = key === 'dms' ? dmUnread : key === 'events' ? eventsUnread : (dmUnread || eventsUnread)
          return (
            <button
              key={key}
              className={`conv-filter-pill${isActive ? ' conv-filter-pill--active' : ''}`}
              onClick={() => setActiveFilter(key)}
            >
              {t(`filters.${key}`)}
              {hasUnread && <span className="conv-filter-dot" />}
            </button>
          )
        })}
      </div>

      <div className="page-body conv-body">
        {loading && <p className="conv-loading">{t('loading')}</p>}

        {fetchError && (
          <div className="conv-empty">
            <p className="conv-empty-icon">⚠️</p>
            <p className="conv-empty-title">{t('error.loadTitle')}</p>
            <p className="conv-empty-sub">{t('error.loadSub')}</p>
          </div>
        )}

        {filteredEmpty && (
          <div className="conv-empty">
            <p className="conv-empty-icon">{activeFilter === 'events' ? '🔥' : '💬'}</p>
            <p className="conv-empty-title">
              {activeFilter === 'events' ? t('empty.eventsTitle') : t('empty.title')}
            </p>
            <p className="conv-empty-sub">
              {activeFilter === 'events' ? t('empty.eventsSub') : t('empty.sub')}
            </p>
          </div>
        )}

        {/* Direct Messages section */}
        {!loading && !fetchError && showDMs && dms.length > 0 && (
          <section className="conv-section">
            {activeFilter === 'all' && <p className="conv-section-label">{t('sectionDms')}</p>}
            {dms.map(dm => {
              const name = dm.other_display_name ?? '?'
              const [c1, c2] = avatarColors(name)
              const timeLabel = formatConvTime(dm.last_message_at)
              return (
                <button
                  key={dm.id}
                  className={`conv-row${dm.has_unread ? ' conv-row--unread' : ''}`}
                  onClick={() => onOpenDm(dm)}
                >
                  {dm.other_photo_url
                    ? <img className="online-avatar conv-avatar" src={dm.other_photo_url} alt={name} />
                    : <span className="online-avatar conv-avatar" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                        {name[0].toUpperCase()}
                      </span>
                  }
                  <div className="conv-row-body">
                    <span className="conv-row-name">{name}</span>
                    <span className="conv-row-preview">
                      {dm.last_message
                        ? (dm.last_sender_id === account?.id ? t('youPrefix', { message: dm.last_message }) : dm.last_message)
                        : t('startConversation')
                      }
                    </span>
                  </div>
                  <div className="conv-row-meta">
                    {timeLabel && <span className="conv-row-time">{timeLabel}</span>}
                    {dm.has_unread && <span className="conv-unread-dot" />}
                  </div>
                </button>
              )
            })}
          </section>
        )}

        {/* Event Chats section */}
        {!loading && !fetchError && showEvents && events.length > 0 && (
          <section className="conv-section">
            {activeFilter === 'all' && <p className="conv-section-label">{t('sectionEvents')}</p>}
            {events.map(ev => (
              <button
                key={ev.channel_id}
                className={`conv-row${ev.has_unread ? ' conv-row--unread' : ''}`}
                onClick={() => onOpenEvent(ev)}
              >
                <span className="conv-event-icon">🔥</span>
                <div className="conv-row-body">
                  <span className="conv-row-name">{ev.title}</span>
                  <span className="conv-row-preview">
                    {ev.is_creator ? t('eventCreated') : t('eventJoined')}
                  </span>
                </div>
                {ev.has_unread && (
                  <div className="conv-row-meta">
                    <span className="conv-unread-dot" />
                  </div>
                )}
              </button>
            ))}
          </section>
        )}

        {/* ── Envelope-scoped notification preferences ────────────────────── */}
        {prefs && (
          <div className="notif-prefs">
            <div className="notif-prefs-title">{t('prefs.title')}</div>

            <div className="notif-pref-row">
              <div className="notif-pref-label">
                <span className="notif-pref-name">{t('prefs.dmName')}</span>
                <span className="notif-pref-desc">{t('prefs.dmDesc')}</span>
              </div>
              <Toggle
                checked={prefs?.dm_push ?? true}
                onChange={v => handleTogglePref('dm_push', v)}
                disabled={prefsSaving || !prefs}
              />
            </div>

            <div className="notif-pref-row">
              <div className="notif-pref-label">
                <span className="notif-pref-name">{t('prefs.eventName')}</span>
                <span className="notif-pref-desc">{t('prefs.eventDesc')}</span>
              </div>
              <Toggle
                checked={prefs?.event_message_push ?? true}
                onChange={v => handleTogglePref('event_message_push', v)}
                disabled={prefsSaving || !prefs}
              />
            </div>

            <div className="notif-pref-row">
              <div className="notif-pref-label">
                <span className="notif-pref-name">{t('prefs.cityName')}</span>
                <span className="notif-pref-desc">{t('prefs.cityDesc')}</span>
              </div>
              <Toggle
                checked={prefs?.channel_message_push ?? false}
                onChange={v => handleTogglePref('channel_message_push', v)}
                disabled={prefsSaving || !prefs}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
