import { useState, useEffect, useRef } from 'react'
import { fetchConversationMessages, sendConversationMessage, markConversationRead } from '../api'
import BackButton from './BackButton'
import SendButton from './SendButton'

const AVATAR_PALETTES = [
  ['#7c6aff', '#c084fc'], ['#ff6a9f', '#fb7185'], ['#22d3ee', '#38bdf8'],
  ['#4ade80', '#34d399'], ['#fb923c', '#fbbf24'], ['#f472b6', '#e879f9'],
  ['#818cf8', '#60a5fa'], ['#2dd4bf', '#a3e635'],
]

function avatarColors(name) {
  const hash = (name || '?').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length]
}

// ── Time utilities (mirrors native messageTime.ts) ────────────────────────────

function normalizePgTs(ts) {
  return ts
    .replace(' ', 'T')
    .replace(/(\.\d{3})\d+/, '$1')
    .replace(/([+-]\d{2})$/, '$1:00')
}

function tsToMs(ts) {
  if (!ts && ts !== 0) return 0
  if (typeof ts === 'number') return ts < 1e10 ? ts * 1000 : ts
  const ms = new Date(normalizePgTs(String(ts))).getTime()
  return isNaN(ms) ? 0 : ms
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function isSameDay(ts1, ts2) {
  if (!ts1 || !ts2) return true
  return startOfDay(new Date(tsToMs(ts1))).getTime() ===
         startOfDay(new Date(tsToMs(ts2))).getTime()
}

function formatTime(ts) {
  const ms = tsToMs(ts)
  if (!ms) return ''
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDateLabel(ts) {
  const ms = tsToMs(ts)
  if (!ms) return ''
  const d   = new Date(ms)
  const now = new Date()
  const today     = startOfDay(now)
  const yesterday = new Date(today.getTime() - 86_400_000)
  const msgDay    = startOfDay(d)
  if (msgDay.getTime() === today.getTime())     return 'Today'
  if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday'
  const opts = { month: 'short', day: 'numeric' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString([], opts)
}

export default function DirectMessageScreen({ conversation, otherUser, account, socket, onBack }) {
  const [messages, setMessages]   = useState([])
  const [input, setInput]         = useState('')
  const [sending, setSending]     = useState(false)
  const [error, setError]         = useState(null)
  const bottomRef                 = useRef(null)
  const knownIds                  = useRef(new Set())

  const otherName = otherUser?.display_name ?? '?'
  const [c1, c2] = avatarColors(otherName)

  // Load message history and mark as read immediately on open
  useEffect(() => {
    markConversationRead(conversation.id) // fire-and-forget; UI already cleared optimistically
    fetchConversationMessages(conversation.id)
      .then(data => {
        knownIds.current = new Set(data.messages.map(m => m.id))
        setMessages(data.messages)
      })
      .catch(() => setError('Could not load messages.'))
  }, [conversation.id])

  // Join WS DM room and listen for new messages
  useEffect(() => {
    if (!socket || !account?.id) return
    socket.joinConversation(conversation.id, account.id)

    socket.on('newConversationMessage', ({ conversationId, message }) => {
      if (conversationId !== conversation.id) return
      if (knownIds.current.has(message.id)) return
      knownIds.current.add(message.id)
      setMessages(prev => [...prev, message])
    })

    return () => {
      socket.leaveConversation(conversation.id, account.id)
    }
  }, [conversation.id, account?.id, socket])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend(e) {
    e.preventDefault()
    const content = input.trim()
    if (!content || sending) return
    setSending(true)
    setError(null)
    try {
      const { message } = await sendConversationMessage(conversation.id, content)
      knownIds.current.add(message.id)
      setMessages(prev => [...prev, message])
      setInput('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="full-page dm-screen">
      {/* Header */}
      <div className="page-header">
        <BackButton onClick={onBack} />
        <div className="dm-header-identity">
          {otherUser?.profile_photo_url
            ? <img className="online-avatar dm-header-avatar" src={otherUser.profile_photo_url} alt={otherName} />
            : <span className="online-avatar dm-header-avatar" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                {otherName[0].toUpperCase()}
              </span>
          }
          <span className="dm-header-name">{otherName}</span>
        </div>
      </div>

      {/* Messages */}
      <div className="dm-messages">
        {error && <p className="profile-error" style={{ margin: '12px 16px' }}>{error}</p>}

        {messages.map((msg, i) => {
          const isMe    = msg.sender_id === account?.id
          const prevMsg = messages[i - 1]
          const nextMsg = messages[i + 1]
          const isGrouped = prevMsg?.sender_id === msg.sender_id
          const showTime  = !nextMsg || nextMsg.sender_id !== msg.sender_id
          const dateLabel = !isSameDay(msg.created_at, prevMsg?.created_at) ? formatDateLabel(msg.created_at) : null
          return (
            <div key={msg.id ?? msg.localId ?? i}>
              {dateLabel && (
                <div className="date-sep">
                  <span className="date-sep-label">{dateLabel}</span>
                </div>
              )}
              <div className={`dm-bubble-wrap${isMe ? ' dm-bubble-wrap--me' : ''}${isGrouped ? ' dm-bubble-wrap--grouped' : ''}`}>
                <div className={`dm-bubble${isMe ? ' dm-bubble--me' : ''}`}>
                  {msg.content}
                </div>
              </div>
              {showTime && msg.created_at && (
                <div className={`dm-time${isMe ? ' dm-time--me' : ''}`}>{formatTime(msg.created_at)}</div>
              )}
            </div>
          )
        })}

        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <form className="dm-composer" onSubmit={handleSend}>
        <input
          className="dm-input"
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Message…"
          maxLength={1000}
          autoFocus
        />
        <SendButton disabled={sending || !input.trim()} />
      </form>
    </div>
  )
}
