import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchTopicMessages, sendTopicMessage, sendTopicImageMessage, markTopicRead, uploadImage } from '../api'
import BackButton from './BackButton'
import ShareActionSheet from './ShareActionSheet'
import LocationPicker from './LocationPicker'

const CATEGORY_ICONS = { general: '🗣️', tips: '💡', food: '🍴', drinks: '🍺', help: '🙋', meetup: '👋' }
const MODE_META  = { local: { emoji: '🌍', label: 'Local' }, exploring: { emoji: '🧭', label: 'Exploring' } }
const VIBE_META  = { party: { emoji: '🔥' }, board_games: { emoji: '🎲' }, coffee: { emoji: '☕' }, music: { emoji: '🎵' }, food: { emoji: '🍜' }, chill: { emoji: '🧘' } }

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

async function shareTopic(title, topicId) {
  const url = `${window.location.origin}/t/${topicId}`
  const shareTitle = `💬 ${title}`
  if (navigator.share) {
    try { await navigator.share({ title: shareTitle, url }); return null } catch (_) { return null }
  }
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(url); return 'copied' } catch (_) {}
  }
  try {
    const el = document.createElement('input')
    el.value = url
    el.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
    document.body.appendChild(el)
    el.focus(); el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
    return 'copied'
  } catch (_) {}
  return null
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function TopicChatPage({ topic, guest, nickname, onBack, socket, sessionId }) {
  const [messages,   setMessages]   = useState([])
  const [input,      setInput]      = useState('')
  const [sending,    setSending]    = useState(false)
  const [uploading,  setUploading]  = useState(false)
  const [error,      setError]      = useState(null)
  const [showShareSheet,       setShowShareSheet]       = useState(false)
  const [spotLoading,          setSpotLoading]          = useState(false)
  const [locationPickerCoords, setLocationPickerCoords] = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [copied,     setCopied]     = useState(false)

  const knownIdsRef  = useRef(new Set())
  const bottomRef    = useRef(null)
  const inputRef     = useRef(null)
  const fileInputRef = useRef(null)
  const msgRefsMap   = useRef(new Map())
  const [highlightedMsgId, setHighlightedMsgId] = useState(null)

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

  useEffect(() => {
    loadMessages()
    if (guest?.guestId) markTopicRead(topic.id, guest.guestId)
  }, [topic.id, guest?.guestId, loadMessages])

  // WS — join topic room for live message delivery, leave on unmount
  useEffect(() => {
    if (!socket || !sessionId) return
    socket.joinTopic(topic.id, sessionId)
    const off = socket.on('newMessage', (data) => {
      if (data.channelId !== topic.id) return
      const msg = data.message
      if (!msg) return
      const key = msg.id ?? `${msg.guestId}:${msg.createdAt}`
      if (knownIdsRef.current.has(key)) return
      knownIdsRef.current.add(key)
      setMessages(prev => [...prev, msg].sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt)))
    })
    return () => {
      off()
      socket.leaveTopic(topic.id, sessionId)
    }
  }, [topic.id, socket, sessionId])

  // Fallback poll — catches messages if WS is temporarily down
  useEffect(() => {
    const id = setInterval(loadMessages, 30_000)
    return () => clearInterval(id)
  }, [loadMessages])

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

  function scrollToMessage(id) {
    const el = msgRefsMap.current.get(id)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedMsgId(id)
    setTimeout(() => setHighlightedMsgId(null), 1500)
  }

  async function handleShare() {
    const result = await shareTopic(topic.title, topic.id)
    if (result === 'copied') {
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    }
  }

  async function handleMySpot() {
    setShowShareSheet(false)
    setSpotLoading(true)
    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 })
      )
      setLocationPickerCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
    } catch (err) {
      console.error('[spot/pulse]', err)
      setError("Couldn't get your location. Please enable location access and try again.")
    } finally {
      setSpotLoading(false)
    }
  }

  async function handleLocationConfirm({ place, address, lat, lng }) {
    setLocationPickerCoords(null)
    const label = place || 'somewhere'
    const coordLine = `${lat.toFixed(6)},${lng.toFixed(6)}`
    const text = address
      ? `📍 ${nickname} is at ${label}\n${coordLine}\n${address}`
      : `📍 ${nickname} is at ${label}\n${coordLine}`
    // Send as a regular text message
    const localId = `local-${Date.now()}`
    const optimistic = {
      id: localId, type: 'text', guestId: guest.guestId, nickname,
      content: text, createdAt: Date.now() / 1000, _local: true,
    }
    setMessages(prev => [...prev, optimistic])
    setSending(true)
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
    }
  }

  async function handleImageSelect(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !guest) return

    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.type)) {
      setError('Please select a JPEG, PNG, or WebP image.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Image too large. Max 10 MB.')
      return
    }

    setUploading(true)
    setError(null)
    try {
      const { url } = await uploadImage(file)
      const data = await sendTopicImageMessage(topic.id, guest.guestId, nickname, url)
      const msg = data.message ?? data
      knownIdsRef.current.add(msg.id)
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev
        return [...prev, msg].sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt))
      })
    } catch (err) {
      console.error('[topic-send-image] failed:', err)
      setError("Couldn't send image. Please try again.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="full-page topic-chat-page">
      {/* Header — topic-specific: back | title (wraps) | share */}
      <div className="page-header topic-chat-header">
        <BackButton onClick={onBack} />
        <div className="topic-chat-header-center">
          <span className="topic-chat-header-icon">{icon}</span>
          <span className="topic-chat-header-title">{topic.title}</span>
        </div>
        <button
          className="topic-share-btn"
          onClick={handleShare}
          aria-label="Share pulse"
          title="Share this pulse"
        >
          {copied
            ? <span className="topic-share-copied">✓</span>
            : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
            )
          }
        </button>
      </div>

      {/* Description band */}
      {topic.description && (
        <div className="topic-chat-desc">{topic.description}</div>
      )}

      {/* Messages area */}
      <div className="topic-chat-feed">
        {loading && messages.length === 0 && (
          <div className="topic-chat-empty">
            <span className="topic-chat-empty-icon">💬</span>
            <span>Loading…</span>
          </div>
        )}
        {!loading && messages.length === 0 && (
          <div className="topic-chat-empty">
            <span className="topic-chat-empty-icon">✨</span>
            <strong>No replies yet</strong>
            <span>Be the first to jump in</span>
          </div>
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
            <div
              key={item.id ?? idx}
              ref={el => { if (item.id) { if (el) msgRefsMap.current.set(item.id, el); else msgRefsMap.current.delete(item.id) } }}
              className={['message', isMine ? 'mine' : '', isGrouped ? 'grouped' : '', 'animate', highlightedMsgId === item.id ? 'msg-highlight' : ''].filter(Boolean).join(' ')}
            >
              {!isMine && !isGrouped && (
                <div className="msg-meta">
                  <span className="msg-avatar" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                    {(item.nickname ?? '?')[0].toUpperCase()}
                  </span>
                  <span className="msg-author" style={{ color: c1 }}>{item.nickname}</span>
                  {(() => { const m = item.mode || 'exploring'; return MODE_META[m] ? <span className={`msg-mode msg-mode--${m}`}>{MODE_META[m].emoji} {MODE_META[m].label}</span> : null; })()}
                  {item.vibe && VIBE_META[item.vibe] && (
                    <span className="msg-vibe">{VIBE_META[item.vibe].emoji}</span>
                  )}
                  {item.contextBadge?.key === 'host' && (
                    <span className="badge-pill badge-pill--host">{item.contextBadge.label}</span>
                  )}
                </div>
              )}
              <div
                className={`msg-bubble-wrap ${isMine ? 'mine' : ''} ${isGrouped && !isMine ? 'grouped' : ''}`}
                style={item.status === 'failed' ? { opacity: 0.5 } : item.status === 'sending' ? { opacity: 0.7 } : undefined}
              >
                <div className="msg-content">
                  {item.replyTo && (
                    <div
                      className={`msg-reply-quote${item.replyTo.id ? ' msg-reply-quote--tappable' : ''}`}
                      onClick={item.replyTo.id ? () => scrollToMessage(item.replyTo.id) : undefined}
                    >
                      <span className="msg-reply-quote-name">{item.replyTo.nickname}</span>
                      <span className="msg-reply-quote-text">
                        {item.replyTo.type === 'image' ? '📷 Photo' : (item.replyTo.content || 'Original message unavailable')}
                      </span>
                    </div>
                  )}
                  {item.type === 'image' && item.imageUrl
                    ? <img src={item.imageUrl} alt="" className="msg-image" style={{ maxWidth: '100%', borderRadius: 10, display: 'block' }} />
                    : <span className="msg-text">{item.content}</span>
                  }
                </div>
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

      {/* Location picker */}
      {locationPickerCoords && (
        <LocationPicker
          initialLat={locationPickerCoords.lat}
          initialLng={locationPickerCoords.lng}
          nickname={nickname}
          onConfirm={handleLocationConfirm}
          onClose={() => setLocationPickerCoords(null)}
        />
      )}

      {/* Share action sheet */}
      {showShareSheet && (
        <ShareActionSheet
          onSnap={() => { setShowShareSheet(false); fileInputRef.current?.click() }}
          onSpot={handleMySpot}
          onClose={() => setShowShareSheet(false)}
          spotLoading={spotLoading}
        />
      )}

      {/* Input */}
      <form className="topic-chat-input-row" onSubmit={handleSend}>
        {/* Hidden file picker */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleImageSelect}
        />
        <button
          type="button"
          className="vibe-btn"
          title="Share something"
          disabled={uploading || sending || spotLoading}
          onClick={() => setShowShareSheet(true)}
        >
          {uploading || spotLoading ? <span className="upload-spinner" /> : '✨'}
        </button>
        <input
          ref={inputRef}
          type="text"
          className="topic-chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={messages.length > 0 ? 'Reply to the conversation…' : 'Start the vibe ✨'}
          maxLength={1000}
          autoFocus
        />
        <button type="submit" className="send-btn" disabled={!input.trim() || sending || uploading || spotLoading}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>
    </div>
  )
}
