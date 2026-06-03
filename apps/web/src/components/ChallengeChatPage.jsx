/**
 * ChallengeChatPage — interactive web detail screen for /challenge/{slug}-{id}.
 *
 * Leaner than TopicChatPage by design: challenges are open (no members-only
 * gate, no join-request flow), and v1 web parity focuses on what a crawler-
 * arriving user can actually act on: see the challenge, accept it, chat about
 * it, validate if owner. Edit/delete, mentions, image messages, reactions,
 * reply — all deferred to mobile or a follow-up commit if needed.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n, { SUPPORTED, DEFAULT_LOCALE } from '../i18n'
import {
  fetchChallengeById,
  fetchChallengeParticipants, validateChallenge,
  unvalidateChallenge, deleteChallenge,
  acceptChallenge, fetchMyAcceptances, AcceptChallengeError,
} from '../api'
import AttendeeAvatars from './AttendeeAvatars'
import BackButton from './BackButton'
import ChallengePipeline from './ChallengePipeline'

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

export default function ChallengeChatPage({
  challenge: initialChallenge,
  guest,
  nickname,
  account,
  onBack,
  onEdit,
  onDeleted,
  onOpenThread,   // PR2 — host (App.jsx) routes to ThreadChatPage on accept
  onNeedAuth,    // PR2 — host routes guest to sign-up gate
  socket,
  sessionId,
}) {
  const { t } = useTranslation('challenge')

  const [challenge,    setChallenge]    = useState(initialChallenge)
  const [participants, setParticipants] = useState([])
  const [busy,         setBusy]         = useState(null) // 'accept' | 'status' | 'delete' | null
  const [shareToast,   setShareToast]   = useState(false) // shown briefly after the clipboard fallback fires
  // PR2/3/4 — full acceptance summary. Drives the Accept button morph + the
  // ChallengePipeline rendering. Null when I have no acceptance for this
  // challenge (visitor or creator on their own ad).
  const [myAcceptance, setMyAcceptance] = useState(null)
  const myThreadChannelId = myAcceptance?.thread_channel_id ?? null

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

  // PR2 — Accept flow. Three paths: already accepted → open thread; guest →
  // bounce to auth; registered → POST /accept and route to the new thread.
  const handleAccept = useCallback(async () => {
    if (busy) return

    // Already accepted? Just open it.
    if (myThreadChannelId) {
      onOpenThread?.(myThreadChannelId)
      return
    }

    if (!account?.id) {
      onNeedAuth?.('accept_challenge')
      return
    }

    setBusy('accept')
    try {
      const acceptance = await acceptChallenge(id)
      loadMyAcceptance()  // refresh pipeline state with the new 'accepted' phase
      onOpenThread?.(acceptance.thread_channel_id)
    } catch (err) {
      if (err instanceof AcceptChallengeError) {
        const titleKey = `accept.err.${err.code}.title`
        const bodyKey  = `accept.err.${err.code}.body`
        const body     = t(bodyKey, { defaultValue: err.message })
        window.alert(`${t(titleKey)}\n\n${body}`)
      } else {
        window.alert(`${t('accept.err.unknown.title')}\n\n${t('accept.err.unknown.body')}`)
      }
    } finally {
      setBusy(null)
    }
  }, [id, account?.id, busy, myThreadChannelId, onOpenThread, onNeedAuth, t])

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
      window.alert(t('errSave'))
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
        onClick={myThreadChannelId
          ? () => onOpenThread?.(myThreadChannelId)
          : undefined}
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
              <span className="challenge-participants-empty">{t('beFirstToAccept')}</span>
            )}
          </div>
          {!isValidated && !isOwner && (
            <button
              type="button"
              className={`challenge-quick-btn challenge-quick-btn--accept${myThreadChannelId ? ' challenge-quick-btn--accept-in' : ''}`}
              onClick={handleAccept}
              disabled={busy === 'accept'}
              title={myThreadChannelId ? t('openThreadCta') : t('acceptCta')}
              aria-label={myThreadChannelId ? t('openThreadCta') : t('acceptCta')}
            >
              <span aria-hidden="true">{busy === 'accept' ? '…' : (myThreadChannelId ? '💬' : '+')}</span>
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

      {/* Public chat removed — per-acceptance threads (PR2+) are now the
          only conversation surface. Visitors with no acceptance just see
          the pipeline + Accept CTA above; acceptors tap the orange chat
          bubble on the participants row to open their thread. */}
    </div>
  )
}
