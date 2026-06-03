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
  fetchChallengeById,
  fetchChallengeParticipants, validateChallenge,
  unvalidateChallenge, deleteChallenge,
  acceptChallenge, fetchMyAcceptances, AcceptChallengeError,
  fetchThreadMessages, sendThreadMessage, proposeDate,
} from '../api'
import AttendeeAvatars from './AttendeeAvatars'
import BackButton from './BackButton'
import ChallengePipeline from './ChallengePipeline'
import DatePickerModal from './DatePickerModal'
import MessageComposer from './MessageComposer'
import ThreadScheduleBlock from './ThreadScheduleBlock'

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
  const ms = toMs(ts); if (!ms) return ''
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function ChallengeChatPage({
  challenge: initialChallenge,
  guest,
  nickname,
  account,
  onBack,
  onEdit,
  onDeleted,
  onNeedAuth,    // host routes guest to sign-up gate
  onOpenMyProfile, // host opens this user's profile drawer (used by mode_* error CTAs)
  socket,
  sessionId,
}) {
  const { t } = useTranslation('challenge')

  const [challenge,    setChallenge]    = useState(initialChallenge)
  const [participants, setParticipants] = useState([])
  const [busy,         setBusy]         = useState(null) // 'accept' | 'status' | 'delete' | null
  const [shareToast,   setShareToast]   = useState(false) // shown briefly after the clipboard fallback fires
  // Themed in-app alert. Replaces window.alert() (which renders the ugly
  // "hilads.live says" browser modal). Shape: { emoji?, title, body, actionLabel?, onAction? }.
  const [alertModal, setAlertModal] = useState(null)
  // PR2/3/4 — full acceptance summary. Drives the Accept button morph + the
  // ChallengePipeline rendering. Null when I have no acceptance for this
  // challenge (visitor or creator on their own ad).
  const [myAcceptance, setMyAcceptance] = useState(null)
  const myThreadChannelId = myAcceptance?.thread_channel_id ?? null
  // Inline thread chat — messages + composer state. Mount only when there's
  // an active thread (myAcceptance != null).
  const [messages, setMessages] = useState([])
  const [composer, setComposer] = useState('')
  const [sending,  setSending]  = useState(false)
  const feedRef  = useRef(null)
  const knownIds = useRef(new Set())
  // Date picker opened from the pipeline sub-CTA when the viewer has an
  // acceptance but no proposal yet. Counter-propose has its own picker
  // inside ThreadScheduleBlock — they don't conflict.
  const [pickerOpen, setPickerOpen] = useState(false)

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

  useEffect(() => {
    loadParticipants()
  }, [loadParticipants])

  // ── WS subscriptions — challenge status flips (open ⇄ validated) only.
  // Per-thread chat messages aren't on this surface anymore (PR4+) — the
  // public chat that used to live here moved into per-acceptance threads.

  useEffect(() => {
    if (!socket || !id) return
    const onStatusFlip = (data) => {
      if (data.challenge?.id === id) setChallenge(data.challenge)
    }
    const offValidated   = socket.on('challenge_validated',   onStatusFlip)
    const offUnvalidated = socket.on('challenge_unvalidated', onStatusFlip)
    return () => { offValidated(); offUnvalidated() }
  }, [id, socket])

  // ── Actions ────────────────────────────────────────────────────────────────

  // PR2/3/4 — load my full thread summary for this challenge (drives the
  // Accept button morph AND the pipeline rendering).
  const loadMyAcceptance = useCallback(async () => {
    if (!account?.id || !id) { setMyAcceptance(null); return }
    try {
      const threads = await fetchMyAcceptances()
      setMyAcceptance(threads.find(thr => thr.challenge_id === id) ?? null)
    } catch { setMyAcceptance(null) }
  }, [id, account?.id])

  useEffect(() => { loadMyAcceptance() }, [loadMyAcceptance])

  // ── Inline thread chat — load + WS + auto-scroll. Mounts (data-wise) only
  // when myAcceptance flips non-null. The JSX gates on the same condition.

  useEffect(() => {
    if (!myThreadChannelId) { setMessages([]); knownIds.current = new Set(); return }
    let cancelled = false
    fetchThreadMessages(myThreadChannelId, { limit: 50 }).then(data => {
      if (cancelled) return
      const msgs = (data.messages ?? []).sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt))
      knownIds.current = new Set(msgs.map(m => m.id ?? `${m.guestId}:${m.createdAt}`))
      setMessages(msgs)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [myThreadChannelId])

  useEffect(() => {
    if (!socket || !sessionId || !myThreadChannelId) return
    socket.joinChallengeThread(myThreadChannelId, sessionId)
    const offMsg = socket.on('newMessage', (data) => {
      if (data.channelId !== myThreadChannelId) return
      const m = data.message; if (!m) return
      const key = m.id ?? `${m.guestId}:${m.createdAt}`
      if (knownIds.current.has(key)) return
      knownIds.current.add(key)
      setMessages(prev => {
        const optIdx = prev.findIndex(x =>
          typeof x.id === 'string' && x.id.startsWith('local-') &&
          x.guestId === m.guestId && (x.content ?? '') === (m.content ?? '')
        )
        if (optIdx >= 0) { const c = [...prev]; c[optIdx] = m; return c }
        return [...prev, m].sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt))
      })
    })
    return () => { offMsg(); socket.leaveChallengeThread(myThreadChannelId, sessionId) }
  }, [myThreadChannelId, socket, sessionId])

  // Refresh acceptance on any lifecycle push so the pipeline + schedule band update live.
  useEffect(() => {
    if (!socket) return
    const onChange = () => loadMyAcceptance()
    const off1 = socket.on('challenge_accepted',             onChange)
    const off2 = socket.on('challenge_acceptance_cancelled', onChange)
    const off3 = socket.on('challenge_date_proposed',        onChange)
    const off4 = socket.on('challenge_date_withdrawn',       onChange)
    const off5 = socket.on('challenge_date_approved',        onChange)
    const off6 = socket.on('challenge_verdict_approved',     onChange)
    const off7 = socket.on('challenge_verdict_rejected',     onChange)
    return () => { off1(); off2(); off3(); off4(); off5(); off6(); off7() }
  }, [socket, loadMyAcceptance])

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight
  }, [messages.length])

  const handleSendMessage = useCallback(async (e) => {
    e.preventDefault()
    const content = composer.trim()
    if (!content || sending || !myThreadChannelId || !account?.id) return
    setSending(true)
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const optimistic = {
      id: localId, channelId: myThreadChannelId,
      userId: account.id, guestId: account.id,
      nickname: account.display_name ?? 'You',
      content, createdAt: Date.now() / 1000, status: 'sending',
    }
    setMessages(prev => [...prev, optimistic])
    setComposer('')
    try {
      const sent = await sendThreadMessage(myThreadChannelId, content)
      setMessages(prev => prev.map(m => m.id === localId ? sent : m))
      knownIds.current.add(sent.id)
    } catch {
      setMessages(prev => prev.map(m => m.id === localId ? { ...m, status: 'failed' } : m))
    } finally { setSending(false) }
  }, [composer, sending, myThreadChannelId, account])

  // PR2 — Accept flow. The chat is INLINE now (no navigation): once accepted,
  // myAcceptance becomes non-null and the chat block below mounts.
  const handleAccept = useCallback(async () => {
    if (busy) return
    if (myThreadChannelId) return  // already accepted — inline chat is right there
    if (!account?.id) { onNeedAuth?.('accept_challenge'); return }

    setBusy('accept')
    try {
      await acceptChallenge(id)
      loadMyAcceptance()  // refreshes pipeline + mounts the chat block
    } catch (err) {
      if (err instanceof AcceptChallengeError) {
        const titleKey = `accept.err.${err.code}.title`
        const bodyKey  = `accept.err.${err.code}.body`
        // mode_* codes get a "Open my profile" CTA — that's where you flip
        // local/exploring. Other codes are dead-end OKs.
        const isModeErr = err.code === 'mode_required' || err.code === 'mode_mismatch'
        setAlertModal({
          emoji: isModeErr ? '🧭' : '🚫',
          title: t(titleKey),
          body: t(bodyKey, { defaultValue: err.message }),
          actionLabel: isModeErr && onOpenMyProfile ? t('accept.err.openSettings') : null,
          onAction: isModeErr && onOpenMyProfile ? () => { setAlertModal(null); onOpenMyProfile() } : null,
        })
      } else {
        setAlertModal({
          emoji: '😬',
          title: t('accept.err.unknown.title'),
          body:  t('accept.err.unknown.body'),
        })
      }
    } finally {
      setBusy(null)
    }
  }, [id, account?.id, busy, myThreadChannelId, onNeedAuth, onOpenMyProfile, loadMyAcceptance, t])

  const handleToggleStatus = useCallback(async () => {
    if (!guest?.guestId || busy || !challenge) return
    const wasValidated = challenge.status === 'validated'
    setBusy('status')
    try {
      const updated = wasValidated
        ? await unvalidateChallenge(id, guest.guestId)
        : await validateChallenge(id, guest.guestId)
      setChallenge(updated)
    } catch (e) {
      setAlertModal({ emoji: '😬', title: t('errSave'), body: '' })
    } finally {
      setBusy(null)
    }
  }, [id, guest, busy, challenge, t])

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
      setAlertModal({ emoji: '😬', title: t('errSave'), body: '' })
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

  // Cap is full when accepted travelers reach the creator's max. The +
  // button hides and the locked empty state morphs to "Challenge full".
  // Owner / acceptors don't see this — they already have their thread.
  const isFull = !isOwner && !myAcceptance &&
    otherParticipants.length >= (challenge.max_participants ?? 3)

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

      {/* Description band — type + audience badges only. The lifecycle
          visualisation moved into <ChallengePipeline> below. */}
      <div className="topic-chat-desc challenge-meta-row">
        <span className="challenge-badge challenge-badge--kind">
          {t(`typeBadge.${challenge.challenge_type}`).toUpperCase()}
        </span>
        <span className="challenge-badge challenge-badge--audience">{audienceLabel}</span>
      </div>

      {/* Lifecycle pipeline (replaces the old "in progress / accomplished"
          status pill). 4 dots, current step highlighted by the viewer's own
          acceptance phase. Educational for visitors / creator-without-an-
          acceptance. Tap navigates to the thread where the real actions are. */}
      <ChallengePipeline
        acceptance={myAcceptance}
        iAmCreator={isOwner}
        onClick={
          myAcceptance && !myAcceptance.proposed_starts_at && myAcceptance.phase === 'accepted'
            ? () => setPickerOpen(true)
            : undefined
        }
      />

      {/* Close-challenge — moved from the old status pill toggle. Same
          /validate endpoint, just smaller affordance + only visible to the
          creator now. Reopens via the same handler. */}
      {isOwner && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 16px 12px' }}>
          <button
            type="button"
            onClick={handleToggleStatus}
            disabled={busy !== null}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 999,
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.10)',
              color: isValidated ? '#22c55e' : 'var(--muted, #b3b3b3)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            <span aria-hidden="true">{isValidated ? '✓' : '🔒'}</span>
            <span>{isValidated ? t('reopenCta') : t('closeCta')}</span>
          </button>
        </div>
      )}

      {/* Challenger — explicitly distinguished from other participants. The
          crown emoji + Challenger pill make the originating user visible at
          a glance. Quick actions (Share, Accept) sit on the right of the
          row so they read as the user's "what now" panel instead of
          competing big pills below. */}
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
          <div className="challenge-creator-actions">
            <button
              type="button"
              className="challenge-share-pill"
              onClick={handleShare}
              aria-label={t('shareCta')}
            >
              <span aria-hidden="true">↗</span>
              <span className="challenge-share-pill-text">{t('shareCta')}</span>
            </button>
          </div>
        </div>
      )}

      {/* Participants row — always rendered for visitors who can accept (so
          there's a place for the + button). For the owner it only appears
          when somebody else has accepted, since they can't accept their own
          challenge. For validated challenges, the row is shown if anyone
          accepted (acceptor history), without the button. */}
      {(otherParticipants.length > 0 || (!isOwner && !isValidated)) && (
        <div className="challenge-participants-row">
          <div className="challenge-participants-info">
            {otherParticipants.length > 0 ? (
              <>
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
              </>
            ) : (
              <span className="challenge-participants-empty">
                {isFull ? t('accept.err.cap_reached.title') : t('beFirstToAccept')}
              </span>
            )}
          </div>
          {/* Accept (+) only when there's no thread yet AND there's room.
              Once accepted, the inline chat below IS the conversation surface. */}
          {!isValidated && !isOwner && !myThreadChannelId && !isFull && (
            <button
              type="button"
              className="challenge-quick-btn challenge-quick-btn--accept"
              onClick={handleAccept}
              disabled={busy === 'accept'}
              title={t('acceptCta')}
              aria-label={t('acceptCta')}
            >
              <span aria-hidden="true">{busy === 'accept' ? '…' : '+'}</span>
            </button>
          )}
        </div>
      )}

      {/* Share + Accept moved into the .challenge-creator-row above as
          icon-only quick buttons. The toast (copy-link fallback) still
          fires on desktop, but now appears as a small status pill below
          the participants strip. */}
      {shareToast && (
        <p className="challenge-share-toast challenge-share-toast--inline" role="status">
          {t('shareCopied')}
        </p>
      )}

      {/* Owner housekeeping — Edit + Delete only. The status CTA lives above
          (visible to everyone, tappable only for the owner). */}
      {isOwner && (
        <div className="challenge-owner-actions">
          <div className="challenge-owner-secondary">
            <button type="button" className="challenge-owner-iconbtn" onClick={handleEdit} disabled={busy !== null}>
              <span aria-hidden="true">✏️</span>
              <span>{t('editBtn')}</span>
            </button>
            <button type="button" className="challenge-owner-iconbtn challenge-owner-iconbtn--danger" onClick={handleDelete} disabled={busy !== null}>
              <span aria-hidden="true">🗑️</span>
              <span>{busy === 'delete' ? '…' : t('deleteBtn')}</span>
            </button>
          </div>
        </div>
      )}

      {/* Locked empty state — shown to visitors (registered or guest) and to
          creators whose challenge has no acceptors yet. Sits where the inline
          chat would be; the message explains why the chat is hidden. */}
      {!myAcceptance && (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '32px 24px', textAlign: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 40, opacity: 0.7 }}>{isFull ? '🚫' : '🔒'}</span>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: 'var(--text, #fff)' }}>
            {isOwner
              ? t('locked.creator.title')
              : isFull
                ? t('locked.full.title')
                : t('locked.visitor.title')}
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted, #b3b3b3)', maxWidth: 320 }}>
            {isOwner
              ? t('locked.creator.body')
              : isFull
                ? t('locked.full.body')
                : t('locked.visitor.body')}
          </p>
        </div>
      )}

      {/* Inline thread chat — mounts only when the viewer has an active
          acceptance for this challenge. Replaces the old "navigate to
          /thread" path: one screen, no second navigation step. */}
      {myAcceptance && account?.id && (
        <>
          <div className="topic-chat-feed" ref={feedRef}>
            {messages.length === 0 && (
              <div className="topic-chat-empty">
                <span className="topic-chat-empty-icon">👋</span>
                <span>{t('thread.empty')}</span>
              </div>
            )}
            {messages.map((m, idx) => {
              const isMine    = (account?.id && m.userId === account.id) || (account?.id && m.guestId === account.id)
              const prev      = messages[idx - 1]
              const isGrouped = prev && (prev.userId === m.userId || prev.guestId === m.guestId)
              const opacity   = m.status === 'failed' ? 0.5 : m.status === 'sending' ? 0.7 : 1
              return (
                <div key={m.id ?? idx} className={['message', isMine ? 'mine' : '', isGrouped ? 'grouped' : ''].filter(Boolean).join(' ')}>
                  {!isMine && !isGrouped && (
                    <div className="msg-meta">
                      <span className="msg-author">{m.nickname}</span>
                    </div>
                  )}
                  <div className={`msg-bubble-wrap ${isMine ? 'mine' : ''}`} style={{ opacity }}>
                    <div className="msg-content"><span className="msg-text">{m.content}</span></div>
                  </div>
                  <span className={`msg-time${isMine ? ' msg-time--mine' : ''}`}>{formatTime(m.createdAt)}</span>
                </div>
              )
            })}
          </div>

          {/* Schedule band — propose/approve date, debrief verdict. */}
          <ThreadScheduleBlock
            thread={myAcceptance}
            myUserId={account.id}
            onChange={loadMyAcceptance}
            hideEmptyCta
          />

          <MessageComposer
            value={composer}
            onChange={e => setComposer(e.target.value)}
            onSubmit={handleSendMessage}
            sending={sending}
            placeholder={t('thread.empty')}
            showEmojiButton={false}
          />
        </>
      )}

      {/* Date picker — opened by the pipeline's "Propose a date →" sub-CTA
          (the inline schedule band's empty-state CTA is suppressed to avoid
          duplication). */}
      {pickerOpen && myAcceptance && (
        <DatePickerModal
          onClose={() => setPickerOpen(false)}
          onSubmit={async (startsAt, endsAt, venue) => {
            setPickerOpen(false)
            try { await proposeDate(myAcceptance.id, startsAt, endsAt, venue); loadMyAcceptance() }
            catch { setAlertModal({ emoji: '😬', title: t('schedule.err.proposeFailed'), body: '' }) }
          }}
          submitLabel={t('schedule.proposeCta')}
        />
      )}

      {/* Themed in-app alert (replaces the native browser alert).
          Uses the existing .modal-overlay / .modal-panel skeleton; the
          challenge-alert-* classes below add the centered emoji + tap target. */}
      {alertModal && (
        <div className="modal-overlay" onClick={() => setAlertModal(null)}>
          <div className="modal-panel challenge-alert-panel" onClick={(e) => e.stopPropagation()}>
            <div className="challenge-alert-body">
              {alertModal.emoji && <div className="challenge-alert-emoji">{alertModal.emoji}</div>}
              <h3 className="challenge-alert-title">{alertModal.title}</h3>
              {alertModal.body && <p className="challenge-alert-text">{alertModal.body}</p>}
            </div>
            <div className="challenge-alert-actions">
              {alertModal.actionLabel && alertModal.onAction ? (
                <>
                  <button
                    type="button"
                    className="challenge-alert-btn"
                    onClick={() => setAlertModal(null)}
                  >
                    {t('cancel', { ns: 'common', defaultValue: 'Cancel' })}
                  </button>
                  <button
                    type="button"
                    className="challenge-alert-btn challenge-alert-btn--primary"
                    onClick={alertModal.onAction}
                  >
                    {alertModal.actionLabel}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="challenge-alert-btn challenge-alert-btn--primary"
                  onClick={() => setAlertModal(null)}
                >
                  OK
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
