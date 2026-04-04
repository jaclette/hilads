import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchTopicMessages, sendTopicMessage, markTopicRead } from '../api'
import BackButton from './BackButton'

const CATEGORY_ICONS = { general: '💬', tips: '💡', food: '🍴', drinks: '🍺', help: '🙋', meetup: '👋' }

// ── Helpers ────────────────────────────────────────────────────────────────────

const AVATAR_PALETTES = [
  ['#7c6aff', '#c084fc'], ['#ff6a9f', '#fb7185'], ['#22d3ee', '#38bdf8'],
  ['#4ade80', '#34d399'], ['#fb923c', '#fbbf24'], ['#f472b6', '#e879f9'],
  ['#818cf8', '#60a5fa'], ['#2dd4bf', '#a3e635'],
]
function avatarColors(name = '') {
  const hash = name.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length]
}

function toMs(ts) {
  if (!ts) return 0
  if (typeof ts === 'number') return ts < 1e10 ? ts * 1000 : ts
  return new Date(ts).getTime()
}

function formatTime(ts) {
  return new Date(toMs(ts)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function TopicChatPage({ topic, guest, nickname, onBack }) {
  const [messages,   setMessages]   = useState([])
  const [input,      setInput]      = useState('')
  const [sending,    setSending]    = useState(false)
  const [error,      setError]      = useState(null)
  const [loading,    setLoading]    = useState(true)

  const knownIdsRef = useRef(new Set())
  const bottomRef   = useRef(null)
  const inputRef    = useRef(null)

  const icon = CATEGORY_ICONS[topic.category] ?? '💬'

  // Load + poll messages
  const loadMessages = useCallback(async () => {
    try {
      const data = await fetchTopicMessages(topic.id)
      const msgs = data.messages ?? []
      const fresh = msgs.filter(m => !knownIdsRef.current.has(m.id ?? `${m.guestId}:${m.createdAt}`))
      if (fresh.length > 0) {
        fresh.forEach(m => knownIdsRef.current.add(m.id ?? `${m.guestId}:${m.createdAt}`))
        setMessages(prev => [...prev, ...fresh].sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt)))
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [topic.id])

  // Initial load
  useEffect(() => {
    loadMessages()
    if (guest?.guestId) markTopicRead(topic.id, guest.guestId)
  }, [topic.id, guest?.guestId, loadMessages])

  // Poll every 4s
  useEffect(() => {
    const id = setInterval(loadMessages, 4_000)
    return () => clearInterval(id)
  }, [loadMessages])

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function handleSend(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text || !guest || sending) return

    const localId = `local-${Date.now()}`
    const optimistic = {
      id:        localId,
      type:      'text',
      guestId:   guest.guestId,
      nickname:  nickname,
      content:   text,
      createdAt: Date.now() / 1000,
      _local:    true,
    }

    setMessages(prev => [...prev, optimistic])
    setInput('')
    setSending(true)
    setError(null)

    try {
      const data = await sendTopicMessage(topic.id, guest.guestId, nickname, text)
      const msg = data.message ?? data
      knownIdsRef.current.add(msg.id)
      setMessages(prev => prev.map(m => m.id === localId ? msg : m))
    } catch (err) {
      setMessages(prev => prev.map(m => m.id === localId ? { ...m, status: 'failed' } : m))
      setError(err.message)
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="full-page topic-chat-page">
      {/* Header */}
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title" style={{ fontSize: 17 }}>
          {icon} {topic.title}
        </span>
      </div>

      {/* Topic info */}
      {topic.description && (
        <div className="topic-chat-desc">{topic.description}</div>
      )}

      {/* Messages area */}
      <div className="topic-chat-feed">
        {loading && messages.length === 0 && (
          <div className="topic-chat-empty">Loading…</div>
        )}
        {!loading && messages.length === 0 && (
          <div className="topic-chat-empty">No replies yet. Say something! 💬</div>
        )}
        {messages.map((item, idx) => {
          const isMine    = item.guestId === guest?.guestId
          const prevItem  = messages[idx - 1]
          const nextItem  = messages[idx + 1]
          const isGrouped = prevItem?.guestId === item.guestId && prevItem?.type !== 'system'
          const showTime  = !nextItem || nextItem.guestId !== item.guestId || nextItem.type === 'system'
          const [c1, c2]  = avatarColors(item.nickname)

          if (item.type === 'system') {
            return (
              <div key={item.id ?? idx} className="activity-msg" style={{ textAlign: 'center', color: 'var(--muted2)', fontSize: 13, padding: '4px 0' }}>
                {item.content}
              </div>
            )
          }

          return (
            <div key={item.id ?? idx} className={['message', isMine ? 'mine' : '', isGrouped ? 'grouped' : '', 'animate'].filter(Boolean).join(' ')}>
              {!isMine && !isGrouped && (
                <div className="msg-meta">
                  <span className="msg-avatar" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                    {(item.nickname ?? '?')[0].toUpperCase()}
                  </span>
                  <span className="msg-author" style={{ color: c1 }}>{item.nickname}</span>
                </div>
              )}
              <div className={`msg-bubble-wrap ${isMine ? 'mine' : ''} ${isGrouped && !isMine ? 'grouped' : ''}`}>
                <span className="msg-content" style={item.status === 'failed' ? { opacity: 0.5 } : item.status === 'sending' ? { opacity: 0.7 } : undefined}>
                  {item.content}
                </span>
              </div>
              {showTime && (
                <span className={`msg-time${isMine ? ' msg-time--mine' : ''}`}>{formatTime(item.createdAt)}</span>
              )}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171', fontSize: 13, padding: '6px 16px', textAlign: 'center', cursor: 'pointer' }}
          onClick={() => setError(null)}>
          {error} · tap to dismiss
        </div>
      )}

      {/* Input */}
      <form className="topic-chat-input-row" onSubmit={handleSend}>
        <input
          ref={inputRef}
          type="text"
          className="topic-chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={messages.length > 0 ? 'Reply to the conversation ✨' : 'Be the first to reply ✨'}
          maxLength={1000}
          autoFocus
        />
        <button type="submit" className="send-btn" disabled={!input.trim() || sending}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>
    </div>
  )
}
