/**
 * ChallengeChatPage - interactive web detail screen for /challenge/{slug}-{id}.
 *
 * Leaner than TopicChatPage by design: challenges are open (no members-only
 * gate, no join-request flow), and v1 web parity focuses on what a crawler-
 * arriving user can actually act on: see the challenge, accept it, chat about
 * it, validate if owner. Chat has reactions, replies, and @mentions (the
 * 'challenge' mention context resolves to taker / challenger / talkers).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import ThumbImg from './ThumbImg'
import { useTranslation } from 'react-i18next'
import i18n, { SUPPORTED, DEFAULT_LOCALE } from '../i18n'
import {
  fetchChallengeById,
  fetchChallengeParticipants, validateChallenge,
  unvalidateChallenge, deleteChallenge,
  acceptChallenge, fetchMyAcceptances, AcceptChallengeError, validatePresence,
  fetchChallengeMessages, sendChallengeMessage, proposeDate, toggleChallengeReaction,
  approveTakeOn, rejectTakeOn,
  fetchMyChallengeParticipation, joinChallenge, leaveChallenge,
  kickChallengeParticipant, setChallengeCloseToJoins, setChallengeVisibility,
  abandonAcceptance, restartChallenge,
} from '../api'
import { countryToFlag } from '../lib/countryFlag'
import { linkifyText, extractFirstUrl } from '../linkify.jsx'
import useMentions from '../hooks/useMentions'
import { splitContentByMentions } from '../lib/mentions'
import LinkPreviewCard from './LinkPreviewCard'
import AttendeeAvatars from './AttendeeAvatars'
import BackButton from './BackButton'
import ChallengePipeline from './ChallengePipeline'
import ScoringInfoButton from './ScoringInfoButton'
import ChallengeProofBlock from './ChallengeProofBlock'
import GroupSubmissionsGallery from './GroupSubmissionsGallery'
import { ReactionPills, ReplyPreview, MessageActionBubble } from './MessageActions'
import ProofReviewModal from './ProofReviewModal'
import ChallengePostCreateModal from './ChallengePostCreateModal'
import ChallengeChannelMembers from './ChallengeChannelMembers'
import ChallengeNotificationToggle from './ChallengeNotificationToggle'
import ConfirmDialog from './ConfirmDialog'
import DatePickerModal from './DatePickerModal'
import MessageComposer from './MessageComposer'
import ThreadScheduleBlock from './ThreadScheduleBlock'
import { Marquee } from './Marquee'

// Slug builder - mirrors apps/web/api/sitemap.mjs:challengeSlug and
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

const TYPE_ICONS = { food: '🍜', place: '📍', culture: '🎭', help: '🤪' }

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

// Shared style for the group-challenge primary button (join / validate).
// Solid fill = unmistakably tappable. The old translucent/outlined style read
// as an already-done state ("✓ validated") rather than a primary CTA.
const GROUP_BTN_STYLE = {
  width: '100%', padding: '14px', borderRadius: 14, textAlign: 'center',
  background: '#FF7A3C', border: 'none',
  boxShadow: '0 3px 12px rgba(255,122,60,0.35)',
  color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'pointer',
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
  onOpenProfile,   // host opens another user's public profile (PR27 - members modal row tap)
  onOpenChallengeIntro, // host opens the "How challenges work" carousel (already mounted at App level)
  socket,
  sessionId,
}) {
  const { t } = useTranslation('challenge')

  const [challenge,    setChallenge]    = useState(initialChallenge)
  const [participants, setParticipants] = useState([])
  const [busy,         setBusy]         = useState(null) // 'accept' | 'status' | 'delete' | null
  // Inline creator pills (visibility flip + close-to-new-joins) - small
  // dedicated busy flags so they don't fight the main `busy` channel.
  const [visBusy,    setVisBusy]    = useState(false)
  const [closeBusy,  setCloseBusy]  = useState(false)
  // Owner-only "Manage challenge" modal - opens from the inline pill in
  // the meta row. Bundles Edit / Close (lifecycle) / Delete.
  const [manageOpen, setManageOpen] = useState(false)
  // International proof-spec popin - tap on the "Waiting for the proof"
  // pill (the pipeline subCta) on Intl rows opens this small read-only
  // sheet so the acceptor can re-read what was asked without scrolling
  // back through the chat.
  const [proofSpecOpen, setProofSpecOpen] = useState(false)
  // PR62 - Creator's "Review the proof" modal. Opens from the pipeline
  // sub-CTA on intl when phase='proof_submitted'.
  const [proofReviewOpen, setProofReviewOpen] = useState(false)
  // Group-challenge UI state (Phase 4).
  const [joining,      setJoining]      = useState(false)
  const [validateOpen, setValidateOpen] = useState(false)
  const [validating,   setValidating]   = useState(false)
  const [presentChecked, setPresentChecked] = useState({})
  const [presentRating, setPresentRating] = useState(0)   // challenger's meet rating (required)
  const [submissionCount, setSubmissionCount] = useState(0) // photos submitted - drives the hint copy
  // Photo-proof group: the winner is picked from the submissions gallery.
  // galleryTick bumps on proof-submitted / validated WS events so the gallery
  // re-fetches when a new photo (or the winner) lands.
  const [galleryTick, setGalleryTick] = useState(0)
  // Visibility picker - Public / Friends / Private dropdown opened from
  // the inline pill. "Private" maps to closed_to_new_joins=true (the
  // mutual go-private vote backend isn't surfaced here).
  const [visMenuOpen, setVisMenuOpen] = useState(false)
  // Channel-header details (visibility pill, manage pill, pipeline, proof
  // block, members strip) collapse behind a chevron next to the share
  // pill - frees vertical space for the conversation. Default expanded
  // so first-load reveals the context; tap to fold. Sticks across the
  // session for this challenge.
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [shareToast,   setShareToast]   = useState(false) // shown briefly after the clipboard fallback fires
  // Themed in-app alert. Replaces window.alert() (which renders the ugly
  // "hilads.live says" browser modal). Shape: { emoji?, title, body, actionLabel?, onAction? }.
  const [alertModal, setAlertModal] = useState(null)
  // PR2/3/4 - full acceptance summary. Drives the Accept button morph + the
  // ChallengePipeline rendering. Null when I have no acceptance for this
  // challenge (visitor or creator on their own ad).
  const [myAcceptance, setMyAcceptance] = useState(null)

  // PR18 - terminal acceptances unlock the detail screen. See the long
  // comment near `inProgress` below for the reasoning. Defined up here so
  // handleAccept's closure can reference it without a TDZ window.
  const activeAcceptance = (myAcceptance &&
    (myAcceptance.phase === 'approved' || myAcceptance.phase === 'rejected'))
    ? null
    : myAcceptance

  // Participation gate (the channel is now members-only). null = still
  // loading; false = visitor sees public detail page only; true = visitor
  // sees the full chat. We don't try to be clever about the initial value -
  // a single GET /participants/me on mount resolves it.
  const [iAmParticipant, setIAmParticipant] = useState(null)
  const [joiningChannel, setJoiningChannel] = useState(false)
  const [joinError,      setJoinError]      = useState(null)

  // "Learn how challenges work" banner - same primitive the city chat
  // surfaces from its delayed feed prompt. Mounted here too so a user
  // who lands straight on a challenge (deeplink, push, share) can still
  // learn the rules without backtracking. Appears 8 s after entering
  // the channel, dismissed on × or after tap-to-open.
  const [showChallengeIntroBanner, setShowChallengeIntroBanner] = useState(false)
  // Guest welcome banner - fires on entry for any unauthenticated
  // viewer of a public channel. Replaces the intro banner for that
  // audience so the entry surface has one focused CTA. Dismissed
  // per-session via × or by tapping into the auth flow.
  const [showGuestWelcome, setShowGuestWelcome] = useState(true)
  // `id` is needed by the useEffect dep array below, so it must be
  // declared before the effect - the dep array evaluates at render
  // time and a `const` declared later would TDZ on every mount
  // (this exact pattern was crashing the page with "Cannot access
  // 'ke' before initialization" because the bundler inlined the
  // forward reference).
  const id = challenge?.id
  useEffect(() => {
    if (!id) return
    setShowChallengeIntroBanner(false)
    const timer = setTimeout(() => setShowChallengeIntroBanner(true), 8000)
    return () => clearTimeout(timer)
  }, [id])

  // Unified challenge channel chat - replaces the prior 1:1 thread surface.
  // Reads + sends both gated on participation server-side; the chat block
  // simply doesn't mount when iAmParticipant !== true.
  const [messages, setMessages] = useState([])
  const [composer, setComposer] = useState('')
  const [sending,  setSending]  = useState(false)
  // PR33 - action bubble (react / reply / copy) + reply state. Mirrors
  // the city chat pattern in App.jsx so the challenge channel has the
  // same long-press / tap-to-react UX as every other surface.
  const [actionBubble, setActionBubble] = useState(null) // { msg, x, y, isMine }
  const [replyingTo,   setReplyingTo]   = useState(null) // { id, nickname, content, type }
  const reactChallengeMsg = async (msgId, emoji) => {
    if (!account?.id || !msgId) return
    try {
      const data = await toggleChallengeReaction(id, msgId, emoji, account.id)
      setMessages(prev => prev.map(x => x.id === msgId ? { ...x, reactions: data.reactions } : x))
    } catch { /* silent */ }
  }
  const feedRef   = useRef(null)
  const bottomRef = useRef(null) // PR28 - scrollIntoView target at the feed's tail
  const knownIds  = useRef(new Set())
  // @mention autocomplete - same hook the city chat uses. The 'challenge'
  // context resolves mentionable users to the taker, the challenger, and
  // anyone who has talked in this channel (backend MentionService).
  const composerInputRef = useRef(null)
  const mentions = useMentions({
    context:   'challenge',
    channelId: id,
    value:     composer,
    setValue:  setComposer,
    inputRef:  composerInputRef,
  })
  // Collapse the badges / pipeline / participants block when the chat is
  // scrolled OR the composer is focused - mirrors the event channel header
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
  // inside ThreadScheduleBlock - they don't conflict.
  const [pickerOpen, setPickerOpen] = useState(false)
  // Invite-people modal: owner can re-open the post-create flow at any time
  // while the challenge is still free (same picker, same audience rule).
  const [invitePeopleOpen, setInvitePeopleOpen] = useState(false)
  const [cityChannelIdForInvite, setCityChannelIdForInvite] = useState(null)
  const [cityNameForInvite,      setCityNameForInvite]      = useState(null)
  // Target city name - ONLY set when the challenge is International AND a
  // target is specified. Used by the badge row so "anywhere" Intl doesn't
  // mis-label the origin city as the target.
  const [targetCityNameOnly,     setTargetCityNameOnly]     = useState(null)

  // `id` was moved up - it has to be declared before the useEffect
  // that depends on it (see the "Cannot access 'ke' before
  // initialization" fix above). Don't redeclare it here.

  // Owner check - two mutually exclusive paths:
  //   1. Challenge has a registered creator → strict account.id match. The
  //      challenge's guest_id is incidental (captures whichever guest layer
  //      backed the creator's signup) and must NOT be used here - same
  //      guest_id can persist across signup/logout on a device, otherwise
  //      a second account would falsely "own" the first's challenge.
  //   2. Pure guest creation (created_by null) → fall back to guest_id.
  const isOwner = !!(
    challenge?.created_by != null
      ? (account?.id && account.id === challenge.created_by)
      : (guest?.guestId && challenge?.guest_id && guest.guestId === challenge.guest_id)
  )
  // The creator never accepts their own challenge, so activeAcceptance is
  // null for them - yet they still need the pipeline + proof-review keyed on
  // the TAKER's acceptance. Synthesize one from the acceptor_* fields the
  // backend now exposes (acceptor_acceptance_id + acceptor_phase) so the
  // creator's pipeline advances and the proof-review modal can fetch/judge.
  const effectiveActiveAcceptance = activeAcceptance
    ?? ((isOwner && challenge?.acceptor_acceptance_id && challenge?.acceptor_phase)
          ? {
              id: challenge.acceptor_acceptance_id,
              phase: challenge.acceptor_phase,
              effective_phase: challenge.acceptor_phase,
              // ChallengePipeline reads acceptance.counterparty.displayName
              // unconditionally - omit it and the creator's view crashes once a
              // taker exists. Fill from the taker (the creator's counterparty).
              counterparty: {
                id:             challenge.acceptor_user_id ?? '',
                displayName:    challenge.acceptor_display_name ?? '',
                thumbAvatarUrl: challenge.acceptor_thumb_avatar_url ?? null,
              },
            }
          : null)
  const isValidated = challenge?.status === 'validated'
  // closed = successfully completed (one-shot, no re-take). Distinct from the
  // reversible 'validated' archive toggle - a completed challenge stays closed.
  const isClosed = !!challenge?.closed
  // Group challenge (Phase 4): join → meet → challenger validates presence.
  const isGroup = (challenge?.challenge_format ?? 'legacy') === 'group'
  // MEET (validate presence) vs PHOTO-PROOF (submit + pick winner). meet_at is
  // the meet date for meet, the submission deadline for photo.
  const isGroupPhoto = isGroup && ((challenge?.validation_method ?? 'meet') === 'photo_proof' || (challenge?.mode ?? 'local') === 'international')
  const isGroupMeet  = isGroup && !isGroupPhoto
  const meetSummary = (isGroup && challenge?.meet_at)
    ? new Date(challenge.meet_at * 1000).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null
  // The challenger can only validate presence after the meet's start time.
  const meetStarted = !challenge?.meet_at || (Date.now() / 1000) >= challenge.meet_at
  const myGroupPhase = (myAcceptance && !myAcceptance.i_am_creator) ? myAcceptance.phase : null
  const isParticipant = !!(
    (account?.id    && participants.some(p => p.id === account.id)) ||
    (guest?.guestId && participants.some(p => p.id === guest.guestId))
  )
  // Joined the group? Trust the participants list (getParticipants = every
  // non-rejected acceptor) as well as the phase, because /me/acceptances doesn't
  // always surface a group 'joined' row - which left the join CTA showing for
  // people who'd already joined (and submitted).
  const iAmJoined = !isOwner && (myGroupPhase === 'joined' || myGroupPhase === 'present'
    || (!!account?.id && participants.some(p => p.id === account.id)))

  // Public channels are open to anyone - guests included. The chat surface
  // renders inline regardless of iAmParticipant; the participation gate
  // below only applies to friends / private rows (which surface a small
  // lock state in place of the conversation). Defaulting to 'public' on
  // a null challenge avoids a flash of the locked surface during the
  // initial fetch.
  const challengeIsPublic = (challenge?.visibility ?? 'public') === 'public'

  // Photo-proof verdict path. International is always photo (locked
  // server-side). Local challenges where the creator picked photo at
  // creation use the same submission UI + creator review modal. Older
  // rows that never carried validation_method get 'meet' from the
  // backend formatter default - historical IRL flow stays the same.
  const usesPhotoProof =
    (challenge?.mode ?? 'local') === 'international'
    || (challenge?.validation_method ?? 'meet') === 'photo_proof'

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

  // ── WS subscriptions - challenge status flips (open ⇄ validated) only.
  // Per-thread chat messages aren't on this surface anymore (PR4+) - the
  // public chat that used to live here moved into per-acceptance threads.

  useEffect(() => {
    if (!socket || !id) return
    const onStatusFlip = (data) => {
      if (data.challenge?.id === id) setChallenge(data.challenge)
    }
    const offValidated   = socket.on('challenge_validated',   onStatusFlip)
    const offUnvalidated = socket.on('challenge_unvalidated', onStatusFlip)
    // Live participant list: reload when someone joins/leaves this challenge so
    // the member list grows without a reload (server pings on every group join).
    const onMembers = (data) => {
      const evtId = data?.challenge?.id ?? data?.challengeId ?? data?.payload?.challenge?.id
      if (evtId === id) loadParticipants()
    }
    const offAccepted  = socket.on('challenge_accepted',             onMembers)
    const offCancelled = socket.on('challenge_acceptance_cancelled', onMembers)
    return () => { offValidated(); offUnvalidated(); offAccepted(); offCancelled() }
  }, [id, socket, loadParticipants])

  // ── Actions ────────────────────────────────────────────────────────────────

  // PR2/3/4 - load my full thread summary for this challenge (drives the
  // Accept button morph AND the pipeline rendering).
  // PR5 - for the creator with multiple acceptances on this challenge,
  // prefer a 'pending' one so the review banner surfaces; otherwise a
  // longer-running in-progress thread sorts above and the request gets
  // missed.
  const loadMyAcceptance = useCallback(async () => {
    if (!account?.id || !id) { setMyAcceptance(null); return }
    try {
      const threads = await fetchMyAcceptances()
      // Server stamps exactly one row per (challenge, viewer) with
      // is_primary_for_challenge=true using a deterministic "most actionable
      // first" priority - the source of truth. No client-side priority sort.
      const primary = threads.find(thr =>
        thr.challenge_id === id && thr.is_primary_for_challenge,
      )
      if (primary) { setMyAcceptance(primary); return }
      // Back-compat for older API builds that don't stamp the flag.
      setMyAcceptance(threads.find(thr => thr.challenge_id === id) ?? null)
    } catch { setMyAcceptance(null) }
  }, [id, account?.id])

  useEffect(() => { loadMyAcceptance() }, [loadMyAcceptance])

  // ── Group challenge (Phase 4): join + validate presence ─────────────────────
  // Joining reuses /accept (the backend branches on challenge_format → group
  // join + the +2 spark, no approval, multiple takers).
  const handleGroupJoin = useCallback(async () => {
    if (joining) return
    if (!account?.id) { onNeedAuth?.(); return }
    setJoining(true)
    try {
      await acceptChallenge(id)
      await loadChallenge()
      loadMyAcceptance()
      loadParticipants()
    } catch (e) {
      window.alert(e?.code === 'closed_to_new_joins'
        ? t('group.closed', { ns: 'challenge', defaultValue: 'Closed to new joins' })
        : t('group.joinFailed', { ns: 'challenge', defaultValue: 'Could not join — try again.' }))
    } finally {
      setJoining(false)
    }
  }, [joining, account?.id, id, t, loadChallenge, loadMyAcceptance, loadParticipants, onNeedAuth])

  const handleValidatePresence = useCallback(async () => {
    if (validating) return
    const presentIds = participants.filter(p => presentChecked[p.id] !== false).map(p => p.id)
    if (presentRating <= 0) return   // rating is required
    setValidating(true)
    try {
      await validatePresence(id, presentIds, presentRating)
      setValidateOpen(false)
      await loadChallenge()
      loadParticipants()
    } catch (e) {
      window.alert(t('group.validateFailed', { ns: 'challenge', defaultValue: 'Could not validate — try again.' }))
    } finally {
      setValidating(false)
    }
  }, [validating, participants, presentChecked, presentRating, id, t, loadChallenge, loadParticipants])


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
    } catch { /* silent - UI will re-probe on next visit */ }
  }

  // The TAKER abandons their take-on: timeline resets, challenge reopens, chat
  // is wiped, creator is notified. Confirm first - it can't be undone.
  function handleLeaveTakeon() {
    if (!myAcceptance) return
    const accId = myAcceptance.id
    setAlertModal({
      emoji: '🚪',
      title: t('leaveTakeon.confirmTitle'),
      body:  t('leaveTakeon.confirmBody'),
      primary: {
        label: t('leaveTakeon.confirmCta'),
        destructive: true,
        onPress: async () => {
          try {
            await abandonAcceptance(accId)
            setMyAcceptance(null)
            loadChallenge()
            loadParticipants()
          } catch {
            setAlertModal({ emoji: '😬', title: t('leaveTakeon.failed'), body: '' })
          }
        },
      },
      secondary: {},
    })
  }

  // Creator-only visibility flip (Public ↔ Friends). Private isn't
  // reachable from this pill - the mutual go-private flow handles that
  // and the backend route rejects 'private' here. International rows
  // are forced public and the pill is hidden.
  async function handleToggleVisibility() {
    if (visBusy || !challenge) return
    const current = challenge.visibility ?? 'public'
    const next    = current === 'public' ? 'friends' : 'public'
    setVisBusy(true)
    try {
      await setChallengeVisibility(id, next)
      // Optimistic: mirror the change locally so the pill updates without
      // a round-trip; the parent re-fetches via loadChallenge for the
      // SSR-friendly visibility chip elsewhere.
      setChallenge(prev => prev ? { ...prev, visibility: next } : prev)
      loadChallenge()
    } catch (err) {
      setAlertModal({ emoji: '😬', title: err?.message || t('privacy.errSave') })
    } finally {
      setVisBusy(false)
    }
  }

  // Unified visibility selector - Public / Friends / Private. One backend
  // call per pick: POST /visibility writes the column and (for 'private')
  // atomically closes the challenge to new joins so a stranger with the
  // direct link can't sneak in as a spectator. No mutual-vote round-trip
  // - this is the simple creator-only flow.
  async function handlePickVisibility(choice) {
    if (visBusy || closeBusy || !challenge) return
    setVisMenuOpen(false)
    try {
      // Picker is the single source of truth for "who can see this and
      // who can still join". Private = hidden from non-participants AND
      // closed to new joins (server-side); public/friends = visible per
      // the visibilityWhereClause rules. /visibility now accepts
      // 'private' and atomically flips closed_to_new_joins, so the
      // client just calls setChallengeVisibility(choice) and trusts the
      // returned state.
      if ((challenge.visibility ?? 'public') !== choice) {
        setVisBusy(true)
        await setChallengeVisibility(id, choice)
        setChallenge(prev => prev
          ? {
              ...prev,
              visibility: choice,
              closed_to_new_joins: choice === 'private' ? true : prev.closed_to_new_joins,
            }
          : prev)
        loadChallenge()
        setVisBusy(false)
      }
    } catch (err) {
      setVisBusy(false); setCloseBusy(false)
      setAlertModal({ emoji: '😬', title: err?.message || t('privacy.errSave') })
    }
  }

  // Legacy close-to-new-joins handler - kept for now for any internal
  // call sites; surface goes through the unified picker.
  async function handleToggleClosedToJoins() {
    if (closeBusy || !challenge) return
    const next = !challenge.closed_to_new_joins
    setCloseBusy(true)
    try {
      await setChallengeCloseToJoins(id, next)
      setChallenge(prev => prev ? { ...prev, closed_to_new_joins: next } : prev)
    } catch (err) {
      setAlertModal({ emoji: '😬', title: err?.message || t('privacy.errSave') })
    } finally {
      setCloseBusy(false)
    }
  }

  // ── Unified challenge channel chat - load + WS + auto-scroll. Mounts
  // (data-wise) whenever we know the challenge id; the chat surface is
  // public so anyone (including anon) can read. Send is still gated on a
  // registered account in the composer + server.

  useEffect(() => {
    // Public channels: any viewer (guest included) reads. Friends/private
    // keep the participation gate so non-members get the lock state
    // below instead of an empty chat list.
    const canRead = challengeIsPublic || iAmParticipant === true
    if (!id || !canRead) { setMessages([]); knownIds.current = new Set(); return }
    let cancelled = false
    fetchChallengeMessages(id, { limit: 50 }).then(data => {
      if (cancelled) return
      const msgs = (data.messages ?? []).sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt))
      knownIds.current = new Set(msgs.map(m => m.id ?? `${m.guestId}:${m.createdAt}`))
      setMessages(msgs)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [id, iAmParticipant, challengeIsPublic])

  useEffect(() => {
    const canRead = challengeIsPublic || iAmParticipant === true
    if (!socket || !sessionId || !id || !canRead) return
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
    // PR33 - reaction updates land live so other users' clicks reflect
    // immediately. Same payload shape as the city + event channels.
    const offReact = socket.on('reactionUpdate', ({ channelId: ch, messageId, reactions }) => {
      if (ch !== id) return
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions } : m))
    })
    return () => { offMsg(); offReact(); socket.leaveChallenge(id, sessionId) }
  }, [id, iAmParticipant, challengeIsPublic, socket, sessionId])

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
    // Photo proof submitted → creator's pipeline flips to proof_submitted live.
    // Also bumps the group submissions gallery so a new photo (or the picked
    // winner, via challenge_validated above) appears for everyone live.
    const off9  = socket.on('challenge_proof_submitted',     () => { onChange(); setGalleryTick((x) => x + 1) })
    const off10 = socket.on('challenge_validated',           () => setGalleryTick((x) => x + 1))
    return () => { off1(); off2(); off3(); off4(); off5(); off6(); off7(); off8(); off9(); off10() }
  }, [socket, loadMyAcceptance])

  // PR30 - auto-scroll on every messages.length change. behavior:'instant'
  // sidesteps the CSS scroll-behavior:smooth that some surrounding
  // contexts may set - a smooth scroll on entry can be interrupted by
  // the layout still settling, leaving the user mid-feed (which reads
  // as "stuck at top"). 'instant' is atomic.
  const skipAutoScrollRef = useRef(false)
  useEffect(() => {
    if (skipAutoScrollRef.current) { skipAutoScrollRef.current = false; return }
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [messages.length])

  const handleSendMessage = useCallback(async (e) => {
    e.preventDefault()
    const content = composer.trim()
    if (!content || sending || !id) return
    // Guest-aware sender identity. Public channels accept anyone with a
    // (guestId, nickname) tuple - same model city channels use. Friends/
    // private (where canRead is false above) never render the composer
    // for non-members, so we don't need to extra-guard here.
    const senderId       = account?.id ?? guest?.guestId ?? null
    const senderNickname = account?.display_name ?? nickname ?? 'Guest'
    if (!senderId) { onNeedAuth?.('comment_challenge'); return }
    setSending(true)
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const reply   = replyingTo // capture before async write
    const built   = mentions.buildAndReset(content) // resolves @names → mention refs
    const optimistic = {
      id: localId, channelId: id,
      userId: account?.id ?? null, guestId: senderId,
      nickname: senderNickname,
      content, createdAt: Date.now() / 1000, status: 'sending',
      replyTo: reply ? { id: reply.id, nickname: reply.nickname, content: reply.content, type: reply.type ?? 'text' } : undefined,
      mentions: built.length ? built : undefined,
    }
    setMessages(prev => [...prev, optimistic])
    setComposer('')
    setReplyingTo(null)
    try {
      const sent = await sendChallengeMessage(id, senderId, senderNickname, content, reply?.id ?? null, built.length ? built : undefined)
      setMessages(prev => prev.map(m => m.id === localId ? sent : m))
      knownIds.current.add(sent.id)
    } catch {
      setMessages(prev => prev.map(m => m.id === localId ? { ...m, status: 'failed' } : m))
    } finally { setSending(false) }
  }, [composer, sending, id, account, onNeedAuth, replyingTo])

  // PR2 - Accept flow. The chat is the public challenge channel; once
  // accepted, the schedule/proof surfaces above mount on the same page.
  const handleAccept = useCallback(async () => {
    if (busy) return
    if (activeAcceptance) return  // already an active acceptance - nothing to do
    // Note: a terminal myAcceptance (approved/rejected) does NOT block - the
    // user is re-engaging with a completed challenge. The new row coexists
    // with the old; score_events.UNIQUE keeps points from re-firing.
    if (!account?.id) { onNeedAuth?.('accept_challenge'); return }

    setBusy('accept')
    try {
      await acceptChallenge(id)
      loadMyAcceptance()  // refreshes pipeline + mounts the chat block
    } catch (err) {
      if (err instanceof AcceptChallengeError) {
        const titleKey = `accept.err.${err.code}.title`
        const bodyKey  = `accept.err.${err.code}.body`
        // mode_* codes get a "Open my profile" CTA - that's where you flip
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

  // Delete: confirm before destructive action (this one IS destructive - not
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

  // Restart (creator): remove the current taker, wipe the chat, reopen from zero.
  const handleRestart = useCallback(() => {
    if (busy) return
    setAlertModal({
      emoji: '🔄',
      title: t('restart.confirmTitle'),
      body:  t('restart.confirmBody'),
      primary: {
        label: t('restart.confirmCta'),
        destructive: true,
        onPress: async () => {
          setBusy('restart')
          try {
            await restartChallenge(id)
            loadChallenge()
            loadParticipants()
            loadMyAcceptance()
          } catch {
            setAlertModal({ emoji: '😬', title: t('restart.failed'), body: '' })
          } finally {
            setBusy(null)
          }
        },
      },
      secondary: {},
    })
  }, [id, busy, t, loadChallenge, loadParticipants, loadMyAcceptance])

  // Edit: hand off to the parent (App.jsx) which opens the CreateChallengePage
  // in edit mode. No need for a local edit form - single source of truth.
  const handleEdit = useCallback(() => {
    if (!challenge) return
    onEdit?.(challenge)
  }, [challenge, onEdit])

  // Share - Web Share API where available (mobile Safari + Chromium-on-Android +
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
    // Already attempted clipboard above - flash the toast so the user knows.
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

  // Active taker - derived from challenge.acceptor_user_id so it stays
  // accurate after a finished round. The previous taker often lingers
  // in `participants` (they joined the channel), so otherParticipants[0]
  // would surface their TAKER pill even after the LATERAL slot was
  // vacated. Hydrate from participants when available, otherwise from
  // the acceptor_* snapshot shipped on the challenge.
  const activeTaker = (() => {
    if (!challenge?.acceptor_user_id) return null
    const fromParticipants = participants.find(p => p.id === challenge.acceptor_user_id)
    if (fromParticipants) return fromParticipants
    return {
      id:             challenge.acceptor_user_id,
      displayName:    challenge.acceptor_display_name ?? '?',
      thumbAvatarUrl: challenge.acceptor_thumb_avatar_url ?? null,
      avatarUrl:      challenge.acceptor_thumb_avatar_url ?? null,
    }
  })()

  // 1:1 gate - true when the challenge has a non-terminal acceptance owned
  // by someone else. Visitors don't see the Accept button + see the
  // in-progress locked state. The current taker / owner have their own
  // acceptance so they're unaffected. Uses activeAcceptance so a user
  // whose old acceptance is terminal isn't wrongly treated as "the active
  // taker" when someone else has taken the challenge over.
  const inProgress = !!(challenge.is_in_progress && !isOwner && !activeAcceptance)
  // Back-compat alias - some branches still read `isFull`. Same semantics
  // for the JSX paths still in place (renamed in this commit).
  const isFull = inProgress

  return (
    <div className="full-page topic-chat-page">
      {/* Header - back | title (true-centered) | big type emoji (right column).
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
              {/* Tap the creator (avatar + "by name") to open their profile.
                  Registered creators only (created_by); openProfile gates guests. */}
              <button
                type="button"
                className="challenge-header-creator-link"
                disabled={!challenge.created_by}
                onClick={() => challenge.created_by && onOpenProfile?.(challenge.created_by, challenge.creator_username || challenge.creator_display_name)}
              >
                {challenge.creator_thumb_avatar_url
                  ? <img src={challenge.creator_thumb_avatar_url} alt="" className="challenge-header-creator-avatar" />
                  : null}
                <span>{t('byCreator', { name: challenge.creator_display_name })}</span>
              </button>
              {/* Notifications pill - joined participants only. Lives next
                  to the creator name at the very top so subscription state
                  is visible without scrolling past the meta row. */}
              {iAmParticipant === true && account?.id && (
                <ChallengeNotificationToggle
                  challengeId={challenge.id}
                  currentUserId={account.id}
                />
              )}
            </span>
          )}
        </div>
        <span className="challenge-header-emoji" aria-hidden="true">{typeIcon}</span>
      </div>

      {/* Collapsible region - badges + pipeline + owner actions + creator
          row + participants row all live here. Shrinks (CSS-transitioned max-
          height + opacity) when the chat is scrolled OR the composer is
          focused, mirroring the event-channel pattern. */}
      <div className={`challenge-collapsible${headerCollapsed ? ' challenge-collapsible--collapsed' : ''}`}>
      {/* Description band - type + audience badges + share. Share sits on
          this row (rather than the challenger row below) so it's visible at
          every lifecycle stage; the challenger row only appears when an
          acceptor exists, and we don't want growth nudges to disappear with
          it. */}
      {/* Always-visible row: type badge + Berlin/audience + share pill
          + collapse chevron. Everything else (visibility/manage/leave
          pills, pipeline, proof, members strip) folds behind the chevron. */}
      <div className="topic-chat-desc challenge-meta-row">
        <span className="challenge-badge challenge-badge--kind">
          {t(`typeBadge.${challenge.challenge_type}`).toUpperCase()}
        </span>
        {/* Status pill - state at a glance (replaces the big done line below). */}
        <span className={`challenge-status-pill ${(isValidated || challenge.closed) ? 'challenge-status-pill--done' : 'challenge-status-pill--live'}`}>
          {(isValidated || challenge.closed)
            ? `✓ ${t('status.done', { ns: 'challenge', defaultValue: 'Done' })}`
            : `🟢 ${t('status.live', { ns: 'challenge', defaultValue: 'Live' })}`}
        </span>
        {(challenge.mode ?? 'local') === 'international' ? (() => {
          // Origin → target flag rendering. Falls back to "🌍" for the
          // target when "anywhere" (no target_city_id) or unknown.
          const fromFlag = countryToFlag(challenge.country)
          const toFlag   = countryToFlag(challenge.target_country) || '🌍'
          const label    = fromFlag
            ? `${fromFlag} → ${toFlag}${targetCityNameOnly ? '  ·  ' + targetCityNameOnly : ''}`
            : `🌐 ${targetCityNameOnly || t('mode.international')}`
          return (
            <span className="challenge-badge challenge-badge--international">{label}</span>
          )
        })() : null /* Local = for everyone in the city; no audience pill. */}
        <button
          type="button"
          className="challenge-share-pill challenge-share-pill--inline challenge-share-pill--share"
          onClick={handleShare}
          aria-label={t('shareCta')}
        >
          <span aria-hidden="true">↗</span>
          <span className="challenge-share-pill-text">{t('shareCta')}</span>
        </button>
        {/* Collapse chevron - toggles all the channel-header detail (the
            row below + the pipeline + proof + members strip). Default
            open. Reads as "more details ↓" / "less ↑". */}
        <button
          type="button"
          className="challenge-details-toggle"
          onClick={() => setDetailsOpen(v => !v)}
          aria-expanded={detailsOpen}
          aria-label={detailsOpen ? t('details.collapseAria') : t('details.expandAria')}
        >
          <span aria-hidden="true" className={`challenge-details-toggle-chevron ${detailsOpen ? 'is-open' : ''}`}>▾</span>
        </button>
      </div>

      {/* Collapsible details - second pill row (Public / Manage / Leave)
          plus pipeline + proof + members strip. CSS max-height transition
          gives the slide animation; opacity dims so the collapse reads as
          intentional rather than glitchy. */}
      <div className={`challenge-details ${detailsOpen ? 'is-open' : 'is-closed'}`}>
      <div className="topic-chat-desc challenge-meta-row challenge-meta-row--secondary">
        {/* Visibility dropdown - Public / Friends / Private. */}
        {(() => {
          const isIntl = (challenge.mode ?? 'local') === 'international'
          const v      = challenge.visibility ?? 'public'
          const effective = challenge.closed_to_new_joins ? 'private' : v
          const label  = t(`visibility.badge.${effective}`, { ns: 'challenge' })
          const tapable = isOwner && !isIntl
          if (!tapable) {
            return (
              <span className={`challenge-share-pill challenge-share-pill--inline challenge-visibility-pill--${effective}`}>
                <span className="challenge-share-pill-text">{label}</span>
              </span>
            )
          }
          return (
            <button
              type="button"
              className={`challenge-share-pill challenge-share-pill--inline challenge-visibility-pill--${effective}`}
              onClick={() => setVisMenuOpen(true)}
              disabled={visBusy || closeBusy}
              aria-haspopup="menu"
              aria-expanded={visMenuOpen}
            >
              <span className="challenge-share-pill-text">
                {(visBusy || closeBusy) ? '…' : label}
              </span>
              <span aria-hidden="true" className="challenge-share-pill-chevron">▾</span>
            </button>
          )
        })()}
        {/* Leave the take-on - the TAKER backs out: timeline resets to zero,
            the challenge reopens, the creator is notified. Active phases only
            (matches the backend gate). */}
        {myAcceptance && !isOwner
          && ['pending', 'accepted', 'scheduled'].includes(myAcceptance.phase) && (
          <button
            type="button"
            className="challenge-share-pill challenge-share-pill--inline challenge-leave-pill"
            onClick={handleLeaveTakeon}
          >
            <span aria-hidden="true">🚪</span>
            <span className="challenge-share-pill-text">{t('leaveTakeon.pill')}</span>
          </button>
        )}
        {isOwner && (
          <button
            type="button"
            className="challenge-share-pill challenge-share-pill--inline"
            onClick={() => setManageOpen(true)}
            title={t('manage.cta')}
          >
            <span aria-hidden="true">⚙️</span>
            <span className="challenge-share-pill-text">{t('manage.cta')}</span>
          </button>
        )}
        {iAmParticipant === true && !isOwner && !myAcceptance && (
          <button
            type="button"
            className="challenge-share-pill challenge-share-pill--inline challenge-leave-pill"
            onClick={handleLeaveChannel}
          >
            <span aria-hidden="true">↩</span>
            <span className="challenge-share-pill-text">{t('join.leaveCta')}</span>
          </button>
        )}
      </div>

      {/* Scoring info (i) button. GROUP rows inline it in the deadline card
          below; legacy rows keep it here. */}
      {!isGroup && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px 4px' }}>
          <ScoringInfoButton />
        </div>
      )}

      {/* ── GROUP CHALLENGE (Phase 4): meet/contest info + join / resolve ──
          MEET → date + place + "validate who showed up".
          PHOTO-PROOF → submission deadline + "pick the winner"; joined takers
          submit via the ChallengeProofBlock rendered below. */}
      {isGroup && (
        <div style={{ padding: '2px 12px 6px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(meetSummary || challenge.venue) ? (
            <div style={{ background: 'var(--bg2,#1a1614)', border: '1px solid var(--border,#2a2422)', borderRadius: 10, padding: '6px 14px', fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted,#9a9088)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1 }}>
                {isGroupPhoto
                  ? `⏳ ${t('group.deadlinePrefix', { ns: 'challenge', defaultValue: 'Submit by' })} ${meetSummary ?? ''}`
                  : `📅 ${meetSummary ?? ''}${isGroupMeet && challenge.venue ? `   ·   📍 ${challenge.venue}` : ''}`}
              </span>
              <ScoringInfoButton />
            </div>
          ) : null}
          {isValidated ? null /* status now shown as a pill in the header */ : isOwner ? (
            // MEET: open the presence sheet. PHOTO: the winner is picked from the
            // "N photos · pick the best one" card below (no extra hint).
            isGroupPhoto ? null : !meetStarted ? (
              <div style={{ textAlign: 'center', fontWeight: 700, color: 'var(--muted,#9a9088)', padding: '8px 0', fontSize: '0.86rem' }}>
                ⏳ {t('group.validateAfter', { ns: 'challenge', time: meetSummary ?? '', defaultValue: `You can validate after the meet · ${meetSummary ?? ''}` })}
              </div>
            ) : (
              <button type="button" style={GROUP_BTN_STYLE} onClick={() => { setPresentRating(0); setValidateOpen(true) }}>
                {t('group.validateCta', { ns: 'challenge', defaultValue: 'Validate who showed up' })}  →
              </button>
            )
          ) : iAmJoined ? (
            <div style={{ textAlign: 'center', fontWeight: 700, color: '#3DDC84', padding: '8px 0' }}>
              ✓ {isGroupPhoto
                ? t('group.youreInPhoto', { ns: 'challenge', defaultValue: "You're in — submit your photo below." })
                : t('group.youreIn', { ns: 'challenge', defaultValue: "You're in — see you there!" })}
            </div>
          ) : (
            <button type="button" style={{ ...GROUP_BTN_STYLE, opacity: (challenge.closed_to_new_joins || joining) ? 0.6 : 1 }} disabled={!!challenge.closed_to_new_joins || joining} onClick={handleGroupJoin}>
              {challenge.closed_to_new_joins
                ? t('group.closed', { ns: 'challenge', defaultValue: 'Closed to new joins' })
                : `＋ ${isGroupPhoto
                    ? t('group.joinContestCta', { ns: 'challenge', defaultValue: 'Join the challenge (+2 pts)' })
                    : t('group.joinCta', { ns: 'challenge', defaultValue: 'Join the challenge (+2 pts)' })}`}
            </button>
          )}
        </div>
      )}

      {/* Photo-proof GROUP: the joined taker submits a photo via the same proof
          block the legacy flow uses, keyed on their own group acceptance. Hidden
          for the challenger (they pick a winner above) and non-participants. */}
      {isGroupPhoto && iAmJoined && !isOwner && myAcceptance && !isValidated && (
        <ChallengeProofBlock
          acceptanceId={myAcceptance.id}
          iAmCreator={false}
          iAmAcceptor={true}
          proofRequirements={challenge.proof_requirements ?? null}
          acceptancePhase={myAcceptance.phase}
          compact
        />
      )}

      {/* GROUP: members strip sits ABOVE the submissions gallery. */}
      {isGroup && iAmParticipant === true && (
        <ChallengeChannelMembers
          challenge={challenge}
          activeTaker={activeTaker}
          currentUserId={account?.id ?? null}
          onMembersChanged={() => { loadParticipants() }}
          onSelect={onOpenProfile}
        />
      )}

      {/* Photo-proof GROUP submissions gallery - everyone sees every photo + who
          submitted it; the challenger picks the winner straight from here. */}
      {isGroupPhoto && (
        <GroupSubmissionsGallery
          challengeId={id}
          isChallenger={isOwner}
          isValidated={isValidated}
          refreshKey={galleryTick}
          onChanged={() => { loadChallenge(); loadParticipants() }}
          onCount={setSubmissionCount}
        />
      )}

      {/* Lifecycle pipeline (legacy rows only - group uses the block above). */}
      {!isGroup && (
      <ChallengePipeline
        // Creator has no acceptance of their own - drive the timeline off the
        // active taker's phase so it reflects real progress (e.g. an accepted
        // international challenge at the Proof step) instead of rendering empty.
        acceptance={effectiveActiveAcceptance}
        iAmCreator={isOwner}
        myUserId={account?.id ?? null}
        mode={challenge.mode ?? 'local'}
        validationMethod={challenge.validation_method ?? 'meet'}
        onClick={(() => {
          // Local + meet only: tap pipeline subCta to open the date picker.
          // Local + photo_proof skips the date step entirely.
          if ((challenge.mode ?? 'local') === 'local'
              && (challenge.validation_method ?? 'meet') === 'meet'
              && myAcceptance && !myAcceptance.proposed_starts_at && myAcceptance.phase === 'accepted') {
            return () => setPickerOpen(true)
          }
          // Creator + photo-proof + acceptance at proof_submitted ⇒ open
          // the modal review sheet. Same path for intl and for local
          // challenges whose creator picked photo at creation.
          if (usesPhotoProof
              && isOwner
              && effectiveActiveAcceptance?.phase === 'proof_submitted') {
            return () => setProofReviewOpen(true)
          }
          // Photo-proof: tap the "Waiting for the proof" pill to re-read
          // what the creator asked for (acceptor + creator). Only matters
          // when there's a spec to show.
          if (usesPhotoProof && challenge.proof_requirements) {
            return () => setProofSpecOpen(true)
          }
          return undefined
        })()}
      />
      )}

      {/* Photo-proof submission + verdict surface. Renders for every
          challenge that uses the photo flow (international + local
          with validation_method='photo_proof') whenever there's an
          ACTIVE acceptance; visitors and creators-without-acceptance
          see no extra surface here (the pipeline above educates them
          passively). Uses activeAcceptance instead of myAcceptance so
          a terminal approved acceptance no longer keeps the
          "🎉 Challenge accomplished" banner permanently locked on the
          detail page after the challenge wrapped. Group photo-proof has its
          OWN submit block above (keyed on the group acceptance), so the legacy
          block is gated off for group to avoid a double submit surface. */}
      {!isGroup && usesPhotoProof && effectiveActiveAcceptance && (
        <ChallengeProofBlock
          acceptanceId={effectiveActiveAcceptance.id}
          iAmCreator={isOwner}
          iAmAcceptor={!isOwner}
          proofRequirements={challenge.proof_requirements ?? null}
          acceptancePhase={effectiveActiveAcceptance.phase}
        />
      )}

      {/* Members strip (legacy/non-group) - group renders it above the gallery. */}
      {!isGroup && iAmParticipant === true && (
        <ChallengeChannelMembers
          challenge={challenge}
          activeTaker={activeTaker}
          currentUserId={account?.id ?? null}
          onMembersChanged={() => { loadParticipants() }}
          onSelect={onOpenProfile}
        />
      )}
      </div>{/* /.challenge-details (collapsible) */}

      {/* Close-challenge - moved from the old status pill toggle. Same
          /validate endpoint, just smaller affordance + only visible to the
          creator now. Reopens via the same handler. */}
      {/* Owner re-invite CTA - visible only while the challenge is genuinely
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

      {/* The standalone Close-challenge button is gone - folded into the
          Manage modal opened from the inline pill in the meta row. */}

      {/* Challenger - explicitly distinguished from other participants. The
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

      {/* Lifecycle-state row (was "Participants · N" + accept-pill row). The
          legacy "Participants · 1" avatar strip is gone - the channel-members
          strip above covers the "who's in" panel for everyone. We keep just
          three passive states + the Accept CTA:
            A) viewer non-owner + validated → "This challenge is closed"
            B) acceptor exists + viewer is neither creator nor taker → passive
               "Currently being taken by X"
            C) no acceptor + non-owner + not validated → full-width Accept CTA. */}
      {!isGroup && (() => {
        // A completed challenge (isClosed) is permanently closed to new takers,
        // same passive state as the manual 'validated' archive.
        if ((isValidated || isClosed) && !isOwner) {
          return (
            <div className="challenge-participants-row">
              <span className="challenge-cta-passive">{t('cta.closed')}</span>
            </div>
          )
        }
        // PR18 - gate "Currently being taken by X" on challenge.is_in_progress
        // (server-derived: a non-terminal acceptance EXISTS) rather than on
        // otherParticipants.length, so a previously-completed challenge
        // (terminal acceptance row still in the participants list) no longer
        // reads as "in progress" - the slot is genuinely free.
        if (challenge.is_in_progress && !isValidated && !isOwner && !activeAcceptance) {
          return (
            <div className="challenge-participants-row">
              <span className="challenge-cta-passive">
                {t('cta.takenBy', { name: activeTaker?.displayName ?? '-' })}
              </span>
            </div>
          )
        }
        // PR18 - show the Take-on CTA whenever the slot is open + viewer is
        // not the owner + challenge not closed. Replaces the
        // "otherParticipants.length === 0" guard which kept a terminal user
        // (whose row is still in participants) locked on "Mission
        // accomplished" - the bug the user reported.
        if (!isOwner && !isValidated && !isClosed && !challenge.is_in_progress) {
          return (
            <div className="challenge-participants-row">
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
            </div>
          )
        }
        return null
      })()}

      {/* Members strip moved out of this slot and mounted directly under
          the pipeline / proof block (see further up). Notifications pill
          lives in the header next to the creator name. */}

      {/* Share + Accept moved into the .challenge-creator-row above as
          icon-only quick buttons. The toast (copy-link fallback) still
          fires on desktop, but now appears as a small status pill below
          the participants strip. */}
      {shareToast && (
        <p className="challenge-share-toast challenge-share-toast--inline" role="status">
          {t('shareCopied')}
        </p>
      )}

      {/* Edit / Delete / Close challenge moved into the Manage modal
          opened from the inline pill in the meta row. */}
      </div>{/* /.challenge-collapsible */}

      {/* Take-on review banners - surface ABOVE the chat instead of
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

      {/* Non-public + non-participant → conversation is locked. No CTA,
          no join step: friends/private channels are tied to creator +
          taker only, so anyone else just sees a short explainer in
          place of the chat. Public channels never render this - the
          chat below mounts directly for anyone. */}
      {!challengeIsPublic && iAmParticipant === false && (
        <div className="challenge-join-gate">
          <span className="challenge-join-gate-icon" aria-hidden="true">🔒</span>
          <h3 className="challenge-join-gate-title">{t('lock.private.title')}</h3>
          <p className="challenge-join-gate-body">{t('lock.private.body')}</p>
        </div>
      )}

      {/* Unified challenge channel chat. Public → mounts for any viewer
          (guest or registered). Friends/private → only participants;
          everyone else sees the lock state above. Reads + sends are
          server-side gated either way. */}
      {(challengeIsPublic || iAmParticipant === true) && (
      <>
          {/* Guest welcome - fires on entry for any unauthenticated
              viewer. Two-line: "chat free, no sign-up" + a direct
              sign-up CTA that routes through the existing onNeedAuth
              gate, keeping the activeChallenge mounted underneath so
              the user lands back on the same challenge after auth. */}
          {!account?.id && challengeIsPublic && showGuestWelcome ? (
            <div className="challenge-guest-welcome">
              <button
                type="button"
                className="challenge-guest-welcome-body"
                onClick={() => {
                  setShowGuestWelcome(false)
                  onNeedAuth?.('accept_challenge')
                }}
              >
                <span className="challenge-guest-welcome-text">
                  {t('welcomeGuest.title', { defaultValue: '👋 Welcome! Chat freely here - no sign-up needed.' })}
                </span>
                <span className="challenge-guest-welcome-cta">
                  {t('welcomeGuest.cta', { defaultValue: 'Want to take this challenge? Sign up in 3 seconds →' })}
                </span>
              </button>
              <button
                type="button"
                className="challenge-guest-welcome-close"
                onClick={() => setShowGuestWelcome(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          ) : null}

          {/* "Learn how challenges work" banner - same primitive as the
              city chat. Sits above the feed (not inside it) so the
              chat's scroll behaviour is untouched. Tap → opens the
              shared carousel mounted at App level; × → dismiss.
              Hidden for guests - the welcome banner above is their
              single CTA on entry. */}
          {account?.id && showChallengeIntroBanner && (
            <div className="challenge-intro-banner">
              <button
                type="button"
                className="challenge-intro-banner-body"
                onClick={() => {
                  setShowChallengeIntroBanner(false)
                  onOpenChallengeIntro?.()
                }}
              >
                {/* Long titles auto-scroll left through the same
                    Marquee primitive the weather pill uses so the
                    full "🔥 New here? Learn how challenges work"
                    string is reachable even when it overflows the
                    row. Short strings render static. */}
                <Marquee
                  text={t('prompt.challengeIntroText', { ns: 'city' })}
                  className="challenge-intro-banner-text"
                  fadeColor="#161210"
                />
                <span className="challenge-intro-banner-cta">
                  {t('prompt.challengeIntroCta', { ns: 'city' })} →
                </span>
              </button>
              <button
                type="button"
                className="challenge-intro-banner-close"
                onClick={() => setShowChallengeIntroBanner(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          )}
          <div
            className="topic-chat-feed"
            ref={feedRef}
            /* PR30 - removed the scroll-driven `collapseHeader(scrollTop > 30)`
               call. It mutated the .challenge-collapsible's max-height in
               the middle of the user's scroll gesture; the collapsible
               shrank, the feed's clientHeight grew, and iOS Safari's
               scroll-anchoring kicked in and clamped scrollTop back near 0
               - yanking the user to the top. The composer's onFocus
               handler still calls collapseHeader(true), so the collapse-
               on-keyboard-open UX is preserved; users who just want to
               scroll the chat no longer fight a moving layout. */
          >
            {messages.length === 0 && (
              <div className="topic-chat-empty">
                <span className="topic-chat-empty-icon">👋</span>
                {/* PR61 - date hint is local-only; international flow is
                    photo → verdict, so pick the intl variant. */}
                <span>{t((challenge?.mode ?? 'local') === 'international'
                  ? 'thread.emptyIntl'
                  : 'thread.empty')}</span>
              </div>
            )}
            {(() => {
              // Everyone who took the challenge: the legacy 1-1 active taker
              // PLUS every GROUP acceptor (participants = the acceptor list), so
              // a group taker reads "Taker", not "Spectator".
              const takerIds = new Set()
              if (activeTaker?.id) takerIds.add(activeTaker.id)
              for (const p of participants) { const pid = p?.id ?? p?.userId; if (pid) takerIds.add(pid) }
              const creatorUserId   = challenge.created_by ?? null
              const renderRoleBadge = (senderId) => {
                if (!senderId) return null
                if (senderId === creatorUserId) {
                  return <span className="challenge-role-badge challenge-role-badge--challenger">{t('badge.challenger')}</span>
                }
                if (takerIds.has(senderId)) {
                  return <span className="challenge-role-badge challenge-role-badge--taker">{t('badge.taker')}</span>
                }
                // PR23 - Spectator: registered users who joined the channel
                // but are neither challenger nor active taker. Anonymous
                // posters (no userId) already short-circuited above.
                return <span className="challenge-role-badge challenge-role-badge--spectator">{t('badge.spectator')}</span>
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
                    <div
                      className={`msg-bubble-wrap ${isMine ? 'mine' : ''}`}
                      style={{ opacity }}
                      onClick={e => {
                        // PR33 - click bubble opens the action overlay
                        // (emoji strip + Reply + Copy). Don't open for
                        // local optimistic / failed sends; nothing to act on.
                        if (m.status === 'sending' || m.status === 'failed') return
                        if (!m.id) return
                        const rect = e.currentTarget.getBoundingClientRect()
                        setActionBubble({ msg: m, x: rect.left, y: rect.top, isMine })
                      }}
                    >
                      {m.replyTo && (
                        <div className="msg-reply-quote">
                          <span className="msg-reply-quote-name">{m.replyTo.nickname}</span>
                          <span className="msg-reply-quote-text">
                            {m.replyTo.type === 'image' ? '📷 Photo' : (m.replyTo.content || '-')}
                          </span>
                        </div>
                      )}
                      <div className="msg-content">
                        {m.type === 'image' && m.imageUrl ? (
                          <ThumbImg
                            src={m.imageUrl}
                            alt=""
                            className="msg-image"
                            style={{ maxWidth: '100%', borderRadius: 10, display: 'block' }}
                          />
                        ) : (
                          <>
                            {/* PR31 - linkify URLs (matches TopicChatPage / city
                                chat) + render @mentions as styled, clickable
                                spans (→ profile). Mirrors App.jsx
                                renderMessageContent. */}
                            <span className="msg-text">{splitContentByMentions(m.content ?? '', m.mentions).map((seg, i) => {
                              if (seg.type === 'text') return <span key={i}>{linkifyText(seg.text, `c-${m.id ?? idx}-${i}-`)}</span>
                              if (seg.guestId) return <span key={i} className="msg-mention msg-mention--guest">👻 @{seg.username}</span>
                              return <span key={i} className="msg-mention" onClick={e => { e.stopPropagation(); onOpenProfile?.(seg.userId, seg.username) }}>@{seg.username}</span>
                            })}</span>
                            {(() => {
                              const u = extractFirstUrl(m.content)
                              return u ? <LinkPreviewCard url={u} /> : null
                            })()}
                          </>
                        )}
                      </div>
                    </div>
                    <ReactionPills reactions={m.reactions} isMine={isMine} onToggle={emoji => reactChallengeMsg(m.id, emoji)} />
                    <span className={`msg-time${isMine ? ' msg-time--mine' : ''}`}>{formatTime(m.createdAt)}</span>
                  </div>
                )
              })
            })()}
            {/* PR28 - bottom sentinel for scrollIntoView. More robust than
                el.scrollTop = el.scrollHeight, which can miss when the
                container's clientHeight is read mid-reflow (sibling
                schedule band mounting, composer keyboard, etc.). The
                snap-to-bottom effect calls bottomRef.scrollIntoView. */}
            <div ref={bottomRef} aria-hidden="true" />
          </div>

          {/* Schedule band - Local-MEET only (no date step on photo-
              proof). Viewer is the creator OR ACTIVE acceptor. Use
              activeAcceptance so a previously-completed user doesn't
              see a stale "proposed at HH:MM" band from their old
              approved row - the slot is open again, the schedule
              belongs to whoever takes it next. */}
          {(challenge.mode ?? 'local') === 'local'
            && (challenge.validation_method ?? 'meet') === 'meet'
            && activeAcceptance && account?.id && (
            <ThreadScheduleBlock
              thread={activeAcceptance}
              myUserId={account.id}
              onChange={loadMyAcceptance}
              hideEmptyCta
            />
          )}

          <ReplyPreview replyingTo={replyingTo} onCancel={() => setReplyingTo(null)} />

          <MessageComposer
            inputRef={composerInputRef}
            value={composer}
            onChange={e => mentions.onValueChange(e.target.value)}
            onSubmit={handleSendMessage}
            onFocus={() => { collapseHeader(true); if (!account?.id) onNeedAuth?.('comment_challenge') }}
            onBlur={() => collapseHeader(false)}
            dismissOnSend
            sending={sending}
            placeholder={t('composer.placeholderChallenge', { ns: 'common' })}
            showEmojiButton={false}
            mentionSuggestions={mentions.suggestions}
            onMentionSelect={mentions.selectMention}
          />
      </>
      )}

      {/* PR33 - message action overlay. Tap a bubble → opens here with
          emoji strip + Reply + Copy. Mirrors the city chat actionBubble
          (App.jsx ~line 4611) - same positional math, same emoji set. */}
      <MessageActionBubble
        bubble={actionBubble}
        onClose={() => setActionBubble(null)}
        onReact={emoji => { if (actionBubble) reactChallengeMsg(actionBubble.msg.id, emoji) }}
        onReply={() => {
          const m = actionBubble?.msg
          if (!m) return
          setReplyingTo({ id: m.id, nickname: m.nickname, content: m.content ?? '', type: m.type ?? 'text' })
        }}
      />

      {/* "Message creator" - DM shortcut for the active taker (legacy 1-1 only).
          Group challenges are many-to-one with no private coordination, so the
          DM shortcut is hidden there (especially a photo contest). */}
      {!isGroup && iAmParticipant && !isOwner && myAcceptance && account?.id && challenge.created_by && (
        <button
          type="button"
          className="challenge-dm-creator"
          onClick={() => onSendDm?.(challenge.created_by)}
        >
          💬 {t('messageCreator', { name: creator?.displayName ?? '-' })}
        </button>
      )}

      {/* Date picker - opened by the pipeline's "Propose a date →" sub-CTA
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

      {/* Members strip + notifications toggle moved to the top of the
          page (right under "Take on the challenge") - see the toolbar
          block above the chat. */}

      {/* Privacy panel dropped - visibility + close-to-new-joins now live
          as inline pills in the meta row next to "Challenge your friends"
          (visibility) and the audience badge (close). The mutual
          go-private flow's backend routes remain (challenge_privacy_requests
          + /privacy/vote) but the dedicated UI surface is gone. */}

      {/* Owner-only Manage modal (Edit / Close lifecycle / Delete). The
          backing handlers (handleEdit / handleToggleStatus / handleDelete)
          stay untouched; this is purely a presentational rollup. */}
      {manageOpen && isOwner && (
        <div className="modal-overlay" onClick={() => setManageOpen(false)}>
          <div className="modal-panel modal-panel--challenge-manage" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">{t('manage.title')}</h3>
            <div className="modal-actions modal-actions--stack">
              <button
                type="button"
                className="modal-btn modal-btn--ghost"
                onClick={() => { setManageOpen(false); handleEdit() }}
                disabled={busy !== null}
              >
                ✏️ {t('editBtn')}
              </button>
              <button
                type="button"
                className="modal-btn modal-btn--ghost"
                onClick={() => { setManageOpen(false); handleToggleStatus() }}
                disabled={busy !== null}
              >
                {isValidated ? `✓ ${t('reopenCta')}` : `🔒 ${t('closeCta')}`}
              </button>
              {/* Restart - only when there's an active taker to remove. */}
              {challenge?.is_in_progress && (
                <button
                  type="button"
                  className="modal-btn modal-btn--ghost"
                  onClick={() => { setManageOpen(false); handleRestart() }}
                  disabled={busy !== null}
                >
                  🔄 {busy === 'restart' ? '…' : t('restart.cta')}
                </button>
              )}
              <button
                type="button"
                className="modal-btn modal-btn--danger"
                onClick={() => { setManageOpen(false); handleDelete() }}
                disabled={busy !== null}
              >
                🗑️ {busy === 'delete' ? '…' : t('deleteBtn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Visibility picker - Public / Friends / Private (creator-only).
          "Private" maps to closed_to_new_joins=true on the backend, no
          mutual flow involved. Selecting Public / Friends also clears
          closed_to_new_joins so the channel re-opens. */}
      {visMenuOpen && isOwner && (
        <div className="modal-overlay" onClick={() => setVisMenuOpen(false)}>
          <div className="modal-panel modal-panel--visibility-menu" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">{t('visibility.label')}</h3>
            <div className="modal-actions modal-actions--stack">
              {['public', 'friends', 'private'].map(opt => {
                const current = challenge.closed_to_new_joins ? 'private' : (challenge.visibility ?? 'public')
                const selected = current === opt
                return (
                  <button
                    key={opt}
                    type="button"
                    className={`modal-btn modal-btn--ghost challenge-visibility-opt ${selected ? 'is-selected' : ''}`}
                    onClick={() => handlePickVisibility(opt)}
                    disabled={visBusy || closeBusy}
                  >
                    <span className="challenge-visibility-opt-label">{t(`visibility.badge.${opt}`)}</span>
                    <span className="challenge-visibility-opt-hint">
                      {opt === 'public'  ? t('visibility.publicHint')
                       : opt === 'friends' ? t('visibility.friendsHint')
                       : t('privacy.closedBody', { defaultValue: 'Closed to new joins. Existing participants stay.' })}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Creator's "Review the proof" modal - intl + local-with-photo. */}
      {usesPhotoProof && isOwner && effectiveActiveAcceptance && (
        <ProofReviewModal
          visible={proofReviewOpen}
          onClose={() => setProofReviewOpen(false)}
          acceptanceId={effectiveActiveAcceptance.id}
          onVerdict={() => { loadMyAcceptance(); loadChallenge() }}
        />
      )}

      {/* Group presence validation (challenger-only). */}
      {isGroup && validateOpen && (
        <div onClick={() => setValidateOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg,#111)', width: '100%', maxWidth: 480, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: '18px 18px calc(96px + env(safe-area-inset-bottom))', maxHeight: '85vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 18 }}>{t('group.validateTitle', { ns: 'challenge', defaultValue: 'Who showed up?' })}</h3>
            <p style={{ margin: '0 0 12px', color: 'var(--muted,#999)', fontSize: 14 }}>{t('group.validateSub', { ns: 'challenge', defaultValue: 'Tick everyone who came to the meet. They each earn the reward.' })}</p>
            {participants.length === 0 ? (
              <p style={{ color: 'var(--muted,#999)', textAlign: 'center', padding: '20px 0' }}>{t('group.noParticipants', { ns: 'challenge', defaultValue: 'Nobody has joined yet.' })}</p>
            ) : participants.map(p => {
              const on = presentChecked[p.id] !== false
              return (
                <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', cursor: 'pointer' }}>
                  <input type="checkbox" checked={on} onChange={() => setPresentChecked(prev => ({ ...prev, [p.id]: !on }))} />
                  <span style={{ fontWeight: 600 }}>{p.displayName}</span>
                </label>
              )
            })}
            {/* Meet rating - required before validating. */}
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text,#f3ede4)' }}>{t('group.rateMeet', { ns: 'challenge', defaultValue: 'How was the meet?' })}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {[1, 2, 3, 4, 5].map(n => (
                  <span
                    key={n}
                    role="button"
                    tabIndex={0}
                    onClick={() => setPresentRating(n)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPresentRating(n) } }}
                    style={{ fontSize: 30, lineHeight: 1, cursor: 'pointer', color: n <= presentRating ? '#FFC93C' : 'var(--border,#444)' }}
                  >
                    {n <= presentRating ? '★' : '☆'}
                  </span>
                ))}
              </div>
            </div>

            <button
              type="button"
              style={{ ...GROUP_BTN_STYLE, marginTop: 14, opacity: (validating || participants.length === 0 || presentRating <= 0) ? 0.5 : 1 }}
              disabled={validating || participants.length === 0 || presentRating <= 0}
              onClick={handleValidatePresence}
            >
              {validating ? '…' : t('group.validateConfirm', { ns: 'challenge', count: participants.filter(p => presentChecked[p.id] !== false).length, defaultValue: 'Validate {{count}} present' })}
            </button>
          </div>
        </div>
      )}

      {/* Proof-spec popin - tap on the "Waiting for the proof" pipeline pill
          opens this read-only sheet showing what the creator asked for. */}
      {proofSpecOpen && challenge.proof_requirements && (
        <div className="modal-overlay" onClick={() => setProofSpecOpen(false)}>
          <div className="modal-panel modal-panel--proof-spec" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">{t('intl.proof.requirementsLabel')}</h3>
            <p className="modal-body">{challenge.proof_requirements}</p>
            <div className="modal-actions">
              <button
                type="button"
                className="modal-btn modal-btn--primary"
                onClick={() => setProofSpecOpen(false)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

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
