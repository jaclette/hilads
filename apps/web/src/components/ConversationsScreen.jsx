import { useEffect, useState } from 'react'
import { fetchConversations } from '../api'
import BackButton from './BackButton'

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
  if (diff < 60_000)           return 'now'
  if (diff < 3_600_000)        return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000)       return `${Math.floor(diff / 3_600_000)}h`
  if (diff < 7 * 86_400_000)   return d.toLocaleDateString('en-US', { weekday: 'short' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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

export default function ConversationsScreen({ account, conversations, onConversationsLoaded, onBack, onOpenDm, onOpenEvent }) {
  const [fetchError, setFetchError] = useState(false)
  const [activeTab,  setActiveTab]  = useState('dms')

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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const dms    = conversations?.dms    ?? []
  const events = conversations?.events ?? []
  const loading = conversations === null && !fetchError

  const dmUnread     = dms.some(dm => dm.has_unread)
  const eventsUnread = events.some(ev => ev.has_unread)

  return (
    <div className="full-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">Messages</span>
      </div>

      {/* Tab bar */}
      <div className="conv-tabs">
        {['dms', 'events'].map(tab => {
          const isActive  = activeTab === tab
          const hasUnread = tab === 'dms' ? dmUnread : eventsUnread
          const label     = tab === 'dms' ? 'Direct Messages' : 'Event Chats'
          return (
            <button
              key={tab}
              className={`conv-tab${isActive ? ' conv-tab--active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              <span className="conv-tab-label">{label}</span>
              {hasUnread && <span className="conv-tab-dot" />}
            </button>
          )
        })}
      </div>

      <div className="page-body conv-body">
        {loading && <p className="conv-loading">Loading…</p>}

        {fetchError && (
          <div className="conv-empty">
            <p className="conv-empty-icon">⚠️</p>
            <p className="conv-empty-title">Couldn't load messages</p>
            <p className="conv-empty-sub">Check your connection and try again.</p>
          </div>
        )}

        {/* Direct Messages tab */}
        {!loading && !fetchError && activeTab === 'dms' && (
          dms.length === 0 ? (
            <div className="conv-empty">
              <p className="conv-empty-icon">💬</p>
              <p className="conv-empty-title">No direct messages yet</p>
              <p className="conv-empty-sub">
                Tap the message icon next to someone in the city to start a DM.
              </p>
            </div>
          ) : (
            <section className="conv-section">
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
                          ? (dm.last_sender_id === account?.id ? `You: ${dm.last_message}` : dm.last_message)
                          : 'Start the conversation'
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
          )
        )}

        {/* Event Chats tab */}
        {!loading && !fetchError && activeTab === 'events' && (
          events.length === 0 ? (
            <div className="conv-empty">
              <p className="conv-empty-icon">🔥</p>
              <p className="conv-empty-title">No event chats yet</p>
              <p className="conv-empty-sub">
                Create or join an event to chat with people going.
              </p>
            </div>
          ) : (
            <section className="conv-section">
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
                      {ev.is_creator ? 'You created this' : 'You joined this'}
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
          )
        )}
      </div>
    </div>
  )
}
