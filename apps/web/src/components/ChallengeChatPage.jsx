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
  fetchChallengeMessages, sendChallengeMessage, proposeDate,
  approveTakeOn, rejectTakeOn,
  fetchMyChallengeParticipation, joinChallenge, leaveChallenge,
  kickChallengeParticipant, setChallengeCloseToJoins,
} from '../api'
import AttendeeAvatars from './AttendeeAvatars'
import BackButton from './BackButton'
import ChallengePipeline from './ChallengePipeline'
import ChallengeProofBlock from './ChallengeProofBlock'
import ChallengePostCreateModal from './ChallengePostCreateModal'
import ChallengePrivacyPanel from './ChallengePrivacyPanel'
import ChallengeChannelMembers from './ChallengeChannelMembers'
import ConfirmDialog from './ConfirmDialog'
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
  onSendDm,        // host opens a 1:1 DM with the given userId
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

  // Participation gate (the channel is now members-only). null = still
  // loading; false = visitor sees public detail page only; true = visitor
  // sees the full chat. We don't try to be clever about the initial value —
  // a single GET /participants/me on mount resolves it.
  const [iAmParticipant, setIAmParticipant] = useState(null)
  const [joiningChannel, setJoiningChannel] = useState(false)
  const [joinError,      setJoinError]      = useState(null)

  // Unified challenge channel chat — replaces the prior 1:1 thread surface.
  // Reads + sends both gated on participation server-side; the chat block
  // simply doesn't mount when iAmParticipant !== true.
  const [messages, setMessages] = useState([])
  const [composer, setComposer] = useState('')
  const [sending,  setSending]  = useState(false)
  const feedRef  = useRef(null)
  const knownIds = useRef(new Set())
  // Collapse the badges / pipeline / participants block when the chat is
  // scrolled OR the composer is focused — mirrors the event channel header
  // collapse so the conversation gets vertical space when it matters.
  const [headerCollapsed, setHeaderCollapsed] = useState(false)
  const headerCollapsedRef = useRef(false)
  const collapseHeader = (next) => {
    if (next === headerCollapsedRef.current) return
    headerCollapsedRef.current = next
    setHeaderCollapsed(next)
  }
  // Date picker opened from the pipeline sub-CTA when the viewer has an
  // acceptance but no proposal yet. Counter-propose has its own picker
  // inside ThreadScheduleBlock — they don't conflict.
  const [pickerOpen, setPickerOpen] = useState(false)
  // Invite-people modal: owner can re-open the post-create flow at any time
  // while the challenge is still free (same picker, same audience rule).
  const [invitePeopleOpen, setInvitePeopleOpen] = useState(false)
  const [cityChannelIdForInvite, setCityChannelIdForInvite] = useState(null)
  const [cityNameForInvite,      setCityNameForInvite]      = useState(null)
  // Target city name — ONLY set when the challenge is International AND a
  // target is specified. Used by the badge row so "anywhere" Intl doesn't
  // mis-label the origin city as the target.
  const [targetCityNameOnly,     setTargetCityNameOnly]     = useState(null)

  const id = challenge?.id

  // Owner check — two mutually exclusive paths:
  //   1. Challenge has a registered creator → strict account.id match. The
  //      challenge's guest_id is incidental (captures whichever guest layer
  //      backed the creator's signup) and must NOT be used here — same
  //      guest_id can persist across signup/logout on a device, otherwise
  //      a second account would falsely "own" the first's challenge.
  //   2. Pure guest creation (created_by null) → fall back to guest_id.
  const isOwner = !!(
    challenge?.created_by != null
      ? (account?.id && account.id === challenge.created_by)
      : (guest?.guestId && challenge?.guest_id && guest.guestId === challenge.guest_id)
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
    // Stash city info for the invite-people modal so the picker can fetch
    // members by mode + label the picker with the city.
    //
    // International with a target city: the picker should look in the
    // TARGET city (where we want the taker to be), NOT the origin. Local
    // and "anywhere" intl fall through to the origin city.
    const ch              = data?.challenge
    const targetCityIdRaw = ch?.target_city_id
    if (targetCityIdRaw) {
      setCityChannelIdForInvite(String(targetCityIdRaw).replace(/^city_/, ''))
      setCityNameForInvite(data?.targetCityName ?? null)
      setTargetCityNameOnly(data?.targetCityName ?? null)
    } else {
      if (data?.channelId != null) setCityChannelIdForInvite(String(data.channelId))
      if (data?.cityName)          setCityNameForInvite(data.cityName)
      setTargetCityNameOnly(null)
    }
  }, [id])

  const loadParticipants = useCallback(async () => {
    if (!id) return
    const data = await fetchChallengeParticipants(id).catch(() => ({ participants: [] }))
    setParticipants(data.participants || [])
  }, [id])

  useEffect(() => {
    loadParticipants()
  }, [loadParticipants])

  // Mount-refresh the challenge from the API so we capture channelId +
  // cityName (used by the invite-people picker). The prop carries the row
  // from the city feed but not those extras; without this load the picker
  // mounts with a null channelId and sits in the loading state forever.
  useEffect(() => {
    loadChallenge()
  }, [loadChallenge])

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
  // PR5 — for the creator with multiple acceptances on this challenge,
  // prefer a 'pending' one so the review banner surfaces; otherwise a
  // longer-running in-progress thread sorts above and the request gets
  // missed.
  const loadMyAcceptance = useCallback(async () => {
    if (!account?.id || !id) { setMyAcceptance(null); return }
    try {
      const threads = await fetchMyAcceptances()
      // Server stamps exactly one row per (challenge, viewer) with
      // is_primary_for_challenge=true using a deterministic "most actionable
      // first" priority — the source of truth. No client-side priority sort.
      const primary = threads.find(thr =>
        thr.challenge_id === id && thr.is_primary_for_challenge,
      )
      if (primary) { setMyAcceptance(primary); return }
      // Back-compat for older API builds that don't stamp the flag.
      setMyAcceptance(threads.find(thr => thr.challenge_id === id) ?? null)
    } catch { setMyAcceptance(null) }
  }, [id, account?.id])

  useEffect(() => { loadMyAcceptance() }, [loadMyAcceptance])

  // Participation probe. Resolves to true for creator + active acceptor
  // implicitly (server-side); for everyone else it's the join-row check.
  // Re-fires whenever the user-id or the acceptance-state changes so a
  // fresh acceptance flips the gate without a manual refresh.
  const loadParticipation = useCallback(async () => {
    if (!id) { setIAmParticipant(null); return }
    if (!account?.id) { setIAmParticipant(false); return }
    try {
      const res = await fetchMyChallengeParticipation(id)
      setIAmParticipant(!!res?.isIn)
    } catch { setIAmParticipant(false) }
  }, [id, account?.id])
  useEffect(() => { loadParticipation() }, [loadParticipation, myAcceptance?.id, challenge?.created_by])

  async function handleJoinChannel() {
    if (joiningChannel || !account?.id) {
      if (!account?.id) onNeedAuth?.('join_challenge')
      return
    }
    setJoiningChannel(true)
    setJoinError(null)
    try {
      await joinChallenge(id)
      setIAmParticipant(true)
      // Refresh public participant list so the new viewer shows up
      // immediately on the detail page they just left behind.
      loadParticipants()
    } catch (err) {
      if (err?.code === 'kicked')              setJoinError(t('join.errKicked'))
      else if (err?.code === 'closed_to_new_joins') setJoinError(t('join.errClosed'))
      else                                     setJoinError(err?.message || t('join.errGeneric'))
    } finally {
      setJoiningChannel(false)
    }
  }

  async function handleLeaveChannel() {
    if (!account?.id) return
    try {
      await leaveChallenge(id)
      setIAmParticipant(false)
      loadParticipants()
    } catch { /* silent — UI will re-probe on next visit */ }
  }

  // ── Unified challenge channel chat — load + WS + auto-scroll. Mounts
  // (data-wise) whenever we know the challenge id; the chat surface is
  // public so anyone (including anon) can read. Send is still gated on a
  // registered account in the composer + server.

  useEffect(() => {
    if (!id || iAmParticipant !== true) { setMessages([]); knownIds.current = new Set(); return }
    let cancelled = false
    fetchChallengeMessages(id, { limit: 50 }).then(data => {
      if (cancelled) return
      const msgs = (data.messages ?? []).sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt))
      knownIds.current = new Set(msgs.map(m => m.id ?? `${m.guestId}:${m.createdAt}`))
      setMessages(msgs)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [id, iAmParticipant])

  useEffect(() => {
    if (!socket || !sessionId || !id || iAmParticipant !== true) return
    socket.joinChallenge(id, sessionId)
    const offMsg = socket.on('newMessage', (data) => {
      if (data.channelId !== id) return
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
    return () => { offMsg(); socket.leaveChallenge(id, sessionId) }
  }, [id, iAmParticipant, socket, sessionId])

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
    const off8 = socket.on('challenge_takeon_reviewed',      onChange)
    return () => { off1(); off2(); off3(); off4(); off5(); off6(); off7(); off8() }
  }, [socket, loadMyAcceptance])

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight
  }, [messages.length])

  const handleSendMessage = useCallback(async (e) => {
    e.preventDefault()
    const content = composer.trim()
    if (!content || sending || !id) return
    if (!account?.id) { onNeedAuth?.('comment_challenge'); return }
    setSending(true)
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const optimistic = {
      id: localId, channelId: id,
      userId: account.id, guestId: account.id,
      nickname: account.display_name ?? 'You',
      content, createdAt: Date.now() / 1000, status: 'sending',
    }
    setMessages(prev => [...prev, optimistic])
    setComposer('')
    try {
      // Public challenge channel accepts guestId + nickname for parity with
      // the city chat send shape — passing the account id as the guestId
      // proxy keeps the existing message grouping stable for registered users.
      const sent = await sendChallengeMessage(id, account.id, account.display_name ?? 'You', content)
      setMessages(prev => prev.map(m => m.id === localId ? sent : m))
      knownIds.current.add(sent.id)
    } catch {
      setMessages(prev => prev.map(m => m.id === localId ? { ...m, status: 'failed' } : m))
    } finally { setSending(false) }
  }, [composer, sending, id, account, onNeedAuth])

  // PR2 — Accept flow. The chat is the public challenge channel; once
  // accepted, the schedule/proof surfaces above mount on the same page.
  const handleAccept = useCallback(async () => {
    if (busy) return
    if (myAcceptance) return  // already a participant — nothing to do
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
          primary: isModeErr && onOpenMyProfile
            ? { label: t('accept.err.openSettings'), onPress: onOpenMyProfile }
            : undefined,
          secondary: isModeErr && onOpenMyProfile ? {} : undefined,
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
  }, [id, account?.id, busy, myAcceptance, onNeedAuth, onOpenMyProfile, loadMyAcceptance, t])

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
  const handleDelete = useCallback(() => {
    if (!guest?.guestId || busy) return
    setAlertModal({
      emoji: '🗑️',
      title: t('deleteTitle'),
      body:  t('deleteBody'),
      primary: {
        label: t('deleteConfirm'),
        destructive: true,
        onPress: async () => {
          setBusy('delete')
          try {
            await deleteChallenge(id, guest.guestId)
            onDeleted?.()
          } catch {
            setAlertModal({ emoji: '😬', title: t('errSave'), body: '' })
          } finally {
            setBusy(null)
          }
        },
      },
      secondary: {},
    })
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

  // 1:1 gate — true when the challenge has a non-terminal acceptance owned
  // by someone else. Visitors don't see the Accept button + see the
  // in-progress locked state. The current taker / owner have their own
  // acceptance so they're unaffected.
  const inProgress = !!(challenge.is_in_progress && !isOwner && !myAcceptance)
  // Back-compat alias — some branches still read `isFull`. Same semantics
  // for the JSX paths still in place (renamed in this commit).
  const isFull = inProgress

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
          {challenge.creator_display_name && (
            <span className="challenge-header-creator">
              {challenge.creator_thumb_avatar_url
                ? <img src={challenge.creator_thumb_avatar_url} alt="" className="challenge-header-creator-avatar" />
                : null}
              <span>{t('byCreator', { name: challenge.creator_display_name })}</span>
            </span>
          )}
        </div>
        <span className="challenge-header-emoji" aria-hidden="true">{typeIcon}</span>
      </div>

      {/* Collapsible region — badges + pipeline + owner actions + creator
          row + participants row all live here. Shrinks (CSS-transitioned max-
          height + opacity) when the chat is scrolled OR the composer is
          focused, mirroring the event-channel pattern. */}
      <div className={`challenge-collapsible${headerCollapsed ? ' challenge-collapsible--collapsed' : ''}`}>
      {/* Description band — type + audience badges + share. Share sits on
          this row (rather than the challenger row below) so it's visible at
          every lifecycle stage; the challenger row only appears when an
          acceptor exists, and we don't want growth nudges to disappear with
          it. */}
      <div className="topic-chat-desc challenge-meta-row">
        <span className="challenge-badge challenge-badge--kind">
          {t(`typeBadge.${challenge.challenge_type}`).toUpperCase()}
        </span>
        {/* Audience vs Intl pill — same swap as the NOW card (step 8):
            Local rows show the audience target, International rows show
            🌐 + the target city (or "International" when no target). */}
        {(challenge.mode ?? 'local') === 'international' ? (
          <span className="challenge-badge challenge-badge--international">
            🌐 {targetCityNameOnly || t('mode.international')}
          </span>
        ) : (
          <span className="challenge-badge challenge-badge--audience">{audienceLabel}</span>
        )}
        {/* Visibility badge — Public is the default and we only surface it
            when explicitly non-public, OR when the row is private (the only
            case where the owner+acceptor really need to see "🔒"). Public
            is the assumed surface so we keep the row uncluttered. */}
        {(() => {
          const v = challenge.visibility ?? 'public'
          if (v === 'public') return null
          return (
            <span
              className={`challenge-badge challenge-badge--visibility challenge-badge--visibility-${v}`}
              title={t(`visibility.${v}Hint`, { ns: 'challenge', defaultValue: '' })}
            >
              {t(`visibility.badge.${v}`, { ns: 'challenge' })}
            </span>
          )
        })()}
        <button
          type="button"
          className="challenge-share-pill challenge-share-pill--inline"
          onClick={handleShare}
          aria-label={t('shareCta')}
        >
          <span aria-hidden="true">↗</span>
          <span className="challenge-share-pill-text">{t('shareCta')}</span>
        </button>
      </div>

      {/* Lifecycle pipeline (replaces the old "in progress / accomplished"
          status pill). 4 dots, current step highlighted by the viewer's own
          acceptance phase. Educational for visitors / creator-without-an-
          acceptance. Tap navigates to the thread where the real actions are. */}
      <ChallengePipeline
        acceptance={myAcceptance}
        iAmCreator={isOwner}
        mode={challenge.mode ?? 'local'}
        onClick={
          (challenge.mode ?? 'local') === 'local'
            && myAcceptance && !myAcceptance.proposed_starts_at && myAcceptance.phase === 'accepted'
            ? () => setPickerOpen(true)
            : undefined
        }
      />

      {/* International — proof submission + verdict surface. Renders only
          when there's an acceptance; visitors and creators-without-acceptance
          see no extra surface here (the pipeline above educates them). */}
      {(challenge.mode ?? 'local') === 'international' && myAcceptance && (
        <ChallengeProofBlock
          acceptanceId={myAcceptance.id}
          iAmCreator={isOwner}
          iAmAcceptor={!isOwner}
          proofRequirements={challenge.proof_requirements ?? null}
        />
      )}

      {/* Close-challenge — moved from the old status pill toggle. Same
          /validate endpoint, just smaller affordance + only visible to the
          creator now. Reopens via the same handler. */}
      {/* Owner re-invite CTA — visible only while the challenge is genuinely
          free (not in progress, not validated). Opens the same "seed it"
          modal the user gets right after creation so they can re-ping more
          city members or re-share at any later moment. */}
      {isOwner && !isValidated && !challenge.is_in_progress && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 16px 4px' }}>
          <button
            type="button"
            className="challenge-owner-invite-cta"
            onClick={() => setInvitePeopleOpen(true)}
          >
            <span aria-hidden="true">⚡</span>
            <span>{t('postCreate.ctaInvite', { city: cityNameForInvite ?? t('postCreate.thisCity') })}</span>
          </button>
        </div>
      )}

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
          {/* Share moved up to the badge row so it's visible at every
              lifecycle stage (not just when there's a creator-participant). */}
        </div>
      )}

      {/* Participants row — always rendered for visitors who can accept (so
          there's a place for the + button). For the owner it only appears
          when somebody else has accepted, since they can't accept their own
          challenge. For validated challenges, the row is shown if anyone
          accepted (acceptor history), without the button. */}
      {/* Participants row — four layouts in the no-queue / 1:1 model:
            A) viewer is a non-owner AND validated → passive "closed" line
            B) acceptor exists → avatars + count + passive "taken by X" line
               (CTA disabled regardless of viewer, no one else can accept
               while the slot is held).
            C) no acceptor, viewer can take on → full-width Accept button.
            D) owner with no acceptor → just the meta row, no button. */}
      {(otherParticipants.length > 0 || (!isOwner && !isValidated)) && (
        <div className="challenge-participants-row">
          {isValidated && !isOwner ? (
            <span className="challenge-cta-passive">{t('cta.closed')}</span>
          ) : otherParticipants.length > 0 ? (
            <>
              <div className="challenge-participants-info">
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
              {!isValidated && !isOwner && !myAcceptance && (
                <span className="challenge-cta-passive">
                  {t('cta.takenBy', { name: otherParticipants[0]?.displayName ?? '—' })}
                </span>
              )}
            </>
          ) : (
            <button
              type="button"
              className="challenge-accept-pill challenge-accept-pill--full"
              onClick={handleAccept}
              disabled={busy === 'accept'}
              aria-label={t('acceptCta')}
            >
              <span aria-hidden="true">+</span>
              <span>{busy === 'accept' ? '…' : t('pipeline.subcta.tapToAccept')}</span>
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
      </div>{/* /.challenge-collapsible */}

      {/* Take-on review banners — surface ABOVE the chat instead of
          replacing it. The chat is the public challenge channel now
          (anyone can read/post); these banners give the participants
          per-user context without locking the surface. */}
      {(() => {
        const phase     = myAcceptance?.phase
        const isPending = phase === 'pending'
        const isRej     = phase === 'rejected'
        const cpName    = myAcceptance?.counterparty?.displayName ?? '?'

        // Creator + pending take-on → inline Accept / Reject banner.
        if (isOwner && isPending && myAcceptance) {
          return (
            <div className="challenge-takeon-banner">
              <span className="challenge-takeon-emoji">🤝</span>
              <div className="challenge-takeon-text">
                <h3>{t('takeon.creator.pendingTitle', { name: cpName })}</h3>
                <p>{t('takeon.creator.pendingBody', { name: cpName })}</p>
              </div>
              <div className="challenge-takeon-actions">
                <button
                  type="button"
                  className="challenge-alert-btn"
                  onClick={async () => {
                    try { await rejectTakeOn(myAcceptance.id); loadMyAcceptance() }
                    catch { setAlertModal({ emoji: '😬', title: t('takeon.creator.rejectFailed') }) }
                  }}
                >
                  {t('takeon.creator.reject')}
                </button>
                <button
                  type="button"
                  className="challenge-alert-btn challenge-alert-btn--primary"
                  onClick={async () => {
                    try { await approveTakeOn(myAcceptance.id); loadMyAcceptance() }
                    catch { setAlertModal({ emoji: '😬', title: t('takeon.creator.approveFailed') }) }
                  }}
                >
                  {t('takeon.creator.approve')}
                </button>
              </div>
            </div>
          )
        }
        if (!isOwner && isPending) {
          return (
            <div className="challenge-takeon-banner challenge-takeon-banner--muted">
              <span className="challenge-takeon-emoji">⏳</span>
              <div className="challenge-takeon-text">
                <h3>{t('takeon.acceptor.waitingTitle')}</h3>
                <p>{t('takeon.acceptor.waitingBody', { name: cpName })}</p>
              </div>
            </div>
          )
        }
        if (!isOwner && isRej) {
          return (
            <div className="challenge-takeon-banner challenge-takeon-banner--muted">
              <span className="challenge-takeon-emoji">✕</span>
              <div className="challenge-takeon-text">
                <h3>{t('takeon.acceptor.rejectedTitle')}</h3>
                <p>{t('takeon.acceptor.rejectedBody', { name: cpName })}</p>
              </div>
            </div>
          )
        }
        return null
      })()}

      {/* Non-participant gate — until the viewer joins (or is implicitly
          a participant via creator/active-taker), they see the join CTA
          where the chat would be. Detail-page meta above stays visible. */}
      {iAmParticipant === false && (
        <div className="challenge-join-gate">
          <span className="challenge-join-gate-icon" aria-hidden="true">🔓</span>
          <h3 className="challenge-join-gate-title">{t('join.gateTitle')}</h3>
          <p className="challenge-join-gate-body">
            {t('join.gateBody', { count: otherParticipants.length })}
          </p>
          <button
            type="button"
            className="challenge-join-gate-cta"
            onClick={handleJoinChannel}
            disabled={joiningChannel}
          >
            {joiningChannel ? '…' : t('join.cta')}
          </button>
          {joinError && (
            <p className="challenge-join-gate-error" role="alert">{joinError}</p>
          )}
        </div>
      )}

      {/* Unified challenge channel chat — participation-gated. Mounts only
          for participants (creator + active acceptor implicitly, joined
          users explicitly). Reads + sends are both server-side gated; the
          UI just doesn't render this surface for non-participants. */}
      {iAmParticipant === true && (
      <>
          <div
            className="topic-chat-feed"
            ref={feedRef}
            onScroll={e => collapseHeader(e.currentTarget.scrollTop > 30)}
          >
            {messages.length === 0 && (
              <div className="topic-chat-empty">
                <span className="topic-chat-empty-icon">👋</span>
                <span>{t('thread.empty')}</span>
              </div>
            )}
            {(() => {
              // Active-taker user id — 1:1 model means at most one entry
              // in otherParticipants. The badge falls off retroactively if
              // the row transitions to rejected/closed (the API filter
              // already excludes non-active acceptances from the preview).
              const takerUserId     = otherParticipants[0]?.id ?? null
              const creatorUserId   = challenge.created_by ?? null
              const renderRoleBadge = (senderId) => {
                if (!senderId) return null
                if (senderId === creatorUserId) {
                  return <span className="challenge-role-badge challenge-role-badge--challenger">{t('badge.challenger')}</span>
                }
                if (senderId === takerUserId) {
                  return <span className="challenge-role-badge challenge-role-badge--taker">{t('badge.taker')}</span>
                }
                return null
              }
              return messages.filter(m => m.type !== 'event').map((m, idx) => {
                const isMine    = (account?.id && m.userId === account.id) || (account?.id && m.guestId === account.id)
                const prev      = messages[idx - 1]
                const isGrouped = prev && (prev.userId === m.userId || prev.guestId === m.guestId)
                const opacity   = m.status === 'failed' ? 0.5 : m.status === 'sending' ? 0.7 : 1
                const badge     = !isMine && !isGrouped ? renderRoleBadge(m.userId ?? null) : null
                return (
                  <div key={m.id ?? idx} className={['message', isMine ? 'mine' : '', isGrouped ? 'grouped' : ''].filter(Boolean).join(' ')}>
                    {!isMine && !isGrouped && (
                      <div className="msg-meta">
                        <span className="msg-author">{m.nickname}</span>
                        {badge}
                      </div>
                    )}
                    <div className={`msg-bubble-wrap ${isMine ? 'mine' : ''}`} style={{ opacity }}>
                      <div className="msg-content"><span className="msg-text">{m.content}</span></div>
                    </div>
                    <span className={`msg-time${isMine ? ' msg-time--mine' : ''}`}>{formatTime(m.createdAt)}</span>
                  </div>
                )
              })
            })()}
          </div>

          {/* Schedule band — Local only. International has the proof block
              above as its action surface and no date concertation. */}
          {(challenge.mode ?? 'local') === 'local' && (
            <ThreadScheduleBlock
              thread={myAcceptance}
              myUserId={account.id}
              onChange={loadMyAcceptance}
              hideEmptyCta
            />
          )}

          <MessageComposer
            value={composer}
            onChange={e => setComposer(e.target.value)}
            onSubmit={handleSendMessage}
            onFocus={() => { collapseHeader(true); if (!account?.id) onNeedAuth?.('comment_challenge') }}
            onBlur={() => collapseHeader(false)}
            dismissOnSend
            sending={sending}
            placeholder={t('chatPlaceholder')}
            showEmojiButton={false}
          />
          {/* Leave the channel — available to non-creators who joined.
              Creator can't leave their own challenge. */}
          {!isOwner && iAmParticipant && !myAcceptance && (
            <button
              type="button"
              className="challenge-leave-btn"
              onClick={handleLeaveChannel}
            >
              {t('join.leaveCta')}
            </button>
          )}
      </>
      )}

      {/* "Message creator" — DM shortcut for the active taker. Private
          coordination is opt-in; the public channel above handles the rest. */}
      {iAmParticipant && !isOwner && myAcceptance && account?.id && challenge.created_by && (
        <button
          type="button"
          className="challenge-dm-creator"
          onClick={() => onSendDm?.(challenge.created_by)}
        >
          💬 {t('messageCreator', { name: creator?.displayName ?? '—' })}
        </button>
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

      {/* Publicly visible channel-member list. Renders for everyone (the
          list itself is public per spec). Kick buttons surface only for
          creator + active taker. The active taker is otherParticipants[0]
          in the 1:1 model. */}
      <ChallengeChannelMembers
        challengeId={challenge.id}
        currentUserId={account?.id ?? null}
        isCreator={isOwner}
        isActiveTaker={!!myAcceptance && myAcceptance.acceptor_user_id === account?.id}
        onMembersChanged={() => loadParticipants()}
      />

      {/* Privacy controls — participants-only. Mutual go-private +
          notification preference + close-to-new-joins live here (the
          last two are wired in this PR). */}
      <ChallengePrivacyPanel
        challenge={challenge}
        currentUserId={account?.id ?? null}
        onVisibilityChanged={() => loadChallenge()}
      />

      <ConfirmDialog dialog={alertModal} onClose={() => setAlertModal(null)} />

      {/* Re-open the post-create flow at any time for the owner while the
          challenge is free. Same component + same picker, same audience rule. */}
      {invitePeopleOpen && (
        <ChallengePostCreateModal
          challenge={challenge}
          cityChannelId={cityChannelIdForInvite}
          cityName={cityNameForInvite}
          currentUserId={account?.id ?? null}
          onClose={() => setInvitePeopleOpen(false)}
          onShare={handleShare}
        />
      )}
    </div>
  )
}
