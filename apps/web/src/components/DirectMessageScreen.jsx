import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { fetchConversationMessages, sendConversationMessage, sendConversationImageMessage, markConversationRead, uploadImage, editDmMessage, deleteDmMessage } from '../api'
import BackButton from './BackButton'
import ShareActionSheet from './ShareActionSheet'
import LocationPicker from './LocationPicker'
import MessageComposer from './MessageComposer'
import Lightbox from './Lightbox'
import { linkifyText, extractFirstUrl } from '../linkify.jsx'
import LinkPreviewCard from './LinkPreviewCard'

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
  const d   = new Date(ms)
  const now = new Date()
  const time      = d.toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit' })
  const today     = startOfDay(now)
  const yesterday = new Date(today.getTime() - 86_400_000)
  const msgDay    = startOfDay(d)
  if (msgDay.getTime() === today.getTime())     return time
  if (msgDay.getTime() === yesterday.getTime()) return `${i18n.t('time.yesterday', { ns: 'common' })} · ${time}`
  const opts = { month: 'short', day: 'numeric' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return `${d.toLocaleDateString(i18n.language, opts)} · ${time}`
}

function formatDateLabel(ts) {
  const ms = tsToMs(ts)
  if (!ms) return ''
  const d   = new Date(ms)
  const now = new Date()
  const today     = startOfDay(now)
  const yesterday = new Date(today.getTime() - 86_400_000)
  const msgDay    = startOfDay(d)
  if (msgDay.getTime() === today.getTime())     return i18n.t('time.today', { ns: 'common' })
  if (msgDay.getTime() === yesterday.getTime()) return i18n.t('time.yesterday', { ns: 'common' })
  const opts = { month: 'short', day: 'numeric' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString(i18n.language, opts)
}

export default function DirectMessageScreen({ conversation, otherUser, account, socket, onBack }) {
  const { t } = useTranslation('dm')
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

  // ── Reverse-infinite-scroll (older history) ──
  const [hasMore,      setHasMore]      = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const feedRef           = useRef(null)
  const oldestIdRef       = useRef(null)
  const loadingOlderRef   = useRef(false)
  const skipAutoScrollRef = useRef(false)
  const [highlightedMsgId, setHighlightedMsgId] = useState(null)
  // Action menu - opened by clicking own bubble. { msg, x, y } | null
  const [actionMsg, setActionMsg] = useState(null)
  // Edit mode - pre-fills input, toggles handleSend to save instead of send.
  const [editingMsg, setEditingMsg] = useState(null)

  const otherName = otherUser?.display_name ?? '?'
  const [c1, c2] = avatarColors(otherName)

  // Escape-to-close is owned by <Lightbox>; we just gate the open state here.

  // Load message history and mark as read immediately on open
  useEffect(() => {
    markConversationRead(conversation.id) // fire-and-forget; UI already cleared optimistically
    fetchConversationMessages(conversation.id)
      .then(data => {
        knownIds.current = new Set(data.messages.map(m => m.id))
        setMessages(data.messages)
        oldestIdRef.current = data.messages[0]?.id ?? null // ASC → [0] oldest
        setHasMore(data.hasMore ?? false)
      })
      .catch(() => setError(t('thread.loadError')))
  }, [conversation.id])

  // Join WS DM room and listen for new messages
  useEffect(() => {
    if (!socket || !account?.id) return
    socket.joinConversation(conversation.id, account.id)

    socket.on('newConversationMessage', ({ conversationId, message }) => {
      if (conversationId !== conversation.id) return
      if (knownIds.current.has(message.id)) return
      knownIds.current.add(message.id)
      // Own-message echo: if we have a pending optimistic from the same sender,
      // replace it instead of appending to avoid a brief duplicate bubble.
      const isOwnMsg = message.sender_id === account.id
      setMessages(prev => {
        if (isOwnMsg) {
          const pendingIdx = prev.findIndex(m => m.localId != null)
          if (pendingIdx !== -1) {
            const updated = [...prev]
            updated[pendingIdx] = message
            return updated
          }
        }
        return [...prev, message]
      })
    })

    socket.on('dmMessageEdited', ({ conversationId, messageId, content, editedAt }) => {
      if (conversationId !== conversation.id) return
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, content, edited_at: editedAt ?? new Date().toISOString() } : m))
    })
    socket.on('dmMessageDeleted', ({ conversationId, messageId, deletedAt }) => {
      if (conversationId !== conversation.id) return
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, content: '', image_url: undefined, deleted_at: deletedAt ?? new Date().toISOString() } : m))
    })

    return () => {
      socket.leaveConversation(conversation.id, account.id)
    }
  }, [conversation.id, account?.id, socket])

  // Scroll to bottom on new messages - but not when older messages were just prepended
  useEffect(() => {
    if (skipAutoScrollRef.current) { skipAutoScrollRef.current = false; return }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Load the previous page when scrolled near the top; prepend + preserve anchor.
  async function loadOlder() {
    if (loadingOlderRef.current || !hasMore || !oldestIdRef.current) return
    const container = feedRef.current
    const heightBefore = container?.scrollHeight ?? 0
    const topBefore    = container?.scrollTop    ?? 0
    loadingOlderRef.current = true
    setLoadingOlder(true)
    try {
      const data = await fetchConversationMessages(conversation.id, { beforeId: oldestIdRef.current })
      const older = (data.messages ?? []).filter(m => !knownIds.current.has(m.id))
      if (older.length > 0) {
        older.forEach(m => knownIds.current.add(m.id))
        oldestIdRef.current = data.messages[0]?.id ?? oldestIdRef.current
        skipAutoScrollRef.current = true
        setMessages(prev => [...older, ...prev]) // backend ASC + all older → order preserved
      }
      setHasMore(data.hasMore ?? false)
      requestAnimationFrame(() => {
        if (container) container.scrollTop = topBefore + (container.scrollHeight - heightBefore)
      })
    } catch {
      // silent - user can scroll up again to retry
    } finally {
      loadingOlderRef.current = false
      setLoadingOlder(false)
    }
  }

  function handleFeedScroll() {
    const container = feedRef.current
    if (container && container.scrollTop < 200 && !loadingOlderRef.current && hasMore) loadOlder()
  }

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
      setError(t('thread.imageType'))
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError(t('thread.imageTooLarge'))
      return
    }
    setUploading(true)
    setError(null)
    try {
      const { url } = await uploadImage(file)
      const { message } = await sendConversationImageMessage(conversation.id, url)
      knownIds.current.add(message.id)
      // Dedup: WS may have delivered the message while the upload was in-flight
      setMessages(prev => prev.some(m => m.id === message.id) ? prev : [...prev, message])
    } catch (err) {
      setError(err.message || t('thread.imageSend'))
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

    // Optimistic insert - message appears instantly without waiting for HTTP.
    const localId = `local-dm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const optimistic = {
      id:          localId,
      localId,
      sender_id:   account?.id ?? '',
      sender_name: account?.display_name ?? '',
      content,
      type:        'text',
      created_at:  new Date().toISOString(),
      status:      'sending',
    }
    knownIds.current.add(localId)
    setMessages(prev => [...prev, optimistic])

    setSending(true)
    setError(null)
    try {
      const { message } = await sendConversationMessage(conversation.id, content)
      knownIds.current.add(message.id)
      setMessages(prev => {
        // Case B - WS already replaced the optimistic: just clean up (no localId left)
        if (prev.some(m => m.id === message.id && m.id !== localId)) {
          return prev.filter(m => m.id !== localId)
        }
        // Case A - replace optimistic with confirmed server message
        return prev.map(m => m.id === localId ? message : m)
      })
    } catch (err) {
      setMessages(prev => prev.map(m => m.id === localId ? { ...m, status: 'failed' } : m))
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  async function handleSend(e) {
    e.preventDefault()
    const content = input.trim()
    if (!content) return
    // Edit mode short-circuits the normal send pipeline.
    if (editingMsg) {
      const current = editingMsg
      setEditingMsg(null)
      setInput('')
      if (content === current.content) return  // no-op when unchanged
      const stamp = new Date().toISOString()
      const prevContent = current.content
      setMessages(prev => prev.map(m => m.id === current.id ? { ...m, content, edited_at: stamp } : m))
      try {
        await editDmMessage(current.id, content)
      } catch (err) {
        console.error('[dm edit] failed:', err)
        setMessages(prev => prev.map(m => m.id === current.id ? { ...m, content: prevContent, edited_at: undefined } : m))
        setError(i18n.t('editFailed', { ns: 'chat', defaultValue: "Couldn't save edit. Please try again." }))
        setTimeout(() => setError(null), 4000)
      }
      return
    }
    setInput('')
    await doSendText(content)
  }

  async function handleDelete(msg) {
    const confirmed = window.confirm(i18n.t('deleteConfirmBody', { ns: 'chat', defaultValue: 'Delete this message? It will be removed for everyone.' }))
    if (!confirmed) return
    const prevContent = msg.content
    const prevImageUrl = msg.image_url
    const stamp = new Date().toISOString()
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: '', image_url: undefined, deleted_at: stamp } : m))
    try {
      await deleteDmMessage(msg.id)
    } catch (err) {
      console.error('[dm delete] failed:', err)
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content: prevContent, image_url: prevImageUrl, deleted_at: undefined } : m))
      setError(i18n.t('deleteFailed', { ns: 'chat', defaultValue: "Couldn't delete message. Please try again." }))
      setTimeout(() => setError(null), 4000)
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
      <div className="dm-messages" ref={feedRef} onScroll={handleFeedScroll}>
        {error && <p className="profile-error" style={{ margin: '12px 16px' }}>{error}</p>}

        {loadingOlder && (
          <div className="messages-load-older"><span className="messages-load-older-spinner" /></div>
        )}
        {!hasMore && !loadingOlder && messages.length > 0 && (
          <div className="messages-beginning">{t('thread.beginning')}</div>
        )}

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
                {msg.deleted_at
                  ? <div className={`dm-bubble${isMe ? ' dm-bubble--me' : ''} dm-bubble--deleted`}>
                      <span className="msg-text">{i18n.t('messageDeleted', { ns: 'chat', defaultValue: 'Message deleted' })}</span>
                    </div>
                  : msg.type === 'image'
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
                              {hasCoords && <span className="loc-bubble-tap">{t('thread.tapMaps')}</span>}
                            </div>
                          </div>
                        )
                      })()
                    : <div
                        className={`dm-bubble${isMe ? ' dm-bubble--me' : ''}`}
                        onClick={isMe ? (e) => {
                          const rect = e.currentTarget.getBoundingClientRect()
                          setActionMsg({ msg, x: rect.left, y: rect.top })
                        } : undefined}
                      >
                        {msg.replyTo && (
                          <div
                            className={`dm-reply-quote${msg.replyTo.id ? ' dm-reply-quote--tappable' : ''}`}
                            onClick={msg.replyTo.id ? (e) => { e.stopPropagation(); scrollToMessage(msg.replyTo.id) } : undefined}
                          >
                            <span className="dm-reply-quote-name">{msg.replyTo.nickname}</span>
                            <span className="dm-reply-quote-text">
                              {msg.replyTo.type === 'image' ? t('thread.photo') : (msg.replyTo.content || t('thread.unavailable'))}
                            </span>
                          </div>
                        )}
                        <span className="msg-text">
                          {linkifyText(msg.content)}
                          {msg.edited_at && (
                            <span className="msg-edited-tag">{` ${i18n.t('edited', { ns: 'chat', defaultValue: 'edited' })}`}</span>
                          )}
                        </span>
                        {(() => {
                          const u = extractFirstUrl(msg.content)
                          return u ? <LinkPreviewCard url={u} /> : null
                        })()}
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

      {/* Action menu - opens on own-bubble click. Same shape as App.jsx's
          action-bubble but minimal: just Copy / Edit / Delete (no reactions
          on DMs yet, no Reply UI in this screen). */}
      {actionMsg && (
        <div className="action-bubble-overlay" onClick={() => setActionMsg(null)}>
          <div
            className="action-bubble"
            style={{
              top:   Math.max(8, actionMsg.y - 64),
              right: 16,
              left:  'auto',
            }}
            onClick={e => e.stopPropagation()}
          >
            {actionMsg.msg.content && (
              <button
                className="action-bubble-btn"
                onClick={() => {
                  const text = actionMsg.msg.content ?? ''
                  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => {})
                  setActionMsg(null)
                }}
              >
                {i18n.t('actionCopy', { ns: 'chat', defaultValue: '📋 Copy' })}
              </button>
            )}
            {actionMsg.msg.content && !actionMsg.msg.content.startsWith('📍') && (actionMsg.msg.type ?? 'text') === 'text' && (
              <button
                className="action-bubble-btn"
                onClick={() => {
                  setEditingMsg({ id: actionMsg.msg.id, content: actionMsg.msg.content ?? '' })
                  setInput(actionMsg.msg.content ?? '')
                  setActionMsg(null)
                  dmInputRef.current?.focus()
                }}
              >
                {i18n.t('actionEdit', { ns: 'chat', defaultValue: '✏️ Edit' })}
              </button>
            )}
            <button
              className="action-bubble-btn action-bubble-btn--danger"
              onClick={() => {
                const msg = actionMsg.msg
                setActionMsg(null)
                handleDelete(msg)
              }}
            >
              {i18n.t('actionDelete', { ns: 'chat', defaultValue: '🗑️ Delete' })}
            </button>
          </div>
        </div>
      )}

      {editingMsg && (
        <div className="edit-preview">
          <div className="edit-preview-body">
            <span className="edit-preview-name">{i18n.t('editingBanner', { ns: 'chat', defaultValue: 'Editing message' })}</span>
            <span className="edit-preview-text">{editingMsg.content}</span>
          </div>
          <button
            className="edit-preview-close"
            type="button"
            onClick={() => { setEditingMsg(null); setInput('') }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Composer */}
      <MessageComposer
        inputRef={dmInputRef}
        fileInputRef={fileRef}
        value={input}
        onChange={e => setInput(e.target.value)}
        onSubmit={handleSend}
        onFileSelect={handleImageSelect}
        onShareClick={() => setShowShareSheet(true)}
        showEmoji={showEmoji}
        onEmojiToggle={() => setShowEmoji(p => !p)}
        onEmojiSelect={insertEmoji}
        onEmojiClose={() => setShowEmoji(false)}
        placeholder={t('thread.composer')}
        uploading={uploading}
        sending={sending}
        spotLoading={spotLoading}
        autoFocus
      />

      <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
    </div>
  )
}
