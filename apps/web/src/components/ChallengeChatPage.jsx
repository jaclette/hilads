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
import i18n, { SUPPORTED, DEFAULT_LOCALE } from '../i18n'
import {
  fetchChallengeById, fetchChallengeMessages, sendChallengeMessage,
  fetchChallengeParticipants, toggleChallengeParticipation, validateChallenge,
  deleteChallenge,
} from '../api'
import AttendeeAvatars from './AttendeeAvatars'
import BackButton from './BackButton'
import MessageComposer from './MessageComposer'
import { linkifyText, extractFirstUrl } from '../linkify.jsx'
import LinkPreviewCard from './LinkPreviewCard'

// Slug builder — mirrors apps/web/api/sitemap.mjs:challengeSlug and
// apps/mobile/src/lib/challengeSlug.ts. Kept inline since it's a single
// 8-line function and not used elsewhere on the web SPA today.
function challengeSlug(challenge) {
  if (!challenge?.id) return ''
  const t = String(challenge.title || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return t ? `${t}-${challenge.id}` : challenge.id
}

// Build a localized share URL. Active-locale prefix (everything except 'en')
// is added so the recipient lands on the SSR-prerendered translated page
// instead of bouncing through a redirect. Mirrors mobile's sharePrefix().
function buildChallengeUrl(challenge) {
  const lang = i18n.language
  const lp = lang && lang !== DEFAULT_LOCALE && SUPPORTED.includes(lang) ? `/${lang}` : ''
  return `${window.location.origin}${lp}/challenge/${challengeSlug(challenge)}`
}

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
  onEdit,
  onDeleted,
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
  const [shareToast,   setShareToast]   = useState(false) // shown briefly after the clipboard fallback fires
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
      setMessages(prev => {
        // The WS broadcast almost always beats the HTTP response — when it
        // does, replace the matching optimistic row instead of appending,
        // otherwise we end up with the canonical msg twice (WS appended +
        // HTTP-replaced optimistic both carry the same server id).
        const optIdx = prev.findIndex(x =>
          typeof x.id === 'string' && x.id.startsWith('local-') &&
          x.guestId === m.guestId && (x.content ?? '') === (m.content ?? '')
        )
        if (optIdx >= 0) {
          const copy = [...prev]
          copy[optIdx] = m
          return copy
        }
        return [...prev, m].sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt))
      })
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

  // Delete: confirm before destructive action (this one IS destructive — not
  // the same as Validate). Closes the page on success.
  const handleDelete = useCallback(async () => {
    if (!guest?.guestId || busy) return
    if (!window.confirm(t('deleteBody'))) return
    setBusy('delete')
    try {
      await deleteChallenge(id, guest.guestId)
      onDeleted?.()
    } catch {
      window.alert(t('errSave'))
    } finally {
      setBusy(null)
    }
  }, [id, guest, busy, t, onDeleted])

  // Edit: hand off to the parent (App.jsx) which opens the CreateChallengePage
  // in edit mode. No need for a local edit form — single source of truth.
  const handleEdit = useCallback(() => {
    if (!challenge) return
    onEdit?.(challenge)
  }, [challenge, onEdit])

  // Share — Web Share API where available (mobile Safari + Chromium-on-Android +
  // PWA), clipboard fallback otherwise (desktop browsers). Defensive pre-copy
  // mirrors TopicChatPage: the system share sheet's "Copy" button can otherwise
  // concatenate title + url with a space, producing a broken paste. Pass just
  // { title, url } to navigator.share so the URL stays clean.
  const handleShare = useCallback(async () => {
    if (!challenge) return
    const url = buildChallengeUrl(challenge)
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(url) } catch (_) {}
    }
    if (navigator.share) {
      try { await navigator.share({ title: challenge.title, url }) } catch (_) {}
      return
    }
    // Already attempted clipboard above — flash the toast so the user knows.
    setShareToast(true)
    setTimeout(() => setShareToast(false), 1800)
  }, [challenge])

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
      <div className="full-page topic-chat-page">
        <div className="page-header topic-chat-header"><BackButton onClick={onBack} /></div>
        <div className="topic-chat-empty">{t('notFound')}</div>
      </div>
    )
  }

  const typeIcon = TYPE_ICONS[challenge.challenge_type] || '🔥'
  const audienceLabel = challenge.audience === 'locals' ? t('forLocals') : t('forExplorers')

  // Separate the creator from the other participants. Creator-match is by
  // user_id OR guest_id (matches the ownership logic used elsewhere). The
  // members list comes from challenge_participants which always includes the
  // creator (they're auto-joined at create time).
  const creator = participants.find(p =>
    (challenge.created_by && p.id === challenge.created_by) ||
    (challenge.guest_id   && p.id === challenge.guest_id)
  )
  const otherParticipants = participants.filter(p => p !== creator)

  return (
    <div className="full-page topic-chat-page">
      {/* Header — back | title (true-centered) | big type emoji (right column).
          Both flanks are sized equal (back-button is 46px, emoji has min-width
          46px) so text-align:center on the middle column reads as visually
          centered on the screen. Long titles wrap on multiple lines via the
          existing word-break: break-word on .topic-chat-header-title. */}
      <div className="page-header topic-chat-header challenge-chat-header">
        <BackButton onClick={onBack} />
        <div className="topic-chat-header-center">
          <span className="topic-chat-header-title">{challenge.title}</span>
        </div>
        <span className="challenge-header-emoji" aria-hidden="true">{typeIcon}</span>
      </div>

      {/* Description band — type badge ("DÉFI BOUFFE") + audience pill
          + (when applicable) validated badge. Sits where the hangout
          description text sits. */}
      <div className="topic-chat-desc challenge-meta-row">
        <span className="challenge-badge challenge-badge--kind">
          {t(`typeBadge.${challenge.challenge_type}`).toUpperCase()}
        </span>
        <span className="challenge-badge challenge-badge--audience">{audienceLabel}</span>
        {isValidated && (
          <span className="challenge-badge challenge-badge--validated">
            ✓ {t('validatedBadge')}
          </span>
        )}
      </div>

      {/* Challenger — explicitly distinguished from other participants. The
          crown emoji + Challenger pill make the originating user visible at
          a glance. */}
      {creator && (
        <div className="challenge-creator-row">
          <span
            className="challenge-creator-avatar"
            style={{ background: `linear-gradient(135deg, ${avatarColors(creator.displayName)[0]}, ${avatarColors(creator.displayName)[1]})` }}
          >
            {creator.thumbAvatarUrl || creator.avatarUrl
              ? <img src={creator.thumbAvatarUrl ?? creator.avatarUrl} alt="" className="challenge-creator-avatar-img" />
              : (creator.displayName ?? '?')[0].toUpperCase()}
          </span>
          <div className="challenge-creator-info">
            <span className="challenge-creator-name">{creator.displayName}</span>
            <span className="challenge-creator-tag">👑 {t('challengerTag')}</span>
          </div>
        </div>
      )}

      {/* Other participants — only render the strip when there's at least
          one acceptor besides the creator. */}
      {otherParticipants.length > 0 && (
        <div className="topic-members-strip challenge-participants-strip" style={{ pointerEvents: 'none' }}>
          <AttendeeAvatars
            preview={otherParticipants.slice(0, 5).map(p => ({
              id: p.id, displayName: p.displayName,
              thumbAvatarUrl: p.thumbAvatarUrl ?? p.avatarUrl,
            }))}
            total={otherParticipants.length}
          />
          <span className="topic-members-label">
            {t('participantsLabel')} · {otherParticipants.length}
          </span>
        </div>
      )}

      {/* Share row — always visible, brand-orange tinted pill. Lives above
          the chat so it reads as a primary social action ("rally friends")
          rather than a small header icon. The toast fires only when the
          browser has no Web Share API (desktop fallback to clipboard). */}
      <div className="challenge-share-row">
        <button type="button" className="challenge-share-btn" onClick={handleShare}>
          <span aria-hidden="true">↗</span>
          <span>{t('shareCta')}</span>
        </button>
        {shareToast && (
          <span className="challenge-share-toast" role="status">
            {t('shareCopied')}
          </span>
        )}
      </div>

      {/* Owner action row — Validate (when not yet validated) + Edit + Delete.
          Same pill shape as topic-owner-btn for visual rhythm with hangouts. */}
      {isOwner && (
        <div className="topic-owner-row">
          {!isValidated && (
            <button className="topic-owner-btn challenge-validate-btn-inline" onClick={handleValidate} disabled={busy !== null}>
              {busy === 'validate' ? '…' : `✓ ${t('validateConfirm')}`}
            </button>
          )}
          <button className="topic-owner-btn" onClick={handleEdit} disabled={busy !== null}>
            ✏️ {t('editBtn')}
          </button>
          <button className="topic-owner-btn topic-owner-btn--danger" onClick={handleDelete} disabled={busy !== null}>
            {busy === 'delete' ? '…' : `🗑️ ${t('deleteBtn')}`}
          </button>
        </div>
      )}

      {/* Non-creator Accept CTA — kept as the prominent orange brand button
          because it's the primary first-time-visitor action. Hidden once the
          challenge is validated (no more accepting an archived challenge). */}
      {!isValidated && !isOwner && (
        <div className="challenge-actions">
          <button
            className={`challenge-accept-btn ${isParticipant ? 'challenge-accept-btn--in' : ''}`}
            onClick={handleAccept}
            disabled={busy === 'accept'}
          >
            {busy === 'accept' ? '…' : (isParticipant ? t('acceptedCta') : t('acceptCta'))}
          </button>
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
            {/* Reuse hangout's generic chat-empty copy — semantically the
                same ("no messages yet, be the first") and saves shipping
                duplicate keys across 19 locales. */}
            <strong>{t('feed.emptyTitle', { ns: 'hangout' })}</strong>
            <span>{t('feed.emptySub',  { ns: 'hangout' })}</span>
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
          open challenge — mirrors events, NOT the members-only hangout gate.
          MessageComposer passes the raw input event to onChange (not the
          string value), so we extract e.target.value here. */}
      {!isValidated && guest?.guestId && nickname && (
        <MessageComposer
          value={composer}
          onChange={(e) => setComposer(e.target.value)}
          onSubmit={handleSubmit}
          sending={sending}
          placeholder={t('titlePlaceholder')}
          showEmojiButton={false}
        />
      )}
    </div>
  )
}
