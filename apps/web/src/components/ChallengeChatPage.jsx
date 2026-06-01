/**
 * ChallengeChatPage — interactive web detail screen for /challenge/{slug}-{id}.
 *
 * Leaner than TopicChatPage by design: challenges are open (no members-only
 * gate, no join-request flow), and v1 web parity focuses on what a crawler-
 * arriving user can actually act on: see the challenge, accept it, chat about
 * it, validate if owner. Edit/delete, mentions, image messages, reactions,
 * reply — all deferred to mobile or a follow-up commit if needed.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  fetchChallengeById, fetchChallengeMessages, sendChallengeMessage,
  fetchChallengeParticipants, toggleChallengeParticipation, validateChallenge,
} from '../api'
import AttendeeAvatars from './AttendeeAvatars'
import BackButton from './BackButton'
import MessageComposer from './MessageComposer'
import { linkifyText, extractFirstUrl } from '../linkify.jsx'
import LinkPreviewCard from './LinkPreviewCard'

const TYPE_ICONS = { food: '🍜', place: '📍', culture: '🎭', help: '🤝' }

const AVATAR_PALETTES = [
  ['#7c6aff', '#c084fc'], ['#ff6a9f', '#fb7185'], ['#22d3ee', '#38bdf8'],
  ['#4ade80', '#34d399'], ['#fb923c', '#fbbf24'], ['#f472b6', '#e879f9'],
  ['#818cf8', '#60a5fa'], ['#2dd4bf', '#a3e635'],
]
function avatarColors(name = '') {
  const hash = name.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0)
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length]
}

function toMs(ts) {
  if (!ts) return 0
  if (typeof ts === 'number') return ts < 1e10 ? ts * 1000 : ts
  return new Date(typeof ts === 'string' ? ts.replace(' ', 'T') : ts).getTime()
}

function formatTime(ts) {
  const ms = toMs(ts)
  if (!ms) return ''
  const d = new Date(ms)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function ChallengeChatPage({
  challenge: initialChallenge,
  guest,
  nickname,
  account,
  onBack,
  socket,
  sessionId,
}) {
  const { t } = useTranslation('challenge')

  const [challenge,    setChallenge]    = useState(initialChallenge)
  const [participants, setParticipants] = useState([])
  const [messages,     setMessages]     = useState([])
  const [composer,     setComposer]     = useState('')
  const [sending,      setSending]      = useState(false)
  const [busy,         setBusy]         = useState(null) // 'accept' | 'validate' | null
  const [loading,      setLoading]      = useState(true)
  const feedRef    = useRef(null)
  const knownIds   = useRef(new Set())

  const id = challenge?.id

  // Owner = guest_id match OR registered user.id match. Mirrors mobile.
  const isOwner = !!(
    (account?.id     && challenge?.created_by && account.id     === challenge.created_by) ||
    (guest?.guestId  && challenge?.guest_id   && guest.guestId  === challenge.guest_id)
  )
  const isValidated = challenge?.status === 'validated'
  const isParticipant = !!(
    (account?.id    && participants.some(p => p.id === account.id)) ||
    (guest?.guestId && participants.some(p => p.id === guest.guestId))
  )

  // ── Loads ──────────────────────────────────────────────────────────────────

  const loadChallenge = useCallback(async () => {
    if (!id) return
    const data = await fetchChallengeById(id).catch(() => null)
    if (data?.challenge) setChallenge(data.challenge)
  }, [id])

  const loadParticipants = useCallback(async () => {
    if (!id) return
    const data = await fetchChallengeParticipants(id).catch(() => ({ participants: [] }))
    setParticipants(data.participants || [])
  }, [id])

  const loadMessages = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const data = await fetchChallengeMessages(id, { limit: 50 })
      const msgs = data.messages || []
      knownIds.current = new Set(msgs.map(m => m.id ?? `${m.guestId}:${m.createdAt}`))
      // API returns newest-last; we render oldest-first → sort by createdAt asc.
      setMessages(msgs.sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt)))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadParticipants()
    loadMessages()
  }, [loadParticipants, loadMessages])

  // ── WS subscriptions — live messages + validate flip ───────────────────────

  useEffect(() => {
    if (!socket || !sessionId || !id) return
    socket.joinChallenge(id, sessionId)
    const offMsg = socket.on('newMessage', (data) => {
      if (data.channelId !== id) return
      const m = data.message
      if (!m) return
      const key = m.id ?? `${m.guestId}:${m.createdAt}`
      if (knownIds.current.has(key)) return
      knownIds.current.add(key)
      setMessages(prev => [...prev, m].sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt)))
    })
    const offValidated = socket.on('challenge_validated', (data) => {
      if (data.challenge?.id === id) setChallenge(data.challenge)
    })
    return () => { offMsg(); offValidated(); socket.leaveChallenge(id, sessionId) }
  }, [id, socket, sessionId])

  // Auto-scroll to bottom on new message.
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight
  }, [messages.length])

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleAccept = useCallback(async () => {
    if (!guest?.guestId || busy) return
    setBusy('accept')
    try {
      await toggleChallengeParticipation(id, guest.guestId, nickname || null)
      await loadParticipants()
      await loadChallenge()
    } finally {
      setBusy(null)
    }
  }, [id, guest, nickname, busy, loadParticipants, loadChallenge])

  const handleValidate = useCallback(async () => {
    if (!guest?.guestId || busy) return
    if (!window.confirm(t('validateBody'))) return
    setBusy('validate')
    try {
      const updated = await validateChallenge(id, guest.guestId)
      setChallenge(updated)
    } catch (e) {
      window.alert(t('errSave'))
    } finally {
      setBusy(null)
    }
  }, [id, guest, busy, t])

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault()
    const content = composer.trim()
    if (!content || sending || isValidated) return
    if (!guest?.guestId || !nickname) return
    setSending(true)
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    // Optimistic insert.
    const optimistic = {
      id: localId, channelId: id, guestId: guest.guestId, nickname,
      content, createdAt: Date.now() / 1000, status: 'sending',
    }
    setMessages(prev => [...prev, optimistic])
    setComposer('')
    try {
      const sent = await sendChallengeMessage(id, guest.guestId, nickname, content)
      // Server returns the canonical message — replace the optimistic row.
      setMessages(prev => prev.map(m => m.id === localId ? sent : m))
      knownIds.current.add(sent.id)
    } catch (err) {
      setMessages(prev => prev.map(m => m.id === localId ? { ...m, status: 'failed' } : m))
    } finally {
      setSending(false)
    }
  }, [id, composer, sending, guest, nickname, isValidated])

  if (!challenge) {
    return (
      <div className="topic-chat-page">
        <div className="topic-chat-header"><BackButton onClick={onBack} /></div>
        <div className="topic-chat-empty">{t('notFound')}</div>
      </div>
    )
  }

  const typeIcon = TYPE_ICONS[challenge.challenge_type] || '🔥'
  const audienceLabel = challenge.audience === 'locals' ? t('forLocals') : t('forExplorers')

  return (
    <div className="topic-chat-page">
      {/* Header */}
      <div className="topic-chat-header">
        <BackButton onClick={onBack} />
        <div className="topic-chat-header-center">
          <span className="topic-chat-header-icon">{typeIcon}</span>
          <span className="topic-chat-header-title">{challenge.title}</span>
        </div>
        <div style={{ width: 36 }} />
      </div>

      {/* Hero badges — Challenge / audience / status */}
      <div className="challenge-hero">
        <span className="challenge-badge challenge-badge--kind">
          {t('createTitle').toUpperCase()}
        </span>
        <span className="challenge-badge challenge-badge--audience">
          {audienceLabel}
        </span>
        {isValidated && (
          <span className="challenge-badge challenge-badge--validated">
            ✓ {t('validatedBadge')}
          </span>
        )}
      </div>

      {/* Members strip — preview only (no modal in v1) */}
      {participants.length > 0 && (
        <div className="topic-members-strip" style={{ pointerEvents: 'none' }}>
          <AttendeeAvatars
            preview={participants.slice(0, 5).map(p => ({
              id: p.id, displayName: p.displayName,
              thumbAvatarUrl: p.thumbAvatarUrl ?? p.avatarUrl,
            }))}
            total={participants.length}
          />
          <span className="topic-members-label">
            {participants.length === 1
              ? participants[0].displayName
              : `${participants.length}`}
          </span>
        </div>
      )}

      {/* Action row — Accept (non-owner) or Validate (owner). Both hidden once
          validated; the chat stays read-only afterwards. */}
      {!isValidated && (
        <div className="challenge-actions">
          {isOwner ? (
            <button
              className="challenge-validate-btn"
              onClick={handleValidate}
              disabled={busy === 'validate'}
            >
              {busy === 'validate' ? '…' : `✓ ${t('validateConfirm')}`}
            </button>
          ) : (
            <button
              className={`challenge-accept-btn ${isParticipant ? 'challenge-accept-btn--in' : ''}`}
              onClick={handleAccept}
              disabled={busy === 'accept'}
            >
              {busy === 'accept' ? '…' : (isParticipant ? t('acceptedCta') : t('acceptCta'))}
            </button>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="topic-chat-feed" ref={feedRef}>
        {loading && messages.length === 0 && (
          <div className="topic-chat-empty">
            <span className="topic-chat-empty-icon">💬</span>
          </div>
        )}
        {!loading && messages.length === 0 && (
          <div className="topic-chat-empty">
            <span className="topic-chat-empty-icon">✨</span>
            <span>{t('createTitle')}</span>
          </div>
        )}
        {messages.map((m, idx) => {
          const isMine    = m.guestId === guest?.guestId
          const prev      = messages[idx - 1]
          const isGrouped = prev?.guestId === m.guestId
          const [c1, c2]  = avatarColors(m.nickname)
          const opacity   = m.status === 'failed' ? 0.5 : m.status === 'sending' ? 0.7 : 1
          return (
            <div
              key={m.id ?? idx}
              className={['message', isMine ? 'mine' : '', isGrouped ? 'grouped' : ''].filter(Boolean).join(' ')}
            >
              {!isMine && !isGrouped && (
                <div className="msg-meta">
                  <span className="msg-avatar" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                    {(m.nickname ?? '?')[0].toUpperCase()}
                  </span>
                  <span className="msg-author" style={{ color: c1 }}>{m.nickname}</span>
                </div>
              )}
              <div className={`msg-bubble-wrap ${isMine ? 'mine' : ''}`} style={{ opacity }}>
                <div className="msg-content">
                  <span className="msg-text">{linkifyText(m.content || '')}</span>
                  {(() => { const u = extractFirstUrl(m.content); return u ? <LinkPreviewCard url={u} /> : null })()}
                </div>
              </div>
              <span className={`msg-time${isMine ? ' msg-time--mine' : ''}`}>{formatTime(m.createdAt)}</span>
            </div>
          )
        })}
      </div>

      {/* Composer — hidden when the challenge is validated; chat stays
          readable but no new posts. Anyone (including guests) can post on an
          open challenge — mirrors events, NOT the members-only hangout gate. */}
      {!isValidated && guest?.guestId && nickname && (
        <MessageComposer
          value={composer}
          onChange={setComposer}
          onSubmit={handleSubmit}
          sending={sending}
          placeholder={t('titlePlaceholder')}
          showEmojiButton={false}
        />
      )}
    </div>
  )
}
