import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchTopicMessages, sendTopicMessage, sendTopicImageMessage, markTopicRead, uploadImage, resolveHangoutJoinRequest, requestToJoinHangout } from '../api'
import BackButton from './BackButton'
import ShareActionSheet from './ShareActionSheet'
import LocationPicker from './LocationPicker'
import MessageComposer from './MessageComposer'
import useMentions from '../hooks/useMentions'
import { splitContentByMentions } from '../lib/mentions'

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
  const normalized = typeof ts === 'string'
    ? ts.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1').replace(/([+-]\d{2})$/, '$1:00')
    : ts
  return new Date(normalized).getTime()
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function formatTime(ts) {
  const ms = toMs(ts)
  if (!ms) return ''
  const d   = new Date(ms)
  const now = new Date()
  const time      = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const today     = startOfDay(now)
  const yesterday = new Date(today.getTime() - 86_400_000)
  const msgDay    = startOfDay(d)
  if (msgDay.getTime() === today.getTime())     return time
  if (msgDay.getTime() === yesterday.getTime()) return `Yesterday · ${time}`
  const opts = { month: 'short', day: 'numeric' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return `${d.toLocaleDateString([], opts)} · ${time}`
}

async function shareTopic(title, topicId) {
  const url = `${window.location.origin}/t/${topicId}`
  const shareTitle = `💬 ${title}`

  // Defensive pre-copy: clean URL in clipboard before any system dialog can
  // mangle it on Copy. See App.jsx share() for the full reasoning — passing
  // `text` to navigator.share() can result in browsers concatenating fields
  // when the user picks Copy from the share dialog. Pass only { title, url }.
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(url) } catch (_) {}
  }

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

export default function TopicChatPage({ topic, guest, nickname, onBack, socket, sessionId, onViewProfile }) {
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
  // Members-only gate: true once the server returns 403 on the message load
  // (non-member / pending requester). Drops to false the moment a member accepts.
  const [gated,      setGated]      = useState(false)

  const knownIdsRef  = useRef(new Set())
  const bottomRef    = useRef(null)
  const inputRef     = useRef(null)
  const fileInputRef = useRef(null)
  const msgRefsMap   = useRef(new Map())
  const [highlightedMsgId, setHighlightedMsgId] = useState(null)

  // ── Reverse-infinite-scroll (older history) ──
  const [hasMore,      setHasMore]      = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const feedRef          = useRef(null)   // scroll container
  const oldestIdRef      = useRef(null)   // cursor for loadOlder
  const loadingOlderRef  = useRef(false)  // concurrency guard
  const skipAutoScrollRef = useRef(false) // suppress scroll-to-bottom when prepending older

  const icon = CATEGORY_ICONS[topic.category] ?? '💬'

  // ── Hangout request-to-join ──
  const [joinState, setJoinState] = useState('idle') // idle | requested | in
  const onResolveJoinRequest = useCallback((requestId, action) => {
    // First-write-wins server-side; the resolved item re-broadcasts over WS so
    // every participant's card updates. already_resolved races are swallowed.
    resolveHangoutJoinRequest(topic.id, requestId, action).catch(() => {})
  }, [topic.id])
  const handleRequestToJoin = useCallback(async () => {
    const res = await requestToJoinHangout(topic.id).catch(() => null)
    if (!res) return
    setJoinState(res.status === 'already_participant' ? 'in' : 'requested')
  }, [topic.id])

  const mentions = useMentions({ context: 'topic', channelId: topic.id, value: input, setValue: setInput, inputRef })

  function renderMessageContent(item) {
    return splitContentByMentions(item.content ?? '', item.mentions).map((seg, i) =>
      seg.type === 'text'
        ? <span key={i}>{seg.text}</span>
        : <span key={i} className="msg-mention" onClick={e => { e.stopPropagation(); onViewProfile?.(seg.userId, seg.username) }}>@{seg.username}</span>
    )
  }

  // Load + poll messages
  const loadMessages = useCallback(async () => {
    try {
      const isInitial = oldestIdRef.current === null
      const data = await fetchTopicMessages(topic.id)
      // Members-only: non-member (incl. pending requester) → gated state.
      if (data.forbidden) { setGated(true); setLoading(false); return }
      setGated(false)
      const msgs = data.messages ?? []
      const fresh = msgs.filter(m => !knownIdsRef.current.has(m.id ?? `${m.guestId}:${m.createdAt}`))
      if (fresh.length > 0) {
        fresh.forEach(m => knownIdsRef.current.add(m.id ?? `${m.guestId}:${m.createdAt}`))
        setMessages(prev => [...prev, ...fresh].sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt)))
      }
      // First load seeds the reverse-scroll cursor + hasMore; polls leave them.
      if (isInitial && msgs.length > 0) {
        oldestIdRef.current = msgs[0]?.id ?? null
        setHasMore(data.hasMore ?? false)
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

  // WS — join topic room for live message delivery, leave on unmount.
  // Gated (pending) users do NOT join: the WS server can't verify membership,
  // so joining would leak live message broadcasts despite the HTTP 403.
  useEffect(() => {
    if (!socket || !sessionId || gated) return
    socket.joinTopic(topic.id, sessionId)
    const off = socket.on('newMessage', (data) => {
      if (data.channelId !== topic.id) return
      const msg = data.message
      if (!msg) return
      const key = msg.id ?? `${msg.guestId}:${msg.createdAt}`
      // join_request items are mutable (pending → resolved): the resolve
      // re-broadcasts the same id — upsert it in place so the CTAs resolve live.
      if (msg.type === 'join_request' && knownIdsRef.current.has(key)) {
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: msg.content } : m))
        return
      }
      if (knownIdsRef.current.has(key)) return
      knownIdsRef.current.add(key)
      setMessages(prev => [...prev, msg].sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt)))
    })
    return () => {
      off()
      socket.leaveTopic(topic.id, sessionId)
    }
  }, [topic.id, socket, sessionId, gated])

  // Fallback poll — catches messages if WS is down; also re-checks membership
  // while gated (faster) so the conversation unlocks right after acceptance.
  useEffect(() => {
    const id = setInterval(loadMessages, gated ? 15_000 : 30_000)
    return () => clearInterval(id)
  }, [loadMessages, gated])

  useEffect(() => {
    // Skip the jump-to-bottom when older messages were just prepended.
    if (skipAutoScrollRef.current) { skipAutoScrollRef.current = false; return }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Load the previous page when scrolled near the top; prepend + preserve anchor.
  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasMore || !oldestIdRef.current) return
    const container = feedRef.current
    const heightBefore = container?.scrollHeight ?? 0
    const topBefore    = container?.scrollTop    ?? 0
    loadingOlderRef.current = true
    setLoadingOlder(true)
    try {
      const data = await fetchTopicMessages(topic.id, { beforeId: oldestIdRef.current })
      const older = (data.messages ?? []).filter(m => !knownIdsRef.current.has(m.id ?? `${m.guestId}:${m.createdAt}`))
      if (older.length > 0) {
        older.forEach(m => knownIdsRef.current.add(m.id ?? `${m.guestId}:${m.createdAt}`))
        oldestIdRef.current = data.messages[0]?.id ?? oldestIdRef.current
        skipAutoScrollRef.current = true
        setMessages(prev => [...older, ...prev].sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt)))
      }
      setHasMore(data.hasMore ?? false)
      requestAnimationFrame(() => {
        if (container) container.scrollTop = topBefore + (container.scrollHeight - heightBefore)
      })
    } catch {
      // silent — user can scroll up again to retry
    } finally {
      loadingOlderRef.current = false
      setLoadingOlder(false)
    }
  }, [hasMore, topic.id])

  function handleFeedScroll() {
    const container = feedRef.current
    if (container && container.scrollTop < 200 && !loadingOlderRef.current && hasMore) loadOlder()
  }

  async function handleSend(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text || !guest || sending) return

    const built = mentions.buildAndReset(text)
    const localId = `local-${Date.now()}`
    const optimistic = {
      id:        localId,
      type:      'text',
      guestId:   guest.guestId,
      nickname:  nickname,
      content:   text,
      createdAt: Date.now() / 1000,
      mentions:  built.length ? built : undefined,
      _local:    true,
    }

    setMessages(prev => [...prev, optimistic])
    setInput('')
    setSending(true)
    setError(null)

    try {
      const data = await sendTopicMessage(topic.id, guest.guestId, nickname, text, built.length ? built : null)
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
          aria-label="Share hangout"
          title="Share this hangout"
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

      {gated ? (
        /* Members-only gate — pending requesters cannot read or post. */
        <div className="topic-gated">
          <span className="topic-gated-emoji">🔒</span>
          <strong className="topic-gated-title">Members-only hangout</strong>
          <span className="topic-gated-sub">
            {joinState === 'requested'
              ? "Request pending — you'll be able to join the conversation once a member accepts."
              : 'Request to join to see the conversation and chat.'}
          </span>
          {joinState !== 'requested' && (
            <button className="topic-join-btn" onClick={handleRequestToJoin}>Request to join</button>
          )}
        </div>
      ) : (
      <>
      {/* Messages area */}
      <div className="topic-chat-feed" ref={feedRef} onScroll={handleFeedScroll}>
        {loadingOlder && (
          <div className="messages-load-older"><span className="messages-load-older-spinner" /></div>
        )}
        {!hasMore && !loadingOlder && messages.length > 0 && (
          <div className="messages-beginning">Beginning of conversation</div>
        )}
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

          // Hangout join-request feed item — Accept/Reject (pending) or resolved.
          if (item.type === 'join_request') {
            let jr = {}
            try { jr = JSON.parse(item.content ?? '{}') } catch { /* malformed */ }
            const name = jr.requesterName ?? 'Someone'
            return (
              <div key={item.id ?? idx} className="join-req-card">
                <span className="join-req-text">
                  <strong>{name}</strong>
                  {jr.status === 'pending' ? ' wants to join' : jr.status === 'accepted' ? ' joined the hangout' : ' asked to join'}
                </span>
                {jr.status === 'pending' ? (
                  <div className="join-req-btns">
                    <button className="join-req-reject" onClick={() => onResolveJoinRequest?.(jr.requestId, 'reject')}>Decline</button>
                    <button className="join-req-accept" onClick={() => onResolveJoinRequest?.(jr.requestId, 'accept')}>Accept</button>
                  </div>
                ) : jr.status === 'accepted' ? (
                  <span className="join-req-resolved">Accepted{jr.resolvedByName ? ` by ${jr.resolvedByName}` : ''}</span>
                ) : (
                  <span className="join-req-resolved muted">Request declined</span>
                )}
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
                    : <span className="msg-text">{renderMessageContent(item)}</span>
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
      <MessageComposer
        inputRef={inputRef}
        fileInputRef={fileInputRef}
        value={input}
        onChange={e => mentions.onValueChange(e.target.value)}
        onSubmit={handleSend}
        onFileSelect={handleImageSelect}
        onShareClick={() => setShowShareSheet(true)}
        showEmojiButton={false}
        placeholder={messages.length > 0 ? 'Reply to the conversation…' : 'Start the vibe ✨'}
        mentionSuggestions={mentions.suggestions}
        onMentionSelect={mentions.selectMention}
        uploading={uploading}
        sending={sending}
        spotLoading={spotLoading}
        autoFocus
      />
      </>
      )}
    </div>
  )
}
