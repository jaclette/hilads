import { useState, useEffect, useRef } from 'react'
import { fetchConversationMessages, sendConversationMessage, sendConversationImageMessage, markConversationRead, uploadImage } from '../api'
import BackButton from './BackButton'
import SendButton from './SendButton'
import EmojiPicker from './EmojiPicker'
import ShareActionSheet from './ShareActionSheet'
import LocationPicker from './LocationPicker'

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
  const [messages, setMessages]       = useState([])
  const [input, setInput]             = useState('')
  const [sending, setSending]         = useState(false)
  const [uploading, setUploading]     = useState(false)
  const [error, setError]             = useState(null)
  const [showEmoji, setShowEmoji]       = useState(false)
  const [lightboxUrl, setLightboxUrl]   = useState(null)
  const [showShareSheet, setShowShareSheet]         = useState(false)
  const [spotLoading, setSpotLoading]               = useState(false)
  const [locationPickerCoords, setLocationPickerCoords] = useState(null)
  const bottomRef                     = useRef(null)
  const knownIds                      = useRef(new Set())
  const fileRef                       = useRef(null)
  const dmInputRef                    = useRef(null)
  const msgRefsMap                    = useRef(new Map())
  const [highlightedMsgId, setHighlightedMsgId] = useState(null)

  const otherName = otherUser?.display_name ?? '?'
  const [c1, c2] = avatarColors(otherName)

  // Close lightbox on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setLightboxUrl(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  function scrollToMessage(id) {
    const el = msgRefsMap.current.get(id)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedMsgId(id)
    setTimeout(() => setHighlightedMsgId(null), 1500)
  }

  async function handleImageSelect(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.type)) {
      setError('Please select a JPEG, PNG, or WebP image.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Image too large. Max size: 10 MB.')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const { url } = await uploadImage(file)
      const { message } = await sendConversationImageMessage(conversation.id, url)
      knownIds.current.add(message.id)
      setMessages(prev => [...prev, message])
    } catch (err) {
      setError(err.message || "Couldn't send image. Please try again.")
    } finally {
      setUploading(false)
    }
  }

  function insertEmoji(emoji) {
    const el = dmInputRef.current
    if (!el) { setInput(prev => prev + emoji); setShowEmoji(false); return }
    const start = el.selectionStart ?? input.length
    const end   = el.selectionEnd   ?? input.length
    setInput(prev => prev.slice(0, start) + emoji + prev.slice(end))
    setShowEmoji(false)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + emoji.length, start + emoji.length)
    })
  }

  async function doSendText(content) {
    if (!content || sending) return
    setSending(true)
    setError(null)
    try {
      const { message } = await sendConversationMessage(conversation.id, content)
      knownIds.current.add(message.id)
      setMessages(prev => [...prev, message])
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  async function handleSend(e) {
    e.preventDefault()
    const content = input.trim()
    if (!content) return
    setInput('')
    await doSendText(content)
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
      console.error('[spot/dm]', err)
      setError("Couldn't get your location. Please enable location access and try again.")
    } finally {
      setSpotLoading(false)
    }
  }

  async function handleLocationConfirm({ place, address, lat, lng }) {
    setLocationPickerCoords(null)
    const nickname = account?.display_name ?? 'Someone'
    const label = place || 'somewhere'
    const coordLine = `${lat.toFixed(6)},${lng.toFixed(6)}`
    const text = address
      ? `📍 ${nickname} is at ${label}\n${coordLine}\n${address}`
      : `📍 ${nickname} is at ${label}\n${coordLine}`
    await doSendText(text)
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
            <div
              key={msg.id ?? msg.localId ?? i}
              ref={el => { if (msg.id) { if (el) msgRefsMap.current.set(msg.id, el); else msgRefsMap.current.delete(msg.id) } }}
            >
              {dateLabel && (
                <div className="date-sep">
                  <span className="date-sep-label">{dateLabel}</span>
                </div>
              )}
              <div className={`dm-bubble-wrap${isMe ? ' dm-bubble-wrap--me' : ''}${isGrouped ? ' dm-bubble-wrap--grouped' : ''}${highlightedMsgId === msg.id ? ' dm-bubble-wrap--highlight' : ''}`}>
                {msg.type === 'image'
                  ? <img
                      src={msg.image_url}
                      className="dm-image"
                      alt="shared image"
                      onClick={() => setLightboxUrl(msg.image_url)}
                    />
                  : msg.content?.startsWith('📍')
                    ? (() => {
                        const parts = msg.content.split('\n')
                        const line1 = parts[0] ?? ''
                        let lat, lng, addr
                        if (parts.length >= 3) {
                          const coordParts = (parts[1] ?? '').split(',')
                          lat = parseFloat(coordParts[0] ?? '')
                          lng = parseFloat(coordParts[1] ?? '')
                          if (isNaN(lat) || isNaN(lng) || coordParts.length !== 2) { lat = undefined; lng = undefined }
                          addr = lat !== undefined ? parts.slice(2).join('\n') : parts.slice(1).join('\n')
                        } else {
                          addr = parts.slice(1).join('\n')
                        }
                        const hasCoords = lat !== undefined && lng !== undefined
                        const mapsUrl = hasCoords ? `https://maps.google.com/?q=${lat},${lng}` : null
                        return (
                          <div
                            className={`loc-bubble${isMe ? ' loc-bubble--me' : ''}${hasCoords ? ' loc-bubble--tappable' : ''}`}
                            onClick={mapsUrl ? () => window.open(mapsUrl, '_blank', 'noopener') : undefined}
                          >
                            <span className="loc-bubble-icon">📍</span>
                            <div className="loc-bubble-body">
                              <span className="loc-bubble-place">{line1.replace('📍 ', '')}</span>
                              {addr && <span className="loc-bubble-addr">{addr}</span>}
                              {hasCoords && <span className="loc-bubble-tap">Tap to open in maps</span>}
                            </div>
                          </div>
                        )
                      })()
                    : <div className={`dm-bubble${isMe ? ' dm-bubble--me' : ''}`}>
                        {msg.replyTo && (
                          <div
                            className={`dm-reply-quote${msg.replyTo.id ? ' dm-reply-quote--tappable' : ''}`}
                            onClick={msg.replyTo.id ? () => scrollToMessage(msg.replyTo.id) : undefined}
                          >
                            <span className="dm-reply-quote-name">{msg.replyTo.nickname}</span>
                            <span className="dm-reply-quote-text">
                              {msg.replyTo.type === 'image' ? '📷 Photo' : (msg.replyTo.content || 'Original message unavailable')}
                            </span>
                          </div>
                        )}
                        <span className="msg-text">{msg.content}</span>
                      </div>
                }
              </div>
              {showTime && msg.created_at && (
                <div className={`dm-time${isMe ? ' dm-time--me' : ''}`}>{formatTime(msg.created_at)}</div>
              )}
            </div>
          )
        })}

        <div ref={bottomRef} />
      </div>

      {locationPickerCoords && (
        <LocationPicker
          initialLat={locationPickerCoords.lat}
          initialLng={locationPickerCoords.lng}
          nickname={account?.display_name ?? 'Someone'}
          onConfirm={handleLocationConfirm}
          onClose={() => setLocationPickerCoords(null)}
        />
      )}

      {/* Share action sheet */}
      {showShareSheet && (
        <ShareActionSheet
          onSnap={() => { setShowShareSheet(false); fileRef.current?.click() }}
          onSpot={handleMySpot}
          onClose={() => setShowShareSheet(false)}
          spotLoading={spotLoading}
        />
      )}

      {/* Composer */}
      <form className="dm-composer" onSubmit={handleSend}>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleImageSelect}
        />
        <button
          type="button"
          className="dm-vibe-btn"
          title="Share something"
          disabled={uploading || sending || spotLoading}
          onClick={() => setShowShareSheet(true)}
        >
          {uploading || spotLoading ? <span className="upload-spinner" style={{ width: 16, height: 16 }} /> : '✨'}
        </button>
        <div className="emoji-picker-wrap">
          <button
            type="button"
            className={`emoji-trigger${showEmoji ? ' emoji-trigger--active' : ''}`}
            title="Emoji"
            onClick={() => setShowEmoji(p => !p)}
          >
            😊
          </button>
          {showEmoji && (
            <EmojiPicker onSelect={insertEmoji} onClose={() => setShowEmoji(false)} />
          )}
        </div>
        <input
          ref={dmInputRef}
          className="dm-input"
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Message…"
          maxLength={1000}
          autoFocus
        />
        <SendButton disabled={sending || uploading || !input.trim()} />
      </form>

      {lightboxUrl && (
        <div className="lightbox-overlay" onClick={() => setLightboxUrl(null)}>
          <button className="lightbox-close" onClick={() => setLightboxUrl(null)}>✕</button>
          <img
            src={lightboxUrl}
            className="lightbox-img"
            alt="full-size preview"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
