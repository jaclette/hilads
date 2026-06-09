import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ActivityIndicator, Animated, Modal, LayoutAnimation,
  TouchableOpacity, StyleSheet, KeyboardAvoidingView, Alert, FlatList,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
// Read the tab-bar height directly from the context to avoid the throw
// useBottomTabBarHeight does when called outside a Tab Navigator. Expo Router
// pushes /challenge/[id] on top of (tabs) but the parent (tabs) navigator
// stays mounted and its tab bar overlaps the screen's bottom edge - we need
// to know that height to keep our chat input above it.
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { socket } from '@/lib/socket';
import {
  fetchChallengeById, fetchChallengeParticipants,
  validateChallenge, unvalidateChallenge, deleteChallenge,
  acceptChallenge, fetchMyAcceptances, AcceptChallengeError,
  fetchChallengeMessages, sendChallengeMessage, sendChallengeImageMessage,
  fetchMyChallengeParticipation, joinChallengeChannel, leaveChallengeChannel,
  setChallengeCloseToJoins, setChallengeVisibility, toggleChallengeReaction,
} from '@/api/challenges';
import { MessageActionSheet } from '@/features/chat/MessageActionSheet';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { reactionEmitter, EMOJI_TO_TYPE } from '@/lib/reactionEmitter';
import i18n from '@/i18n';
import { AttendeeAvatars } from '@/components/AttendeeAvatars';
import { ChallengePipeline } from '@/features/challenge/ChallengePipeline';
import { ScoringInfoButton } from '@/components/ScoringInfoButton';
import { ThreadScheduleBlock } from '@/features/challenge/ThreadScheduleBlock';
import { DatePickerModal } from '@/features/challenge/DatePickerModal';
import { ChallengeProofBlock, type ChallengeProofBlockHandle } from '@/features/challenge/ChallengeProofBlock';
import { ProofReviewModal } from '@/features/challenge/ProofReviewModal';
import { ChallengeNotificationPill } from '@/features/challenge/ChallengeNotificationPill';
import { ChallengeChannelMembersStrip } from '@/features/challenge/ChallengeChannelMembersStrip';
import { countryToFlag } from '@/lib/countryFlag';
import { proposeDate as proposeDateApi, approveTakeOn, rejectTakeOn } from '@/api/challenges';
import { ChallengeChannelMembersSheet } from '@/features/challenge/ChallengeChannelMembersSheet';
import { ChallengeIntroCarousel } from '@/features/onboarding/ChallengeIntroCarousel';
import { MarqueeText } from '@/components/MarqueeText';
import { ChallengePostCreateSheet } from '@/components/ChallengePostCreateSheet';
import { useMessages } from '@/hooks/useMessages';
import { ChatMessage } from '@/features/chat/ChatMessage';
import { ChatInput } from '@/features/chat/ChatInput';
import { avatarColor } from '@/lib/avatarColors';
import { canAccessProfile } from '@/lib/profileAccess';
import { shareLink } from '@/lib/shareLink';
import { isSameDay, formatDateLabel } from '@/lib/messageTime';
import { track } from '@/services/analytics';
import { Colors, FontSizes, Spacing, Radius, buildChallengeUrl } from '@/constants';
import type { Challenge, ChallengeType, ChallengeAudience, ChallengeThreadSummary, Message, UserDTO } from '@/types';

const TYPE_ICONS: Record<ChallengeType, string> = {
  food:    '🍜',
  place:   '📍',
  culture: '🎭',
  help:    '🤝',
};

export default function ChallengeChatScreen() {
  const router = useRouter();
  const { t } = useTranslation('challenge');
  const insets = useSafeAreaInsets();
  // Tab-bar height when our screen is nested under (tabs); 0 otherwise so
  // routes opened from elsewhere don't get phantom dead space at the bottom.
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
  const { id, postCreate } = useLocalSearchParams<{ id: string; postCreate?: string }>();
  const { identity, account, sessionId } = useApp();
  const nickname = account?.display_name ?? identity?.nickname ?? '';

  const [challenge,        setChallenge]        = useState<Challenge | null>(null);
  const [challengeLoading, setChallengeLoading] = useState(true);
  // Carry these alongside the challenge so the post-create modal can fetch
  // city members and label them by city name without re-querying.
  const [challengeCityName,    setChallengeCityName]    = useState<string | null>(null);
  const [challengeCityChannel, setChallengeCityChannel] = useState<string | null>(null);
  // Post-create sheet: visible when /challenge/:id?postCreate=1 (the create
  // form navigates there on success). Owner-only.
  const [postCreateOpen, setPostCreateOpen] = useState(false);
  const [participants,     setParticipants]     = useState<UserDTO[]>([]);
  const [membersOpen,      setMembersOpen]      = useState(false);
  const [acceptBusy,       setAcceptBusy]       = useState(false);
  const [validateBusy,     setValidateBusy]     = useState(false);
  // PR2/3/4 - if I have an acceptance on this challenge, store the full
  // summary so the lifecycle pipeline can render my current phase + the
  // Accept button can morph into "Open thread →".
  const [myAcceptance, setMyAcceptance] = useState<ChallengeThreadSummary | null>(null);

  // PR18 - once an acceptance is terminal (approved = both rated and the
  // mutual debrief landed, rejected = creator turned the take-on down)
  // the challenge has returned to "available" globally. From the user's
  // POV we should unlock the detail screen: drop the locked "Mission
  // accomplished" pipeline, re-show the Take-on CTA, allow them to
  // re-engage. Chat history stays - they're still a channel participant
  // (iAmParticipant gates on membership, not on acceptance state).
  // Re-accepting creates a new acceptance row; score_events.UNIQUE
  // prevents double-earning points on the same (user, challenge, role).
  const activeAcceptance = (myAcceptance &&
    (myAcceptance.phase === 'approved' || myAcceptance.phase === 'rejected'))
    ? null
    : myAcceptance;

  // Participation gate. null = still loading, false = visitor with no
  // explicit join row, true = creator / active taker / explicit joiner.
  // Resolves via a single GET /participants/me probe.
  //
  // Note: this gate now applies ONLY to non-public challenges. Public
  // channels (visibility='public', the default) are open to anyone — the
  // conversation surface is part of the public detail page, no join
  // step. See challengeIsPublic below.
  const [iAmParticipant, setIAmParticipant] = useState<boolean | null>(null);
  const [joiningChannel, setJoiningChannel] = useState(false);

  // "How challenges work" carousel — same primitive the city chat
  // surfaces from its delayed feed prompt. Mounting it here too so a
  // user who lands straight on a challenge (deeplink, push, share) can
  // still learn the rules without backtracking. Banner appears 8 s
  // after entering the channel (matches city chat's t4 delay) and
  // sticks around until the user taps it or dismisses with ×; both
  // dispose it for the rest of this session.
  const [showChallengeIntro,       setShowChallengeIntro]       = useState(false);
  const [showChallengeIntroBanner, setShowChallengeIntroBanner] = useState(false);
  // Guest welcome banner — shown immediately (no 8 s delay) to anyone
  // landing on a public challenge without an account. Dismissed on ×
  // or after tapping into the auth-gate, per session. Replaces the
  // intro banner for that audience so they don't see two stacked
  // affordances on entry. Guests are by definition the audience for
  // the explicit "chat free / sign up to take it" message.
  const [showGuestWelcome, setShowGuestWelcome] = useState(true);
  // Picker for the FIRST proposal (no existing proposal yet). Counter-propose
  // has its own picker inside ThreadScheduleBlock; this one is reached from
  // the pipeline's "Propose a date →" sub-CTA so we don't double up.
  const [pickerOpen, setPickerOpen] = useState(false);

  // Owner check - two paths, mutually exclusive:
  //   1. Challenge has a registered creator → ownership is decided STRICTLY
  //      by account.id. The challenge's guest_id is incidental (it captures
  //      whichever guest session backed the creator's signup) and must NOT
  //      be used as an ownership signal - the same guest_id can persist
  //      across signup/logout on a device, which would otherwise let a
  //      second account on that device falsely "own" the first's challenge.
  //   2. Challenge has NO registered creator (pure guest creation) →
  //      ownership is decided by guest_id, the only identifier on file.
  const isOwner = !!(
    challenge?.created_by != null
      ? (account?.id && account.id === challenge.created_by)
      : (identity?.guestId && challenge?.guest_id && identity.guestId === challenge.guest_id)
  );

  // "Am I currently a participant?" - derived from the participant list.
  const isParticipant = !!(
    (account?.id   && participants.some(p => p.id === account.id)) ||
    (identity?.guestId && participants.some(p => p.id === identity.guestId))
  );

  // Public channels are open to anyone — guests included. The conversation
  // surface renders inline regardless of iAmParticipant. Only friends /
  // private fall back to the gated view (and there, the lock state
  // explains the channel is private). Defaulting to 'public' on a null
  // challenge means we never flash the locked surface during the initial
  // fetch — much safer than the reverse.
  const challengeIsPublic = (challenge?.visibility ?? 'public') === 'public';

  // Photo-proof verdict path. International is always photo-proof
  // (locked server-side). Local challenges where the creator picked
  // photo at creation also use the same submission UI + creator
  // review modal. Older clients that never sent validation_method
  // get 'meet' from the format() default, so this evaluates false
  // for them — preserving the historical IRL flow.
  const usesPhotoProof =
    (challenge?.mode ?? 'local') === 'international'
    || (challenge?.validation_method ?? 'meet') === 'photo_proof';

  // Target city - only meaningful for International challenges. For Local
  // challenges this stays null; the invite picker just uses the origin
  // city below (the only city involved). For "anywhere" Intl (no target
  // set), we also fall back to origin so the creator can at least invite
  // their own city members manually.
  const [challengeTargetCityName,    setChallengeTargetCityName]    = useState<string | null>(null);
  const [challengeTargetCityChannel, setChallengeTargetCityChannel] = useState<string | null>(null);

  const loadChallenge = useCallback(() => {
    if (!id) return;
    fetchChallengeById(id)
      .then((data) => {
        const { challenge: c, channelId, cityName } = data as {
          challenge: Challenge;
          channelId: number | null;
          cityName: string | null;
          targetCityName?: string | null;
        };
        setChallenge(c);
        setChallengeCityName(cityName);
        setChallengeCityChannel(channelId != null ? String(channelId) : null);
        // target_city_id format = 'city_<int>'; pull the int for the picker
        // fetch and pair it with the targetCityName the API now returns.
        const targetCityIdRaw = (c as { target_city_id?: string | null })?.target_city_id;
        if (targetCityIdRaw) {
          setChallengeTargetCityChannel(String(targetCityIdRaw).replace(/^city_/, ''));
          setChallengeTargetCityName((data as { targetCityName?: string | null })?.targetCityName ?? null);
        } else {
          setChallengeTargetCityChannel(null);
          setChallengeTargetCityName(null);
        }
      })
      .catch(() => setChallenge(null))
      .finally(() => setChallengeLoading(false));
  }, [id]);

  // For the invite CTA + post-create picker: International with a target
  // city resolves to THAT city; Local (and "anywhere" Intl with no target)
  // resolves to the origin city. Computed at render time so the labels +
  // member-fetch always agree.
  const inviteCityName    = challengeTargetCityName    ?? challengeCityName;
  const inviteCityChannel = challengeTargetCityChannel ?? challengeCityChannel;

  const loadParticipants = useCallback(() => {
    if (!id) return;
    fetchChallengeParticipants(id)
      .then(d => setParticipants(d.participants))
      .catch(() => {});
  }, [id]);

  // Probe whether I already have an acceptance for this challenge - drives
  // the Accept (+) button morph AND the lifecycle pipeline below.
  //
  // The backend stamps exactly one row per (challenge, viewer) with
  // `is_primary_for_challenge=true`, using a deterministic "most actionable
  // first" priority. That's the source of truth - no client-side priority
  // sort to keep in sync between mobile and web.
  const loadMyAcceptance = useCallback(() => {
    if (!id || !account?.id) { setMyAcceptance(null); return; }
    fetchMyAcceptances()
      .then(threads => {
        const primary = threads.find(thr =>
          thr.challenge_id === id && thr.is_primary_for_challenge,
        );
        if (primary) { setMyAcceptance(primary); return; }
        // Back-compat: older API builds didn't stamp is_primary_for_challenge.
        // Fall back to whatever matches; the data is single-acceptance now so
        // the wrong row picked here is rare and self-corrects on next deploy.
        setMyAcceptance(threads.find(thr => thr.challenge_id === id) ?? null);
      })
      .catch(() => setMyAcceptance(null));
  }, [id, account?.id]);

  useEffect(() => {
    loadChallenge();
    loadParticipants();
    loadMyAcceptance();
  }, [loadChallenge, loadParticipants, loadMyAcceptance]);

  // Post-create modal: fired by the create form via ?postCreate=1. We wait
  // until the challenge has loaded so the modal knows the audience/city, then
  // strip the param from the URL so a back-nav doesn't re-open it.
  useEffect(() => {
    if (postCreate === '1' && challenge && !challengeLoading) {
      setPostCreateOpen(true);
      // Replace URL to drop the trigger so a refresh / back-nav doesn't re-fire.
      router.setParams({ postCreate: undefined } as never);
    }
  }, [postCreate, challenge, challengeLoading, router]);

  // ── Owner actions ───────────────────────────────────────────────────────────

  const handleEdit = useCallback(() => {
    if (!challenge) return;
    router.push({
      pathname: '/challenge/create',
      params: {
        editId:              challenge.id,
        title:               challenge.title,
        type:                challenge.challenge_type,
        audience:            challenge.audience,
        returnClause:        challenge.return_clause ?? '',
        // International fields - empty string when the challenge is Local so
        // the form's defaults kick in. The create form ignores them on Local
        // edits regardless (server enforces too).
        mode:                challenge.mode ?? 'local',
        targetCityChannelId: challenge.target_city_id
          ? String(challenge.target_city_id).replace(/^city_/, '')
          : '',
        proofRequirements:   challenge.proof_requirements ?? '',
      },
    } as never);
  }, [challenge, router]);

  const handleDelete = useCallback(() => {
    if (!identity) return;
    Alert.alert(t('deleteTitle'), t('deleteBody'), [
      { text: t('cancel', { ns: 'common' }), style: 'cancel' },
      {
        text: t('deleteConfirm'), style: 'destructive',
        onPress: async () => {
          try {
            await deleteChallenge(id, identity.guestId);
            router.back();
          } catch {
            Alert.alert(t('errSave'));
          }
        },
      },
    ]);
  }, [id, identity, router, t]);

  const handleToggleStatus = useCallback(async () => {
    if (!identity || !challenge) return;
    const wasValidated = challenge.status === 'validated';
    setValidateBusy(true);
    try {
      const updated = wasValidated
        ? await unvalidateChallenge(id, identity.guestId)
        : await validateChallenge(id, identity.guestId);
      setChallenge(updated);
      track(wasValidated ? 'challenge_unvalidated' : 'challenge_validated', { challengeId: id });
    } catch {
      Alert.alert(t('errSave'));
    } finally {
      setValidateBusy(false);
    }
  }, [id, identity, challenge, t]);

  // Owner-only "Manage challenge" modal - opens from the inline pill in
  // the meta row. Bundles Edit / Close (lifecycle) / Delete.
  const [manageOpen, setManageOpen] = useState(false);
  // International proof-spec popin - tapping the pipeline's "Waiting for
  // the proof" pill opens this read-only sheet.
  const [proofSpecOpen, setProofSpecOpen] = useState(false);
  // Imperative handle into ChallengeProofBlock so the pipeline's "Submit
  // your proof →" sub-CTA can trigger the photo picker + GPS + upload
  // flow directly. Replaces the standalone big button that used to live
  // inside the proof block.
  const proofRef = useRef<ChallengeProofBlockHandle>(null);
  // PR62 - creator-side "Review the proof" modal. Opens from the pipeline
  // sub-CTA on intl when phase='proof_submitted'. Shows the photo big +
  // Approve / Reject buttons; reject swaps the same sheet into a reason
  // prompt. Backend broadcasts the verdict on WS to both sides, so the
  // pipeline + chat refresh elsewhere via the existing acceptance
  // listener; the local screen also nudges loadMyAcceptance() on close.
  const [proofReviewOpen, setProofReviewOpen] = useState(false);

  // Creator-only visibility flip (Public ↔ Friends). Private isn't
  // reachable here - that's the mutual go-private flow. International
  // rows are forced Public; the pill renders read-only for them.
  const [visBusy, setVisBusy] = useState(false);
  const handleToggleVisibility = useCallback(async () => {
    if (!challenge || visBusy) return;
    if ((challenge.mode ?? 'local') === 'international') return;
    const current = challenge.visibility ?? 'public';
    if (current === 'private') return; // can't flip out of private here
    const next: 'public' | 'friends' = current === 'public' ? 'friends' : 'public';
    setVisBusy(true);
    try {
      await setChallengeVisibility(id, next);
      setChallenge(prev => prev ? { ...prev, visibility: next } : prev);
    } catch {
      Alert.alert(t('errSave'));
    } finally {
      setVisBusy(false);
    }
  }, [id, challenge, visBusy, t]);

  // Creator-only close-to-new-joins toggle. Existing participants stay;
  // /join refuses new ones while this is on.
  const [closeBusy, setCloseBusy] = useState(false);
  // Unified visibility picker - Public / Friends / Private. Private maps
  // to closed_to_new_joins=true; Public / Friends clear that flag and
  // align the visibility column.
  const [visMenuOpen, setVisMenuOpen] = useState(false);
  // Channel-header details (second pill row + pipeline + proof + members
  // strip) collapse behind a chevron next to the share pill - frees
  // vertical space for the chat. Default expanded.
  const [detailsOpen, setDetailsOpen] = useState(true);
  const toggleDetails = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setDetailsOpen(v => !v);
  }, []);
  const handlePickVisibility = useCallback(async (choice: 'public' | 'friends' | 'private') => {
    if (visBusy || closeBusy || !challenge) return;
    setVisMenuOpen(false);
    try {
      // Picker is the single source of truth for "who can see this and
      // who can still join". Private = hidden from non-participants AND
      // closed to new joins; public/friends = visible per the
      // visibilityWhereClause rules. The visibility endpoint now accepts
      // 'private' and also flips closed_to_new_joins server-side, so the
      // client just calls setChallengeVisibility(choice) and trusts the
      // returned state.
      if ((challenge.visibility ?? 'public') !== choice) {
        setVisBusy(true);
        await setChallengeVisibility(id, choice);
        setChallenge(prev => prev
          ? {
              ...prev,
              visibility: choice,
              // Going private closes joins on the server; reflect that
              // immediately so the joins toggle below the pill stays
              // consistent without waiting for a refetch.
              closed_to_new_joins: choice === 'private' ? true : prev.closed_to_new_joins,
            }
          : prev,
        );
        setVisBusy(false);
      }
    } catch {
      setVisBusy(false); setCloseBusy(false);
      Alert.alert(t('errSave'));
    }
  }, [id, challenge, visBusy, closeBusy, t]);

  const handleToggleClosedToJoins = useCallback(async () => {
    if (!challenge || closeBusy) return;
    const next = !challenge.closed_to_new_joins;
    setCloseBusy(true);
    try {
      await setChallengeCloseToJoins(id, next);
      setChallenge(prev => prev ? { ...prev, closed_to_new_joins: next } : prev);
    } catch {
      Alert.alert(t('errSave'));
    } finally {
      setCloseBusy(false);
    }
  }, [id, challenge, closeBusy, t]);

  // ── Participant actions (non-owner) ──────────────────────────────────────────

  // Share - uses the shared shareLink helper so Android gets URL-only in
  // `message` (Intent.EXTRA_TEXT) while iOS gets the three fields separate.
  // Available to everyone (creator + participants + drive-by visitors), even
  // when the challenge is validated - sharing an archived défi is fine.
  const handleShare = useCallback(async () => {
    if (!challenge) return;
    try {
      await shareLink({
        title:   challenge.title,
        message: t('shareInvite'),
        url:     buildChallengeUrl(challenge),
      });
      track('challenge_shared', { challengeId: challenge.id });
    } catch {
      // user cancelled or share failed - no-op
    }
  }, [challenge, t]);

  /**
   * PR2 - take-on flow.
   *
   * Three paths:
   *   1. I already have a thread → just navigate to it.
   *   2. I'm a registered user → call /accept; on success navigate to the
   *      returned thread channel; on 403 show a tailored alert (mode prompt,
   *      cap full, etc.).
   *   3. I'm a guest → bounce to auth-gate (accept requires registration).
   */
  const handleAccept = useCallback(async () => {
    if (acceptBusy) return;

    // Already actively accepted? No-op - the inline chat is right here.
    // A terminal myAcceptance (approved/rejected) does NOT block: the user
    // is re-engaging with a completed challenge; the new row coexists with
    // the old, and score_events.UNIQUE keeps points from re-firing.
    if (activeAcceptance) return;

    // Guest? Send them to register first. Carry the originating
    // challenge id as ?returnTo so the user lands back on this exact
    // screen post-signup, primed to tap Take-on again — instead of
    // landing on the NOW feed and having to re-find the challenge.
    if (!account?.id) {
      const returnTo = encodeURIComponent(`/challenge/${id}`);
      router.push(`/auth-gate?reason=accept_challenge&returnTo=${returnTo}` as never);
      return;
    }

    setAcceptBusy(true);
    try {
      await acceptChallenge(id);
      // Refresh the full summary - the pipeline flips to "Date" and the inline
      // chat block mounts (both keyed off myAcceptance becoming non-null).
      loadMyAcceptance();
      track('challenge_take_on', { challengeId: id });
    } catch (err) {
      if (err instanceof AcceptChallengeError) {
        // Localized per error code. mode_* codes also offer to open the
        // settings screen so the user can switch mode in one tap.
        if (err.code === 'mode_required' || err.code === 'mode_mismatch') {
          Alert.alert(
            t(`accept.err.${err.code}.title`),
            t(`accept.err.${err.code}.body`),
            [
              { text: t('cancel', { ns: 'common' }), style: 'cancel' },
              { text: t('accept.err.openSettings'), onPress: () => router.push('/(tabs)/me' as never) },
            ],
          );
        } else {
          Alert.alert(t(`accept.err.${err.code}.title`), err.message);
        }
      } else {
        Alert.alert(t('accept.err.unknown.title'), t('accept.err.unknown.body'));
      }
    } finally {
      setAcceptBusy(false);
    }
  }, [id, account?.id, acceptBusy, myAcceptance, loadMyAcceptance, router, t]);

  // Listen for WS status flips (validated ⇄ open) for this exact challenge
  // so the pill flips live when the creator toggles from another device.
  useEffect(() => {
    const onUpdate = (data: Record<string, unknown>) => {
      const ch = data.challenge as Challenge | undefined;
      if (ch?.id === id) setChallenge(ch);
    };
    const offV = socket.on('challenge_validated',   onUpdate);
    const offU = socket.on('challenge_unvalidated', onUpdate);
    return () => { offV(); offU(); };
  }, [id]);

  // PR2 - refresh acceptance state when someone takes on or cancels this
  // challenge (server pushes to creator's user-room + acceptor's user-room).
  useEffect(() => {
    const onAcceptanceChange = (data: Record<string, unknown>) => {
      const payload = data.payload as { challenge?: { id?: string }; challengeId?: string } | undefined;
      const eventChallengeId = payload?.challenge?.id ?? payload?.challengeId;
      if (eventChallengeId === id) loadMyAcceptance();
    };
    const offA = socket.on('challenge_accepted',              onAcceptanceChange);
    const offC = socket.on('challenge_acceptance_cancelled',  onAcceptanceChange);
    return () => { offA(); offC(); };
  }, [id, loadMyAcceptance]);

  // PR3/4/5 - refresh on date/verdict/take-on-review pushes. Schedule block
  // + pipeline + locked-state branches all read off myAcceptance, so a
  // single reload is enough.
  useEffect(() => {
    const onChange = () => loadMyAcceptance();
    const off1 = socket.on('challenge_date_proposed',     onChange);
    const off2 = socket.on('challenge_date_withdrawn',    onChange);
    const off3 = socket.on('challenge_date_approved',     onChange);
    const off4 = socket.on('challenge_verdict_approved',  onChange);
    const off5 = socket.on('challenge_verdict_rejected',  onChange);
    const off6 = socket.on('challenge_takeon_reviewed',   onChange);
    return () => { off1(); off2(); off3(); off4(); off5(); off6(); };
  }, [loadMyAcceptance]);

  // ── Unified challenge channel chat ───────────────────────────────────────
  // Replaces the per-acceptance THREAD chat. Reads + sends both gate on
  // participation server-side (creator + active taker are implicit
  // participants; everyone else clicks Join). The chat only mounts when
  // iAmParticipant === true; the participation gate decides which surface
  // the user sees.
  const guestIdForChat = identity?.guestId ?? '';
  const nicknameForChat = nickname ?? '';

  // Guest-aware sender identity. Public channels accept anyone with a
  // (guestId, nickname) tuple — same model city channels use. Registered
  // users pass their user id + display name; guests fall back to their
  // auto-generated guestId + nickname from the boot identity. Either way
  // the backend stuffs it into messages.guest_id and the read DTO
  // surfaces it as the top-level `nickname` field.
  const senderId       = account?.id ?? identity?.guestId ?? null;
  const senderNickname = nicknameForChat || account?.display_name || identity?.nickname || 'Guest';

  const loadMessagesFn = useCallback(
    (opts?: { beforeId?: string }) =>
      id && (challengeIsPublic || iAmParticipant === true)
        ? fetchChallengeMessages(id, opts)
        : Promise.resolve({ messages: [], hasMore: false }),
    [id, iAmParticipant, challengeIsPublic],
  );
  const postTextFn = useCallback(
    (content: string): Promise<Message> =>
      id && senderId
        ? sendChallengeMessage(id, senderId, senderNickname, content)
        : Promise.reject(new Error('No challenge channel')),
    [id, senderId, senderNickname],
  );
  const postImageFn = useCallback(
    (imageUrl: string): Promise<Message> =>
      id && senderId
        ? sendChallengeImageMessage(id, senderId, senderNickname, imageUrl)
        : Promise.reject(new Error('No challenge channel')),
    [id, senderId, senderNickname],
  );

  const { messages, loading: msgsLoading, loadingOlder, hasMore, sending,
          sendText, sendImage, loadOlder, reload,
          setMessageReactions, editMessage, deleteMessage } = useMessages({
    channelId: id ?? '__no_challenge__',
    loadFn:    loadMessagesFn,
    postTextFn,
    postImageFn,
  });

  // PR33 - long-press → MessageActionSheet (react / reply / copy / edit /
  // delete). Mirrors the event/[id].tsx wiring exactly; the underlying
  // useMessages hook already exposes setMessageReactions / editMessage /
  // deleteMessage, the new toggleChallengeReaction handles the network
  // round-trip + WS broadcast.
  const [actionSheetMsg, setActionSheetMsg] = useState<Message | null>(null);
  const [replyingTo,     setReplyingTo]     = useState<import('@/types').ReplyRef | null>(null);
  const [editingMsg,     setEditingMsg]     = useState<{ id: string; content: string } | null>(null);
  const replyingToRef = useRef<import('@/types').ReplyRef | null>(null);
  useEffect(() => { replyingToRef.current = replyingTo; }, [replyingTo]);

  // Re-fetch messages on the moment iAmParticipant flips false/null → true.
  // The useMessages mount-effect keys on channelId alone, so on a re-entry
  // (Now → challenge), the initial fetch fires before iAmParticipant is
  // resolved, loadMessagesFn returns empty, and the chat stays blank even
  // when the backend has history. Re-firing on the transition fixes it.
  const participantRef = useRef(false);
  useEffect(() => {
    if (iAmParticipant === true) {
      if (!participantRef.current) {
        participantRef.current = true;
        reload();
      }
    } else {
      participantRef.current = false;
    }
  }, [iAmParticipant, reload]);

  // "Learn how challenges work" banner — show 8 s after the screen
  // mounts for each new challenge id. Resets when the user moves to
  // a different challenge so the prompt reappears in that new context.
  useEffect(() => {
    if (!id) return;
    setShowChallengeIntroBanner(false);
    const timer = setTimeout(() => setShowChallengeIntroBanner(true), 8_000);
    return () => clearTimeout(timer);
  }, [id]);

  // Join the challenge channel's WS room for live newMessage broadcasts.
  // Public channels are open — any viewer (guest included) joins the room
  // so their feed updates live. Private/friends keep the participation
  // gate so non-members don't get the firehose. Leaves on unmount /
  // challenge change.
  useEffect(() => {
    if (!id || !sessionId) return;
    if (!challengeIsPublic && iAmParticipant !== true) return;
    socket.joinChallenge(id, sessionId);
    return () => socket.leaveChallenge(id, sessionId);
  }, [id, iAmParticipant, sessionId, challengeIsPublic]);

  // Resolve participation on mount + whenever acceptance flips (a fresh
  // acceptance makes the user an implicit participant via the creator/
  // active-taker branches in the backend).
  const loadParticipation = useCallback(async () => {
    if (!id) { setIAmParticipant(null); return; }
    if (!account?.id) { setIAmParticipant(false); return; }
    try {
      const res = await fetchMyChallengeParticipation(id);
      setIAmParticipant(!!res?.isIn);
    } catch { setIAmParticipant(false); }
  }, [id, account?.id]);
  useEffect(() => { loadParticipation(); }, [loadParticipation, myAcceptance?.id]);

  async function handleJoinChannel() {
    if (joiningChannel || !id) return;
    if (!account?.id) {
      router.push('/auth-gate?reason=join_challenge' as never);
      return;
    }
    setJoiningChannel(true);
    try {
      await joinChallengeChannel(id);
      setIAmParticipant(true);
      loadParticipants();
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e?.code === 'kicked')                  Alert.alert(t('join.errKicked'));
      else if (e?.code === 'closed_to_new_joins') Alert.alert(t('join.errClosed'));
      else                                       Alert.alert(e?.message || t('join.errGeneric'));
    } finally {
      setJoiningChannel(false);
    }
  }

  async function handleLeaveChannel() {
    if (!id || !account?.id) return;
    try {
      await leaveChallengeChannel(id);
      setIAmParticipant(false);
      loadParticipants();
    } catch { /* silent - re-probe on next visit */ }
  }
  // Silence unused-var warnings when the channel-chat branch is hidden.
  void guestIdForChat;

  // Web parity: separate the creator (Challenger) from the rest of the
  // participants. The creator match uses the same ownership rule as isOwner
  // (registered user_id OR guest_id). API returns the creator inside the
  // participants list (auto-joined at create time), so we just partition.
  //
  // CRITICAL: these useMemo calls MUST sit above the conditional early
  // returns below. Calling them after the early returns is a Rules of Hooks
  // violation - first render (challengeLoading=true) returns before reaching
  // them, the second render (challenge loaded) reaches them, hook count
  // mismatch → React throws "Rendered more hooks than during the previous
  // render" and the screen crashes.
  const creator = useMemo(
    () => challenge
      ? participants.find(p =>
          (challenge.created_by && p.id === challenge.created_by) ||
          (challenge.guest_id   && p.id === challenge.guest_id)
        )
      : undefined,
    [participants, challenge?.created_by, challenge?.guest_id],
  );
  const otherParticipants = useMemo(
    () => participants.filter(p => p !== creator),
    [participants, creator],
  );

  // Active taker — derived from challenge.acceptor_user_id so it stays
  // accurate when the channel reopens after a finished round. The
  // previous taker often lingers in `participants` (they joined the
  // channel), so falling back to otherParticipants[0] would surface
  // their TAKER pill even after the LATERAL slot was vacated. Hydrate
  // from `participants` when available (richer DTO — vibe/mode) and
  // fall back to the acceptor_* snapshot shipped on the challenge.
  const activeTaker = useMemo<UserDTO | null>(() => {
    if (!challenge?.acceptor_user_id) return null;
    const fromParticipants = participants.find(p => p.id === challenge.acceptor_user_id);
    if (fromParticipants) return fromParticipants;
    return {
      id:             challenge.acceptor_user_id,
      accountType:    'registered',
      username:       null,
      displayName:    challenge.acceptor_display_name ?? '?',
      avatarUrl:      challenge.acceptor_thumb_avatar_url ?? null,
      thumbAvatarUrl: challenge.acceptor_thumb_avatar_url ?? null,
      badges:         [],
      vibe:           null,
    };
  }, [
    challenge?.acceptor_user_id,
    challenge?.acceptor_display_name,
    challenge?.acceptor_thumb_avatar_url,
    participants,
  ]);

  // 1:1 gate - `inProgress` is true when the challenge has a non-terminal
  // acceptance owned by someone else. Visitors don't see the Accept button
  // (and see the in-progress locked state); the owner / current taker are
  // unaffected because they already have their own acceptance row. Uses
  // `activeAcceptance` (defined near the top - terminal acceptances treated
  // as null) so a previously-finished take doesn't keep the user locked
  // when the slot has actually freed.
  const inProgress = !!(
    challenge?.is_in_progress &&
    !isOwner &&
    !activeAcceptance
  );

  // Collapse the badges / pipeline / participants block when the user starts
  // scrolling the chat OR taps the composer (keyboard open). Mirror the
  // event-channel pattern: secondary lines shrink to 0 + fade out, content
  // padding tightens. 0 = expanded, 1 = collapsed. Driven by:
  //   - FlatList onScroll (offset > 30 collapses)
  //   - Composer focus (collapses; blur keeps it collapsed until next reset
  //     trigger - user can scroll back to top to expand)
  // The FlatList is inverted (newest at bottom): contentOffset.y > 0 means
  // the user pulled UP into older messages, which is the cue to collapse.
  const headerCollapse = useRef(new Animated.Value(0)).current;
  const collapseTo = useCallback((next: 0 | 1) => {
    Animated.timing(headerCollapse, {
      toValue: next,
      // 240ms reads as a deliberate slide (160ms felt instant). useNativeDriver
      // is off because we're animating maxHeight/opacity, not transform/opacity.
      duration: 240,
      useNativeDriver: false,
    }).start();
  }, [headerCollapse]);
  // PR32 - onChatScroll no longer mutates the header collapse. The previous
  // behavior (collapse on offset > 30) ran on every scroll tick while the
  // user was pulling up to read older messages; animating the wrapper's
  // maxHeight mid-gesture made the inverted FlatList snap back to offset 0
  // (visually the bottom = newest), so trying to scroll UP threw the user
  // BACK DOWN. The composer's onFocus already collapses the header for the
  // keyboard-open case; the user can also use the chevron toggle. A
  // no-op onScroll keeps the prop wired in case we want to re-introduce
  // a debounced behavior later.
  const onChatScroll = useCallback(() => {}, []);
  const collapsibleMaxHeight = headerCollapse.interpolate({ inputRange: [0, 1], outputRange: [320, 0] });
  const collapsibleOpacity   = headerCollapse.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  // ── Render ──────────────────────────────────────────────────────────────────

  if (challengeLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><ActivityIndicator color={Colors.accent} /></View>
      </SafeAreaView>
    );
  }

  if (!challenge) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.nav}>
          <TouchableOpacity style={styles.backPill} onPress={() => router.back()} activeOpacity={0.75}>
            <Ionicons name="chevron-back" size={18} color={Colors.text} />
            <Text style={styles.backPillText}>{t('back', { ns: 'common' })}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.center}><Text style={styles.errorText}>{t('notFound')}</Text></View>
      </SafeAreaView>
    );
  }

  const audienceLabel: Record<ChallengeAudience, string> = {
    locals:    t('forLocals'),
    explorers: t('forExplorers'),
  };
  const typeIcon = TYPE_ICONS[challenge.challenge_type] ?? '🔥';
  const isValidated = challenge.status === 'validated';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Nav - web parity: back pill | centered title | large type emoji on
          the right. The emoji is sized to roughly match the back pill so the
          title stays visually centered; no need for a manual spacer. */}
      <View style={styles.nav}>
        <TouchableOpacity style={styles.backPill} onPress={() => router.back()} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={18} color={Colors.text} />
          <Text style={styles.backPillText} numberOfLines={1}>{t('back', { ns: 'common' })}</Text>
        </TouchableOpacity>
        <View style={styles.navCenter}>
          <Text style={styles.navTitle} numberOfLines={2}>{challenge.title}</Text>
          {challenge.creator_display_name ? (
            <View style={styles.navCreatorRow}>
              {challenge.creator_thumb_avatar_url ? (
                <Image
                  source={{ uri: challenge.creator_thumb_avatar_url }}
                  style={styles.navCreatorAvatar}
                  cachePolicy="memory-disk"
                  contentFit="cover"
                />
              ) : null}
              <Text style={styles.navCreatorText} numberOfLines={1}>
                {t('byCreator', { name: challenge.creator_display_name })}
              </Text>
              {/* Notifications pill - joined participants only. Lives next
                  to the creator name at the very top so subscription state
                  is visible without scrolling past the meta row. */}
              {iAmParticipant === true && account?.id && (
                <ChallengeNotificationPill challengeId={id} currentUserId={account.id} />
              )}
            </View>
          ) : null}
        </View>
        <Text style={styles.navEmoji} accessibilityElementsHidden importantForAccessibility="no">{typeIcon}</Text>
      </View>

      {/* Collapsible region - badges, pipeline, owner actions, challenger row
          and participants row all live here. Shrinks to 0 (maxHeight + opacity
          interpolation) when the chat is scrolled into older messages OR the
          composer is focused. Mirrors the event channel collapse so the
          conversation gets vertical space when it matters. */}
      <Animated.View style={{ maxHeight: collapsibleMaxHeight, opacity: collapsibleOpacity, overflow: 'hidden' }}>
      {/* Hero - type badge + audience pill + status pill (3rd on the same row
          to save vertical space). The status pill is THE source of truth for
          the challenge's state and is visible to EVERYONE. Owner taps it to
          toggle (open ⇄ validated); non-owners see it as a read-only status. */}
      <View style={styles.hero}>
        <View style={styles.badgeRow}>
          <View style={styles.kindBadge}>
            <Text style={styles.kindBadgeText}>{t(`typeBadge.${challenge.challenge_type}`).toUpperCase()}</Text>
          </View>
          {/* Audience / mode pill - Local rows get the audience target
              (locals vs travelers); International rows swap it for a 🌐
              chip since audience doesn't apply (no IRL meetup). */}
          {(challenge.mode ?? 'local') === 'international' ? (() => {
            // 🇩🇪 → 🇻🇳 when both countries are known. Fallback to "🌍" for
            // the target on "anywhere" challenges; legacy fallback to the
            // existing 🌐 label when origin is unknown.
            const fromFlag = countryToFlag(challenge.country ?? null);
            const toFlag   = countryToFlag(challenge.target_country ?? null) || '🌍';
            const cityTail = challengeTargetCityName ? `  ·  ${challengeTargetCityName}` : '';
            const label    = fromFlag
              ? `${fromFlag} → ${toFlag}${cityTail}`
              : `🌐 ${t('mode.international')}${cityTail}`;
            return (
              <View style={styles.intlPill}>
                <Text style={styles.intlPillText} numberOfLines={1}>{label}</Text>
              </View>
            );
          })() : (
            <View style={styles.audiencePill}>
              <Text style={styles.audiencePillText}>{audienceLabel[challenge.audience]}</Text>
            </View>
          )}
          {/* Share - distinct violet tint so it doesn't blur in with the
              orange admin pills below. The verb is the social growth hook
              of the screen; it deserves its own color. */}
          <TouchableOpacity
            style={[styles.sharePillInline, styles.sharePillInlineShare]}
            onPress={handleShare}
            activeOpacity={0.75}
            accessibilityLabel={t('shareCta')}
          >
            <Ionicons name="share-social-outline" size={14} color="#c4b5fd" />
            <Text style={[styles.sharePillInlineText, styles.sharePillInlineShareText]} numberOfLines={1}>
              {t('shareCta')}
            </Text>
          </TouchableOpacity>
          {/* Collapse chevron - toggles all the details below (visibility
              pill, manage pill, pipeline, proof block, members strip).
              Default expanded; tap to fold for more chat space.
              marginLeft:'auto' pushes it to the far right of badgeRow so
              its "fold the section below" role reads at a glance. */}
          <TouchableOpacity
            style={styles.detailsToggle}
            onPress={toggleDetails}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={detailsOpen ? t('details.collapseAria') : t('details.expandAria')}
          >
            <Ionicons
              name={detailsOpen ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={Colors.muted}
            />
          </TouchableOpacity>
        </View>

        {/* Collapsible details - everything below the always-visible badge
            row. Conditional render + LayoutAnimation gives the slide-up
            collapse without a heavy Reanimated dep. */}
        {detailsOpen && (
        <View style={styles.detailsBlock}>
        <View style={[styles.hero, { paddingTop: 0 }]}>
        {/* Same badgeRow shape as the top row above so the pills sit on a
            wrapping row at their natural width instead of stretching to
            full container width inside the column-laid hero. */}
        <View style={styles.badgeRow}>
          {/* Leave the channel - joined participants who aren't the creator
              or active taker. */}
          {iAmParticipant === true && !isOwner && !myAcceptance && (
            <TouchableOpacity
              style={styles.sharePillInline}
              onPress={handleLeaveChannel}
              activeOpacity={0.75}
              accessibilityLabel={t('join.leaveCta')}
            >
              <Ionicons name="exit-outline" size={14} color="#FF7A3C" />
              <Text style={styles.sharePillInlineText} numberOfLines={1}>{t('join.leaveCta')}</Text>
            </TouchableOpacity>
          )}
          {/* Notifications pill moved to the header (next to "by creator"). */}
          {/* Visibility dropdown - Public / Friends / Private. Private folds
              the close-to-new-joins state into the same selector so the
              meta row only carries one pill. Read-only for non-owners /
              International (always Public). */}
          {(() => {
            if (!challenge) return null;
            const isIntl    = (challenge.mode ?? 'local') === 'international';
            const v         = challenge.visibility ?? 'public';
            const effective: 'public' | 'friends' | 'private' =
              challenge.closed_to_new_joins ? 'private' : (v === 'friends' ? 'friends' : 'public');
            const tapable   = isOwner && !isIntl;
            const labelKey  = `visibility.badge.${effective}`;
            const pillTint =
              effective === 'friends' ? styles.visibilityPillFriends :
              effective === 'private' ? styles.visibilityPillPrivate :
              styles.visibilityPillPublic;
            const textTint =
              effective === 'friends' ? styles.visibilityPillTextFriends :
              effective === 'private' ? styles.visibilityPillTextPrivate :
              styles.visibilityPillTextPublic;
            const busyAny = visBusy || closeBusy;
            return (
              <TouchableOpacity
                style={[styles.sharePillInline, pillTint]}
                onPress={tapable ? () => setVisMenuOpen(true) : undefined}
                disabled={!tapable || busyAny}
                activeOpacity={tapable ? 0.75 : 1}
                accessibilityRole="button"
              >
                <Text style={[styles.sharePillInlineText, textTint]} numberOfLines={1}>
                  {busyAny ? '…' : t(labelKey)}
                </Text>
                {tapable && (
                  <Text style={[styles.sharePillInlineText, textTint, { fontSize: 9, marginLeft: 2 }]}>▾</Text>
                )}
              </TouchableOpacity>
            );
          })()}
          {/* Manage challenge - creator-only pill. Opens a modal with
              Edit / Close challenge / Delete to keep the meta row tight. */}
          {isOwner && challenge && (
            <TouchableOpacity
              style={styles.sharePillInline}
              onPress={() => setManageOpen(true)}
              activeOpacity={0.75}
              accessibilityLabel={t('manage.cta')}
            >
              <Ionicons name="settings-outline" size={14} color="#FF7A3C" />
              <Text style={styles.sharePillInlineText} numberOfLines={1}>{t('manage.cta')}</Text>
            </TouchableOpacity>
          )}
          {/* Close-to-new-joins pill removed - Private inside the
              visibility dropdown above maps to closed_to_new_joins. */}
        </View>
        </View>

        {/* Scoring info - small (i) button right-aligned just above the
            pipeline. Same affordance as on the NOW Challenges section
            header. Opens the points-per-step breakdown sheet. */}
        <View style={styles.scoringInfoRow}>
          <ScoringInfoButton />
        </View>

        {/* Lifecycle pipeline (replaces the old binary "in progress / done" pill).
            Visualises all 4 steps + highlights the viewer's current one.
            Tap behaviour depends on state:
              - acceptance exists + no proposal → opens the date picker (the
                pipeline's "Propose a date →" sub-CTA is the only one we
                surface; the bottom ScheduleBlock empty state is hidden)
              - otherwise → no-op (informational). The thread chat is right
                below this, no navigation needed. */}
        <ChallengePipeline
          acceptance={activeAcceptance}
          iAmCreator={isOwner}
          myUserId={account?.id ?? null}
          mode={challenge.mode ?? 'local'}
          validationMethod={challenge.validation_method ?? 'meet'}
          onPress={(() => {
            // Local + meet only: open date picker. Local + photo_proof has
            // no date step, so don't intercept the tap to a picker that
            // would never get acted on.
            if ((challenge.mode ?? 'local') === 'local'
                && (challenge.validation_method ?? 'meet') === 'meet'
                && myAcceptance && !myAcceptance.proposed_starts_at && myAcceptance.phase === 'accepted') {
              return () => setPickerOpen(true);
            }
            if (usesPhotoProof && myAcceptance && !isOwner) {
              // Acceptor with an active acceptance - tapping the pipeline's
              // "Submit your proof →" sub-CTA fires the photo picker + GPS
              // + upload via the ChallengeProofBlock's imperative handle.
              return () => proofRef.current?.submit();
            }
            // Creator + photo-proof + acceptance is at proof_submitted ⇒ open
            // the modal review sheet. This is the "Review the proof"
            // sub-CTA path; it surfaces the photo and Approve / Reject in
            // one place instead of forcing the creator to scroll the chat
            // for the photo then hunt for the inline verdict row.
            if (usesPhotoProof
                && isOwner
                && activeAcceptance?.phase === 'proof_submitted') {
              return () => setProofReviewOpen(true);
            }
            if (usesPhotoProof && challenge.proof_requirements) {
              // Creator (no submit action) - still useful to surface the
              // requirements popin so they can re-read what they asked for.
              return () => setProofSpecOpen(true);
            }
            return undefined;
          })()}
        />

        {/* Photo-proof submission + verdict block. Renders for every
            challenge that uses the photo flow (international + local
            with validation_method='photo_proof') whenever there's an
            ACTIVE acceptance; visitors and creators-without-acceptance
            see no extra surface here (the pipeline educates them
            passively). Uses activeAcceptance so a terminal approved
            acceptance no longer keeps the "🎉 Challenge accomplished"
            banner permanently locked on the detail page after the
            challenge wrapped. */}
        {usesPhotoProof && activeAcceptance && (
          <ChallengeProofBlock
            ref={proofRef}
            acceptanceId={activeAcceptance.id}
            iAmCreator={isOwner}
            iAmAcceptor={!isOwner}
            proofRequirements={challenge.proof_requirements ?? null}
            acceptancePhase={activeAcceptance.phase}
          />
        )}

        {/* Channel members strip - mounted directly under the pipeline /
            proof block. Tap opens the full members sheet. */}
        {iAmParticipant === true && (
          <ChallengeChannelMembersStrip
            challenge={challenge}
            activeTaker={activeTaker}
            onOpen={() => setMembersOpen(true)}
          />
        )}
        </View>
        )}{/* /detailsOpen */}

        {/* PR54 - Owner re-invite CTA dropped. It was rendering between
            the members strip and the chat with a glitchy clipped top
            edge on intl creator views, and the same share affordance
            already lives in the meta row (the "↗ Share" pill).
            ChallengePostCreateSheet stays mounted; the post-create
            handler still opens it once right after creation. */}

        {/* Edit / Close challenge / Delete moved into the Manage modal
            opened from the inline pill in the meta row. */}

      </View>

      {/* Challenger - the originating user. Tap opens their profile.
          Quick actions (Share, Accept) sit on the right of the row so
          they read as the viewer's "what now" panel instead of two
          stacked competing pills below. */}
      {creator && (
        <View style={styles.challengerRow}>
          <TouchableOpacity
            style={styles.challengerLeft}
            activeOpacity={0.75}
            onPress={() => router.push({ pathname: '/user/[id]', params: { id: creator.id } })}
          >
            <View style={[styles.challengerAvatar, { backgroundColor: avatarColor(creator.id) }]}>
              {creator.thumbAvatarUrl || creator.avatarUrl ? (
                <Image
                  source={{ uri: creator.thumbAvatarUrl ?? creator.avatarUrl ?? undefined }}
                  style={StyleSheet.absoluteFill}
                  cachePolicy="memory-disk"
                  contentFit="cover"
                  transition={120}
                />
              ) : (
                <Text style={styles.challengerAvatarLetter}>
                  {(creator.displayName?.[0] ?? '?').toUpperCase()}
                </Text>
              )}
            </View>
            <View style={styles.challengerInfo}>
              <Text style={styles.challengerName} numberOfLines={1}>{creator.displayName}</Text>
              <Text style={styles.challengerTag}>👑 {t('challengerTag')}</Text>
            </View>
          </TouchableOpacity>

          {/* Share moved up next to the audience pill in the badge row so
              it's visible at every lifecycle stage (not just when there's a
              creator-participant row). */}
        </View>
      )}

      {/* Participants row - three layouts:
            A) acceptors exist → avatars + count on the left, accept button on
               the right (icon + label when the viewer can still take on).
            B) no acceptors, viewer can take on → full-width prominent labeled
               button (replaces the old "Be the first to accept" + small + duo).
            C) full → "Challenge full" label, no button.
          Skipped entirely for owners on a validated challenge (nothing to do). */}
      {/* Lifecycle-state row (was "Participants · N" + accept-pill row).
          Legacy avatar strip dropped - the channel-members strip above
          covers the "who's in" panel for everyone. Three passive states +
          the Accept CTA remain. */}
      {(() => {
        if (isValidated && !isOwner) {
          return (
            <View style={styles.participantsRow}>
              <Text style={styles.participantsEmpty}>{t('cta.closed')}</Text>
            </View>
          );
        }
        // PR18 - gate "Currently being taken by X" on challenge.is_in_progress
        // (server-derived: a non-terminal acceptance EXISTS) rather than on
        // otherParticipants.length, so a previously-completed challenge
        // (terminal acceptance still in the participants list) no longer
        // reads as "in progress" - the slot is genuinely free.
        if (challenge?.is_in_progress && !isValidated && !isOwner && !activeAcceptance) {
          return (
            <View style={styles.participantsRow}>
              <Text style={styles.participantsEmpty} numberOfLines={1}>
                {t('cta.takenBy', { name: activeTaker?.displayName ?? '-' })}
              </Text>
            </View>
          );
        }
        // PR18 - show the Take-on CTA whenever the slot is open + viewer is
        // not the owner + challenge not closed. Replaces the
        // "otherParticipants.length === 0" guard which kept a terminal user
        // (whose row is still in participants) locked at "Mission
        // accomplished" - the bug the user reported.
        //
        // !activeAcceptance: server-side `is_in_progress` (IS_IN_PROGRESS_SQL)
        // intentionally excludes 'pending' so the city feed reads "Available"
        // while the creator is reviewing. On the DETAIL page that signal is
        // wrong for the requester themselves — they already have an active
        // pending acceptance, so re-rendering the Accept CTA is misleading
        // (and previously surfaced as a half-clipped orange pill stuck under
        // the members strip while the screen was waiting on the creator's
        // response). Guard on the local truth instead.
        if (!isOwner && !isValidated && !challenge?.is_in_progress && !activeAcceptance) {
          return (
            <View style={styles.participantsRow}>
              <TouchableOpacity
                style={styles.acceptCtaFull}
                onPress={handleAccept}
                activeOpacity={0.85}
                disabled={acceptBusy}
                accessibilityLabel={t('acceptCta')}
              >
                {acceptBusy
                  ? <ActivityIndicator color="#FF7A3C" size="small" />
                  : <>
                      <Ionicons name="add" size={20} color="#FF7A3C" />
                      <Text style={styles.acceptCtaFullText}>{t('pipeline.subcta.tapToAccept')}</Text>
                    </>}
              </TouchableOpacity>
            </View>
          );
        }
        return null;
      })()}
      </Animated.View>

      {/* Inline thread chat (was previously a separate /thread/[id] screen).
          Mounts only when the viewer has an active acceptance for this
          challenge - acceptors see their own thread, creators see their
          most-recently-active acceptor's thread (server-ordered).
          paddingBottom keeps the composer above the (tabs) bar that overlaps
          this route's bottom edge (Expo Router quirk: parent tab bar isn't
          unmounted when child routes are pushed). When this screen is reached
          via a non-tabs path, tabBarHeight=0 - no dead space. */}
      <KeyboardAvoidingView
        style={[styles.flex, { paddingBottom: tabBarHeight || insets.bottom }]}
        behavior="padding"
      >
        {/* PR34 - show the chat for ALL participants once they're in the
            channel, including acceptors with phase='pending'. The pipeline
            above already conveys "waiting for the creator's review"; the
            big "En attente" block was duplicative and worse, it hid the
            very chat the acceptor needs to talk to the creator while
            waiting. Two narrow exceptions still take over the surface:
              - Creator with a pending acceptance - they need Accept/Reject
                buttons, not the chat (those buttons live in the block).
              - Acceptor whose take-on was rejected - terminal communication
                that deserves its own surface so the user understands the
                channel is closed for them.
            Both branches are handled inside the non-chat IIFE below. */}
        {(challengeIsPublic || iAmParticipant === true) && !(isOwner && myAcceptance?.phase === 'pending') && !(!isOwner && myAcceptance?.phase === 'rejected') ? (
          <>
            {/* Guest welcome — fires on entry for any unauthenticated
                viewer of a public channel. Two-line: "chat free, no
                sign-up" + a direct sign-up CTA that ports the existing
                returnTo handshake so they land back here primed to tap
                Take-on. × dismisses for the session. */}
            {!account?.id && challengeIsPublic && showGuestWelcome ? (
              <View style={styles.guestWelcome}>
                <TouchableOpacity
                  style={styles.guestWelcomeBody}
                  onPress={() => {
                    setShowGuestWelcome(false);
                    const returnTo = encodeURIComponent(`/challenge/${id}`);
                    router.push(`/auth-gate?reason=accept_challenge&returnTo=${returnTo}` as never);
                  }}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                >
                  <Text style={styles.guestWelcomeText} numberOfLines={2}>
                    {i18n.t('welcomeGuest.title', { ns: 'challenge', defaultValue: '👋 Welcome! Chat freely here — no sign-up needed.' })}
                  </Text>
                  <Text style={styles.guestWelcomeCta} numberOfLines={2}>
                    {i18n.t('welcomeGuest.cta', { ns: 'challenge', defaultValue: 'Want to take this challenge? Sign up in 3 seconds →' })}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setShowGuestWelcome(false)}
                  hitSlop={10}
                  accessibilityLabel={i18n.t('close', { ns: 'common' })}
                  style={styles.guestWelcomeClose}
                >
                  <Ionicons name="close" size={16} color={Colors.muted2} />
                </TouchableOpacity>
              </View>
            ) : null}

            {/* "Learn how challenges work" banner — same primitive the city
                chat surfaces from its delayed feed prompt. Sits above the
                FlatList (not inside it) so the inverted message list keeps
                its scroll behaviour intact and the banner stays anchored to
                the top edge. Tap → opens the carousel; × → dismiss.
                Hidden for guests — they get the welcome banner above
                instead so the entry surface stays focused on one CTA. */}
            {account?.id && showChallengeIntroBanner && (
              <View style={styles.introBanner}>
                <TouchableOpacity
                  style={styles.introBannerBody}
                  onPress={() => {
                    setShowChallengeIntroBanner(false);
                    setShowChallengeIntro(true);
                  }}
                  activeOpacity={0.75}
                >
                  {/* Long titles auto-scroll left through the same
                      MarqueeText primitive the weather pill uses, so
                      the full "🔥 New here? Learn how challenges work"
                      string is reachable even when it overflows the
                      row. Short strings render static. */}
                  <MarqueeText
                    text={i18n.t('promptChallengeIntro', { ns: 'chat' })}
                    textStyle={styles.introBannerText}
                    style={styles.introBannerMarquee}
                    fadeColor={Colors.bg2}
                  />
                  <Text style={styles.introBannerCta} numberOfLines={1}>
                    {i18n.t('promptChallengeIntroCta', { ns: 'chat' })} →
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setShowChallengeIntroBanner(false)}
                  hitSlop={10}
                  accessibilityLabel={i18n.t('close', { ns: 'common' })}
                >
                  <Ionicons name="close" size={16} color={Colors.muted2} />
                </TouchableOpacity>
              </View>
            )}
            <FlatList
              /* Filter out type='event' messages - they were auto-injected by
                 the old approveDate flow as "🎉 New event" cards. The flow
                 was removed, but historical rows linger; the thread chat is
                 not the place to surface event invites. */
              data={messages.filter(m => m.type !== 'event')}
              keyExtractor={(m, i) => m.id ?? String(i)}
              renderItem={({ item, index }) => {
                const olderMsg = messages[index + 1];
                const newerMsg = messages[index - 1];
                const isGrouped = !!olderMsg && olderMsg.guestId === item.guestId && olderMsg.type !== 'system' && item.type !== 'system';
                const showTime = item.type !== 'system' && (!newerMsg || newerMsg.guestId !== item.guestId || newerMsg.type === 'system');
                const dateLabel = !isSameDay(item.createdAt, olderMsg?.createdAt) ? formatDateLabel(item.createdAt) : undefined;
                // PR9 - challenger / taker pill next to the nickname (web parity).
                // Heuristic matches ChallengeChatPage.jsx: first non-creator
                // channel participant = active taker.
                // PR23 - anyone else with a userId who posts in the channel
                // is a Spectator (channel joiner without an active acceptance).
                // Anonymous posters (no userId) get no badge.
                const senderId = item.userId ?? null;
                const roleBadge: 'challenger' | 'taker' | 'spectator' | null =
                    !senderId
                      ? null
                      : (challenge.created_by && senderId === challenge.created_by)
                          ? 'challenger'
                          : (activeTaker?.id && senderId === activeTaker.id)
                              ? 'taker'
                              : 'spectator';
                return (
                  <ChatMessage
                    message={item}
                    myGuestId={identity?.guestId}
                    isGrouped={isGrouped}
                    showTime={showTime}
                    dateLabel={dateLabel}
                    roleBadge={roleBadge}
                    onLongPress={(msg) => {
                      if (!msg.id || msg.id.startsWith('local-')) return;
                      setActionSheetMsg(msg);
                    }}
                    onReact={async (msg, emoji) => {
                      if (!msg.id || !identity || !id) return;
                      try {
                        const reactions = await toggleChallengeReaction(id, msg.id, emoji, identity.guestId);
                        setMessageReactions(msg.id, reactions);
                      } catch (e) {
                        console.warn('[challenge] reaction failed:', e);
                      }
                    }}
                  />
                );
              }}
              inverted
              contentContainerStyle={styles.chatList}
              keyboardShouldPersistTaps="handled"
              onScroll={onChatScroll}
              scrollEventThrottle={32}
              onEndReached={hasMore ? loadOlder : undefined}
              onEndReachedThreshold={0.2}
              ListFooterComponent={loadingOlder ? (
                <View style={styles.loadingOlderWrap}><ActivityIndicator size="small" color={Colors.muted} /></View>
              ) : null}
              ListEmptyComponent={!msgsLoading ? (
                <View style={styles.emptyChat}>
                  <Text style={styles.emptyChatEmoji}>👋</Text>
                  {/* PR61 - the local copy talks about agreeing on a meet-up
                      date; international challenges have no meet-up step
                      (the flow is submit photo → verdict), so the date hint
                      was confusing on intl. Pick the matching variant. */}
                  <Text style={styles.emptyChatText}>
                    {t((challenge?.mode ?? 'local') === 'international'
                      ? 'thread.emptyIntl'
                      : 'thread.empty')}
                  </Text>
                </View>
              ) : null}
            />

            {/* Schedule band - Local-MEET only (skip on photo-proof: no
                date to schedule, the timeline goes straight from accept
                to proof submission). Only for the creator + ACTIVE taker.
                Uses activeAcceptance so a previously-completed user
                doesn't see a stale "proposed at HH:MM" from their old
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

            <ChatInput
              sending={sending}
              onFocus={() => collapseTo(1)}
              onBlur={() => collapseTo(0)}
              dismissOnSend
              onSendText={(text) => {
                const reply = replyingToRef.current;
                setReplyingTo(null);
                sendText(text, reply);
              }}
              onSendImage={sendImage}
              replyingTo={replyingTo}
              onCancelReply={() => setReplyingTo(null)}
              editing={editingMsg}
              onSubmitEdit={async (text) => {
                if (!editingMsg) return;
                const idToEdit = editingMsg.id;
                setEditingMsg(null);
                try { await editMessage(idToEdit, text); }
                catch (e) {
                  console.warn('[challenge] edit failed:', e);
                  Alert.alert(i18n.t('editFailed', { ns: 'chat' }));
                }
              }}
              onCancelEdit={() => setEditingMsg(null)}
            />
          </>
        ) : (
          /* Non-chat surface. Branches (in priority order):
             - non-public + iAmParticipant=false → private lock state
             - Creator + pending acceptance → review banner with accept/reject
             - Acceptor + pending           → "Waiting for review"
             - Acceptor + rejected          → "Your take-on was declined"
             Public channels never reach this branch when the viewer isn't
             a participant — the chat above renders for them directly. */
          (() => {
            // Non-public + non-participant → conversation is locked. No
            // CTA, no join step (those channels are tied to creator +
            // taker only); the line just explains why the chat is hidden.
            // Hide while iAmParticipant is still null (probe in flight)
            // to avoid a brief flash of the locked surface.
            if (!challengeIsPublic && iAmParticipant === false) {
              return (
                <View style={styles.lockedWrap}>
                  <Text style={styles.lockedEmoji}>🔒</Text>
                  <Text style={styles.lockedTitle}>{t('lock.private.title')}</Text>
                  <Text style={styles.lockedBody}>{t('lock.private.body')}</Text>
                </View>
              );
            }

            const isPending  = myAcceptance?.phase === 'pending';
            const isRejected = myAcceptance?.phase === 'rejected';

            // Creator side - a pending request awaiting their review. Inline
            // Accept / Reject buttons. Tapping fires the API, the WS push
            // refreshes loadMyAcceptance, and the panel morphs into the chat.
            if (isOwner && isPending && myAcceptance) {
              const acceptorName = myAcceptance.counterparty.displayName || '?';
              return (
                <View style={styles.lockedWrap}>
                  <Text style={styles.lockedEmoji}>🤝</Text>
                  <Text style={styles.lockedTitle}>
                    {t('takeon.creator.pendingTitle', { name: acceptorName })}
                  </Text>
                  <Text style={styles.lockedBody}>
                    {t('takeon.creator.pendingBody', { name: acceptorName })}
                  </Text>
                  <View style={styles.takeonReviewActions}>
                    <TouchableOpacity
                      style={styles.takeonRejectBtn}
                      onPress={async () => {
                        try { await rejectTakeOn(myAcceptance.id); loadMyAcceptance(); }
                        catch { Alert.alert(t('takeon.creator.rejectFailed')); }
                      }}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.takeonRejectText}>{t('takeon.creator.reject')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.takeonAcceptBtn}
                      onPress={async () => {
                        try { await approveTakeOn(myAcceptance.id); loadMyAcceptance(); }
                        catch { Alert.alert(t('takeon.creator.approveFailed')); }
                      }}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.takeonAcceptText}>{t('takeon.creator.approve')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }

            // Acceptor - pending / rejected states.
            if (!isOwner && isPending) {
              const creatorName = myAcceptance?.counterparty.displayName || '?';
              return (
                <View style={styles.lockedWrap}>
                  <Text style={styles.lockedEmoji}>⏳</Text>
                  <Text style={styles.lockedTitle}>{t('takeon.acceptor.waitingTitle')}</Text>
                  <Text style={styles.lockedBody}>{t('takeon.acceptor.waitingBody', { name: creatorName })}</Text>
                </View>
              );
            }
            if (!isOwner && isRejected) {
              const creatorName = myAcceptance?.counterparty.displayName || '?';
              return (
                <View style={styles.lockedWrap}>
                  <Text style={styles.lockedEmoji}>✕</Text>
                  <Text style={styles.lockedTitle}>{t('takeon.acceptor.rejectedTitle')}</Text>
                  <Text style={styles.lockedBody}>{t('takeon.acceptor.rejectedBody', { name: creatorName })}</Text>
                </View>
              );
            }

            // Visitor + challenge is in progress with someone else → show
            // the "someone's on this one" state instead of the generic
            // take-on nudge. Creator falls back to the regular branch.
            if (!isOwner && inProgress) {
              return (
                <View style={styles.lockedWrap}>
                  <Text style={styles.lockedEmoji}>⏳</Text>
                  <Text style={styles.lockedTitle}>{t('locked.inProgress.title')}</Text>
                  <Text style={styles.lockedBody}>{t('locked.inProgress.body')}</Text>
                </View>
              );
            }

            // Default - visitor (available) or empty-creator state.
            return (
              <View style={styles.lockedWrap}>
                <Text style={styles.lockedEmoji}>🔒</Text>
                <Text style={styles.lockedTitle}>
                  {isOwner ? t('locked.creator.title') : t('locked.visitor.title')}
                </Text>
                <Text style={styles.lockedBody}>
                  {isOwner ? t('locked.creator.body')  : t('locked.visitor.body')}
                </Text>
              </View>
            );
          })()
        )}
      </KeyboardAvoidingView>

      {/* Date picker - opened by the pipeline's "Propose a date →" sub-CTA. */}
      {myAcceptance && (
        <DatePickerModal
          visible={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSubmit={async (startsAtUnix, endsAtUnix, venue) => {
            setPickerOpen(false);
            try {
              await proposeDateApi(myAcceptance.id, startsAtUnix, endsAtUnix, venue);
              loadMyAcceptance();
            } catch {
              Alert.alert(t('schedule.err.proposeFailed'));
            }
          }}
          submitLabel={t('schedule.proposeCta')}
        />
      )}

      {/* Channel members sheet - synthesizes Challenger + Taker rows
          at the head from the challenge/acceptance context, then lists
          joined participants. Kick button surfaces for creator +
          active taker (server enforces too). */}
      {challenge && (
        <ChallengeChannelMembersSheet
          visible={membersOpen}
          challenge={challenge}
          activeTaker={activeTaker}
          currentUserId={account?.id ?? null}
          isCreator={isOwner}
          isActiveTaker={!!myAcceptance && !myAcceptance.i_am_creator}
          onClose={() => setMembersOpen(false)}
          onSelect={(uid) => {
            // PR27 - close the sheet first so the navigation doesn't race
            // its dismiss animation. Ghost / unauthenticated viewers go
            // through the auth-gate (same guard used for @mentions in
            // ChatMessage); registered users land on the public profile.
            setMembersOpen(false);
            if (!canAccessProfile(account)) { router.push('/auth-gate'); return; }
            router.push({ pathname: '/user/[id]', params: { id: uid } });
          }}
          onMembersChanged={() => loadParticipants()}
        />
      )}

      {/* Manage challenge modal - Edit / Close / Delete bundled. */}
      {challenge && (
        <Modal
          visible={manageOpen && isOwner}
          animationType="fade"
          transparent
          onRequestClose={() => setManageOpen(false)}
        >
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setManageOpen(false)} />
          <View style={styles.manageSheet}>
            <Text style={styles.manageTitle}>{t('manage.title')}</Text>
            <TouchableOpacity
              style={styles.manageRow}
              onPress={() => { setManageOpen(false); handleEdit(); }}
              activeOpacity={0.75}
            >
              <Ionicons name="create-outline" size={18} color={Colors.text} />
              <Text style={styles.manageRowText}>{t('editTitle')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.manageRow}
              onPress={() => { setManageOpen(false); handleToggleStatus(); }}
              disabled={validateBusy}
              activeOpacity={0.75}
            >
              <Ionicons
                name={isValidated ? 'checkmark-circle' : 'lock-closed-outline'}
                size={18}
                color={isValidated ? '#22c55e' : Colors.text}
              />
              <Text style={[styles.manageRowText, isValidated && { color: '#22c55e' }]}>
                {isValidated ? t('reopenCta') : t('closeCta')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.manageRow, styles.manageRowDanger]}
              onPress={() => { setManageOpen(false); handleDelete(); }}
              activeOpacity={0.75}
            >
              <Ionicons name="trash-outline" size={18} color="#fca5a5" />
              <Text style={[styles.manageRowText, { color: '#fca5a5' }]}>{t('deleteConfirm')}</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      )}

      {/* Creator's proof-review modal. Big photo + Approve / Reject +
          reject-reason face. Mounted for any photo-proof creator (intl
          + local-with-photo) with an active acceptance — the modal
          renders nothing if there's no pending proof. */}
      {usesPhotoProof && isOwner && activeAcceptance && (
        <ProofReviewModal
          visible={proofReviewOpen}
          onClose={() => setProofReviewOpen(false)}
          acceptanceId={activeAcceptance.id}
          onVerdict={() => { loadMyAcceptance(); loadChallenge(); }}
        />
      )}

      {/* Proof-spec popin - read-only sheet showing what the creator asked
          for. Opened by tapping the pipeline's "Waiting for the proof" pill. */}
      {challenge?.proof_requirements && (
        <Modal
          visible={proofSpecOpen}
          animationType="fade"
          transparent
          onRequestClose={() => setProofSpecOpen(false)}
        >
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setProofSpecOpen(false)} />
          <View style={styles.manageSheet}>
            <Text style={styles.manageTitle}>{t('intl.proof.requirementsLabel')}</Text>
            <Text style={styles.proofSpecBody}>{challenge.proof_requirements}</Text>
            <TouchableOpacity
              style={[styles.manageRow, { justifyContent: 'center' }]}
              onPress={() => setProofSpecOpen(false)}
              activeOpacity={0.75}
            >
              <Text style={[styles.manageRowText, { color: '#FF7A3C' }]}>OK</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      )}

      {/* Visibility picker - Public / Friends / Private dropdown. */}
      {challenge && (
        <Modal
          visible={visMenuOpen && isOwner}
          animationType="fade"
          transparent
          onRequestClose={() => setVisMenuOpen(false)}
        >
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setVisMenuOpen(false)} />
          <View style={styles.manageSheet}>
            <Text style={styles.manageTitle}>{t('visibility.label')}</Text>
            {(['public', 'friends', 'private'] as const).map(opt => {
              const current: 'public' | 'friends' | 'private' =
                challenge.closed_to_new_joins ? 'private' : ((challenge.visibility ?? 'public') === 'friends' ? 'friends' : 'public');
              const selected = current === opt;
              const hint =
                opt === 'public'  ? t('visibility.publicHint')  :
                opt === 'friends' ? t('visibility.friendsHint') :
                t('privacy.closedBody', { defaultValue: 'Closed to new joins. Existing participants stay.' });
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.manageRow, selected && { backgroundColor: 'rgba(255,122,60,0.10)', borderWidth: 1, borderColor: 'rgba(255,122,60,0.40)' }]}
                  onPress={() => handlePickVisibility(opt)}
                  disabled={visBusy || closeBusy}
                  activeOpacity={0.75}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.manageRowText}>{t(`visibility.badge.${opt}`)}</Text>
                    <Text style={{ fontSize: FontSizes.sm - 1, color: Colors.muted, marginTop: 2 }}>{hint}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </Modal>
      )}

      {/* Post-create "seed it" sheet - first opens with two CTAs (invite city
          members / share externally), then morphs into a multi-select picker. */}
      <ChallengePostCreateSheet
        visible={postCreateOpen}
        challenge={challenge}
        cityChannelId={inviteCityChannel}
        cityName={inviteCityName}
        currentUserId={account?.id ?? null}
        onClose={() => setPostCreateOpen(false)}
        onShare={handleShare}
      />

      {/* PR33 - message action sheet (long-press on a chat bubble). Mirrors
          the event-channel wiring: react / reply / copy / edit / delete.
          Edit + delete only render when the message belongs to the caller. */}
      <MessageActionSheet
        visible={actionSheetMsg !== null}
        reactions={actionSheetMsg?.reactions ?? []}
        onReact={async (emoji) => {
          if (!actionSheetMsg?.id || !identity || !id) return;
          reactionEmitter.emit(actionSheetMsg.id, EMOJI_TO_TYPE[emoji] ?? 'heart');
          try {
            const reactions = await toggleChallengeReaction(id, actionSheetMsg.id, emoji, identity.guestId);
            setMessageReactions(actionSheetMsg.id, reactions);
          } catch (e) {
            console.warn('[challenge] reaction failed:', e);
          }
        }}
        onReply={actionSheetMsg ? () => {
          setReplyingTo({
            id:       actionSheetMsg.id!,
            nickname: actionSheetMsg.nickname,
            content:  actionSheetMsg.content ?? '',
            type:     actionSheetMsg.type ?? 'text',
          });
        } : undefined}
        onCopy={actionSheetMsg?.content ? () => {
          Clipboard.setStringAsync(actionSheetMsg.content!).catch(() => {});
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        } : undefined}
        onEdit={(() => {
          if (!actionSheetMsg) return undefined;
          const mine = (account?.id && actionSheetMsg.userId === account.id) ||
                       (identity?.guestId && actionSheetMsg.guestId === identity.guestId);
          const editable = actionSheetMsg.type === 'text' && !actionSheetMsg.deletedAt &&
                           !!actionSheetMsg.content && !actionSheetMsg.content.startsWith('📍');
          return mine && editable ? () => {
            setReplyingTo(null);
            setEditingMsg({ id: actionSheetMsg.id!, content: actionSheetMsg.content! });
          } : undefined;
        })()}
        onDelete={(() => {
          if (!actionSheetMsg) return undefined;
          const mine = (account?.id && actionSheetMsg.userId === account.id) ||
                       (identity?.guestId && actionSheetMsg.guestId === identity.guestId);
          return mine && !actionSheetMsg.deletedAt ? () => {
            const msgId = actionSheetMsg.id!;
            Alert.alert(
              i18n.t('deleteConfirmTitle', { ns: 'chat' }),
              i18n.t('deleteConfirmBody',  { ns: 'chat' }),
              [
                { text: i18n.t('deleteConfirmCancel', { ns: 'chat' }), style: 'cancel' },
                { text: i18n.t('deleteConfirmCta',    { ns: 'chat' }), style: 'destructive',
                  onPress: async () => {
                    try { await deleteMessage(msgId); }
                    catch (e) {
                      console.warn('[challenge] delete failed:', e);
                      Alert.alert(i18n.t('deleteFailed', { ns: 'chat' }));
                    }
                  } },
              ],
            );
          } : undefined;
        })()}
        onClose={() => setActionSheetMsg(null)}
      />

      {/* "How challenges work" carousel — shared primitive used by the
          city-chat intro prompt. Last slide CTA routes to /challenge/
          create so a newcomer who just learned the rules can launch
          one without backtracking. */}
      <ChallengeIntroCarousel
        visible={showChallengeIntro}
        onClose={() => setShowChallengeIntro(false)}
        onCreateChallenge={() => {
          setShowChallengeIntro(false);
          router.push('/challenge/create' as never);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  flex:      { flex: 1 },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: FontSizes.md, color: Colors.red, padding: Spacing.md, textAlign: 'center' },

  // "Learn how challenges work" banner — slim row above the chat
  // list, mirroring the visual of the city-chat prompt pill so the
  // two surfaces read as the same affordance.
  introBanner: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               8,
    marginHorizontal:  Spacing.md,
    marginTop:         Spacing.xs,
    marginBottom:      Spacing.xs,
    paddingVertical:   8,
    paddingHorizontal: 12,
    backgroundColor:   Colors.bg2,
    borderRadius:      Radius.md,
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.30)',
  },
  introBannerBody: {
    flex:           1,
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            8,
  },
  // Marquee clip window — claims the leftover row space between the
  // banner padding and the "Show me →" CTA so long titles only scroll
  // inside this region. Fixed height matches one line of the body
  // font so the banner doesn't grow when a long string lands.
  introBannerMarquee: { flex: 1, height: 18 },
  introBannerText: {
    color:      Colors.text,
    fontSize:   FontSizes.sm,
    fontWeight: '600',
    lineHeight: 18,
  },
  introBannerCta: {
    color:      Colors.accent,
    fontSize:   FontSizes.sm,
    fontWeight: '700',
  },

  // Guest welcome — slightly taller than the intro banner because the
  // copy splits across two lines (welcome + sign-up CTA). Same warm-
  // dark fill + accent-orange ring so the two surfaces feel like
  // siblings even though only one shows at a time.
  guestWelcome: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               8,
    marginHorizontal:  Spacing.md,
    marginTop:         Spacing.xs,
    marginBottom:      Spacing.xs,
    paddingVertical:   10,
    paddingHorizontal: 12,
    backgroundColor:   Colors.bg2,
    borderRadius:      Radius.md,
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.30)',
  },
  guestWelcomeBody: {
    flex: 1,
    gap:  2,
  },
  guestWelcomeText: {
    color:      Colors.text,
    fontSize:   FontSizes.sm,
    fontWeight: '600',
  },
  guestWelcomeCta: {
    color:      Colors.accent,
    fontSize:   FontSizes.sm,
    fontWeight: '700',
  },
  guestWelcomeClose: {
    alignSelf: 'flex-start',
    paddingTop: 2,
  },

  // Nav
  nav: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap:               Spacing.sm,
  },
  backPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
  },
  backPillText: { color: Colors.text, fontSize: FontSizes.sm, fontWeight: '700' },
  navCenter: { flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  navTitle:  { fontSize: FontSizes.md, fontWeight: '800', color: Colors.text, flexShrink: 1, textAlign: 'center' },
  navCreatorRow:    { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  navCreatorAvatar: { width: 14, height: 14, borderRadius: 7 },
  navCreatorText:   { fontSize: 11, fontWeight: '600', color: Colors.muted, flexShrink: 1 },
  // Sized to roughly match the back-pill width so the title stays centered
  // without needing a manual right-side spacer.
  navEmoji:  { fontSize: 28, lineHeight: 32, minWidth: 64, textAlign: 'center' },

  // Hero (badge + audience + status + actions)
  hero: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    gap:               Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },

  kindBadge: {
    backgroundColor:   'rgba(255,122,60,0.14)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8, paddingVertical: 2,
    borderWidth:       1, borderColor: 'rgba(255,122,60,0.30)',
  },
  kindBadgeText: { fontSize: 10, fontWeight: '800', color: '#FF7A3C', letterSpacing: 0.5 },

  // Violet tint - see ChallengeVersusCard for the rationale (distinct from
  // orange brand + green validated, the other pills on the same row).
  audiencePill: {
    backgroundColor:   'rgba(139,92,246,0.12)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8, paddingVertical: 2,
    borderWidth:       1, borderColor: 'rgba(139,92,246,0.32)',
  },
  audiencePillText: { fontSize: 11, fontWeight: '700', color: '#A78BFA', letterSpacing: 0.3 },

  // International chip - cyan, distinct from audience violet so Local vs
  // Intl reads at a glance (mirrors the NOW-card pattern from step 8).
  intlPill: {
    backgroundColor:   'rgba(56,189,248,0.12)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8, paddingVertical: 2,
    borderWidth:       1, borderColor: 'rgba(56,189,248,0.36)',
    flexShrink:        1,
  },
  intlPillText: { fontSize: 11, fontWeight: '700', color: '#38bdf8', letterSpacing: 0.3 },

  // Share inline pill - same height/padding as the kind + audience pills so
  // the three sit on a single row without alignment drift. Orange brand tint
  // because Share is the most user-facing growth lever on this screen.
  sharePillInline: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor:   'rgba(255,122,60,0.10)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8, paddingVertical: 2,
    borderWidth:       1, borderColor: 'rgba(255,122,60,0.30)',
  },
  sharePillInlineText: { fontSize: 11, fontWeight: '700', color: '#FF7A3C', letterSpacing: 0.3 },

  // Share gets its own violet tint - distinct from the orange admin
  // pills (Manage / Leave / Visibility-public-default).
  sharePillInlineShare: {
    backgroundColor: 'rgba(167,139,250,0.10)',
    borderColor:     'rgba(167,139,250,0.35)',
  },
  sharePillInlineShareText: { color: '#c4b5fd' },

  // Collapse chevron at the far right of badgeRow - toggles the channel-
  // header details (second pill row + pipeline + proof + members strip).
  // marginLeft:'auto' floats it right so the role reads as "fold what's
  // below", not as another inline pill.
  detailsToggle: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
    marginLeft: 'auto',
  },

  // Detail block - wraps the collapsible content below the always-visible
  // hero row. LayoutAnimation handles the height transition.
  detailsBlock: { },

  // Right-aligned thin row above the pipeline that holds the (i) scoring-
  // info button. paddingHorizontal matches the pipeline's so the icon
  // aligns with the rightmost pipeline node.
  scoringInfoRow: {
    flexDirection:     'row',
    justifyContent:    'flex-end',
    paddingHorizontal: Spacing.md,
    paddingTop:        Spacing.sm,
    paddingBottom:     Spacing.xs,
  },

  // Visibility pill tints - applied to BOTH the TouchableOpacity (for
  // background + borderColor) and the inner Text (for color). Split into
  // pill/text objects so the View vs Text types stay clean.
  visibilityPillPublic:      { backgroundColor: 'rgba(255,122,60,0.10)', borderColor: 'rgba(255,122,60,0.30)' },
  visibilityPillFriends:     { backgroundColor: 'rgba(147,197,253,0.10)', borderColor: 'rgba(147,197,253,0.30)' },
  visibilityPillPrivate:     { backgroundColor: 'rgba(252,165,165,0.10)', borderColor: 'rgba(252,165,165,0.30)' },
  visibilityPillTextPublic:  { color: '#FFB37A' },
  visibilityPillTextFriends: { color: '#93c5fd' },
  visibilityPillTextPrivate: { color: '#fca5a5' },

  // Close-to-new-joins pill - on-state retints to a deeper orange so the
  // creator can see at a glance whether the channel is locked.
  closedPillOn: {
    backgroundColor: 'rgba(255,122,60,0.20)',
    borderColor:     'rgba(255,122,60,0.55)',
  },

  // (Old status-pill styles removed - the ChallengePipeline component owns
  // the lifecycle visual now. The close-challenge action moved to the
  // owner-secondary row as a small ghost button.)

  // Secondary housekeeping row - icon + small label, ghost styling so the
  // eye lands on the orange CTA above first.
  ownerSecondaryRow: {
    flexDirection:  'row',
    justifyContent: 'center',
    gap:            Spacing.lg,
    marginTop:      Spacing.sm,
  },
  ownerIconBtn: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            4,
    paddingVertical:   4,
    paddingHorizontal: 6,
  },
  ownerIconLabel: { fontSize: FontSizes.xs, fontWeight: '600', color: Colors.muted },

  // Primary owner CTA - "Send it to someone in {city}". Cyan rather than
  // orange so it visually separates from the share pill above (which IS
  // orange - both stacked oranges read as the same call repeated). Cyan
  // also echoes the 🌐 International badge in the row above it on intl
  // rows, so the visual link "this is the targeting CTA" reads at a
  // glance.
  ownerInviteCta: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               8,
    paddingVertical:   Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       'rgba(56,189,248,0.45)',
    backgroundColor:   'rgba(56,189,248,0.10)',
    marginTop:         Spacing.sm,
    alignSelf:         'center',
  },
  ownerInviteCtaIcon: { fontSize: 14, lineHeight: 18 },
  ownerInviteCtaText: { fontSize: FontSizes.sm, fontWeight: '700', color: '#38bdf8', flexShrink: 1 },

  // Challenger row - the creator, distinguished from regular participants
  // with a 👑 pill in brand orange. Bigger avatar (44px) so the originating
  // user reads as the anchor of the défi.
  challengerRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  // Left half of the row stays tappable as a profile link; right half
  // hosts the inline quick actions.
  challengerLeft: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.sm,
    flex:          1,
  },
  challengerAvatar: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  challengerAvatarLetter: { color: '#fff', fontWeight: '700', fontSize: 18 },
  challengerInfo: { flex: 1, gap: 2, minWidth: 0 },
  challengerName: { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
  challengerTag:  { fontSize: 11, fontWeight: '800', color: '#FF7A3C', letterSpacing: 0.3 },

  // Inline quick-action group - Share is a labeled pill (verb is the
  // social hook), Accept is the compact icon-only round next to it.
  quickActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  sharePill: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              6,
    height:           36,
    paddingHorizontal: 12,
    borderRadius:     18,
    backgroundColor:  'rgba(255,122,60,0.10)',
    borderWidth:      1,
    borderColor:      'rgba(255,122,60,0.30)',
    maxWidth:         200,
  },
  sharePillText: { color: '#FF7A3C', fontSize: 12, fontWeight: '800', letterSpacing: 0.1 },
  quickBtn: {
    width:           36,
    height:          36,
    borderRadius:    18,
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: 'rgba(255,122,60,0.10)',
    borderWidth:     1,
    borderColor:     'rgba(255,122,60,0.30)',
  },
  quickBtnAcceptIn: {
    backgroundColor: '#FF7A3C',
    borderColor:     '#FF7A3C',
  },

  // Participants row - always shown for non-owners so the Accept button
  // has a permanent home; for owners only when somebody else accepted.
  participantsRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  participantsInfo: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    minWidth: 0,
  },
  membersLabel: { fontSize: FontSizes.sm, color: Colors.muted, fontWeight: '600' },
  participantsEmpty: { fontSize: FontSizes.sm, color: Colors.muted, fontWeight: '500' },

  // Labeled Accept button - full-width when nobody has taken on yet (replaces
  // the old "Be the first to accept" + tiny + duo) and compact when there are
  // already acceptors (sits to the right of the avatars).
  acceptCtaFull: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md, paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,122,60,0.10)',
    borderWidth: 1, borderColor: 'rgba(255,122,60,0.35)',
  },
  acceptCtaFullText: {
    color: '#FF7A3C', fontWeight: '800', fontSize: FontSizes.sm,
  },
  acceptCompact: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,122,60,0.10)',
    borderWidth: 1, borderColor: 'rgba(255,122,60,0.30)',
  },
  acceptCompactText: {
    color: '#FF7A3C', fontWeight: '700', fontSize: FontSizes.xs ?? 12,
  },

  // Inline thread chat
  chatList:         { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: Spacing.md, gap: 4 },
  loadingOlderWrap: { paddingVertical: Spacing.md, alignItems: 'center' },
  emptyChat:        { paddingVertical: 60, alignItems: 'center', gap: 8 },
  emptyChatEmoji:   { fontSize: 36 },
  emptyChatText:    { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center', paddingHorizontal: Spacing.lg },

  // Locked state - shown to visitors / creators with no acceptances yet.
  // Centered card-like block in the middle of the empty area below the
  // participants row.
  lockedWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: Spacing.xl, gap: 10,
  },
  lockedEmoji: { fontSize: 40, opacity: 0.7 },
  lockedTitle: { fontSize: FontSizes.md, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  lockedBody:  { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center', maxWidth: 320 },

  // Join-the-channel CTA shown to non-participants in place of the chat.
  joinCta: {
    marginTop:       Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical:   Spacing.sm + 2,
    borderRadius:      Radius.full,
    backgroundColor:   '#FF7A3C',
  },
  joinCtaText: {
    color:      '#1a0f00',
    fontSize:   FontSizes.md,
    fontWeight: '800',
  },

  // Manage / proof-spec modal - bottom-sheet style with backdrop. Reuses
  // the same shape as the existing MembersSheet (handle + header) but
  // simpler: stacked rows.
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  manageSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: Colors.bg2,
    borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.sm,
  },
  manageTitle: {
    fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text,
    marginBottom: Spacing.sm,
  },
  manageRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm + 2,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  manageRowDanger: { backgroundColor: 'rgba(252,165,165,0.06)' },
  manageRowText:   { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
  proofSpecBody:   {
    fontSize: FontSizes.sm, lineHeight: FontSizes.sm * 1.5,
    color: Colors.text,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm + 2,
    backgroundColor:   'rgba(255,255,255,0.04)',
    borderRadius:      Radius.md,
  },

  // PR5 - creator's review banner inside the locked state. Inline Reject /
  // Accept buttons let the creator triage without leaving the challenge page.
  takeonReviewActions: {
    flexDirection: 'row',
    gap:           Spacing.sm,
    marginTop:     Spacing.md,
  },
  takeonRejectBtn: {
    paddingHorizontal: 16,
    paddingVertical:   10,
    borderRadius:      999,
    backgroundColor:   'rgba(255,255,255,0.06)',
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.12)',
  },
  takeonRejectText: { color: Colors.muted, fontSize: FontSizes.sm, fontWeight: '700' },
  takeonAcceptBtn: {
    paddingHorizontal: 16,
    paddingVertical:   10,
    borderRadius:      999,
    backgroundColor:   '#FF7A3C',
    borderWidth:       1,
    borderColor:       '#FF7A3C',
  },
  takeonAcceptText: { color: '#fff', fontSize: FontSizes.sm, fontWeight: '800' },
});
