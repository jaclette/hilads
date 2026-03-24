import { useState, useEffect } from 'react'
import { fetchConversations } from '../api'

// Formats an ISO-8601 timestamp string as a short relative label for DM rows.
// Returns null for missing/invalid values — caller must guard against null.
function formatConvTime(isoStr) {
  if (!isoStr) return null
  const d = new Date(isoStr)
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

export default function ConversationsScreen({ account, onBack, onOpenDm, onOpenEvent }) {
  const [data, setData]     = useState(null)
  const [error, setError]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchConversations()
      .then(setData)
      .catch(() => setError('Could not load conversations.'))
      .finally(() => setLoading(false))
  }, [])

  const dms    = data?.dms    ?? []
  const events = data?.events ?? []
  const isEmpty = !loading && !error && dms.length === 0 && events.length === 0

  return (
    <div className="full-page">
      <div className="page-header">
        <button className="page-back-btn" onClick={onBack}>←</button>
        <span className="page-title">Messages</span>
      </div>

      <div className="page-body conv-body">
        {loading && <p className="conv-loading">Loading…</p>}
        {error   && <p className="profile-error">{error}</p>}

        {isEmpty && (
          <div className="conv-empty">
            <p className="conv-empty-icon">💬</p>
            <p className="conv-empty-title">No conversations yet</p>
            <p className="conv-empty-sub">
              Tap the message icon next to someone in the city to start a DM
            </p>
          </div>
        )}

        {dms.length > 0 && (
          <section className="conv-section">
            <p className="conv-section-label">Direct messages</p>
            {dms.map(dm => {
              const name = dm.other_display_name ?? '?'
              const [c1, c2] = avatarColors(name)
              return (
                <button
                  key={dm.id}
                  className="conv-row"
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
                  {formatConvTime(dm.last_message_at) && (
                    <span className="conv-row-time">{formatConvTime(dm.last_message_at)}</span>
                  )}
                </button>
              )
            })}
          </section>
        )}

        {events.length > 0 && (
          <section className="conv-section">
            <p className="conv-section-label">Event chats</p>
            {events.map(ev => (
              <button
                key={ev.channel_id}
                className="conv-row"
                onClick={() => onOpenEvent(ev.channel_id)}
              >
                <span className="conv-event-icon">🔥</span>
                <div className="conv-row-body">
                  <span className="conv-row-name">{ev.title}</span>
                  <span className="conv-row-preview">
                    {ev.is_creator ? 'You created this' : 'You joined this'}
                  </span>
                </div>
              </button>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
