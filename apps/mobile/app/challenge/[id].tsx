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
// stays mounted and its tab bar overlaps the screen's bottom edge — we need
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
  setChallengeCloseToJoins, setChallengeVisibility,
} from '@/api/challenges';
import { AttendeeAvatars } from '@/components/AttendeeAvatars';
import { ChallengePipeline } from '@/features/challenge/ChallengePipeline';
import { ScoringInfoButton } from '@/components/ScoringInfoButton';
import { ThreadScheduleBlock } from '@/features/challenge/ThreadScheduleBlock';
import { DatePickerModal } from '@/features/challenge/DatePickerModal';
import { ChallengeProofBlock, type ChallengeProofBlockHandle } from '@/features/challenge/ChallengeProofBlock';
import { ChallengeNotificationPill } from '@/features/challenge/ChallengeNotificationPill';
import { ChallengeChannelMembersStrip } from '@/features/challenge/ChallengeChannelMembersStrip';
import { countryToFlag } from '@/lib/countryFlag';
import { proposeDate as proposeDateApi, approveTakeOn, rejectTakeOn } from '@/api/challenges';
import { ChallengeChannelMembersSheet } from '@/features/challenge/ChallengeChannelMembersSheet';
import { ChallengePostCreateSheet } from '@/components/ChallengePostCreateSheet';
import { useMessages } from '@/hooks/useMessages';
import { ChatMessage } from '@/features/chat/ChatMessage';
import { ChatInput } from '@/features/chat/ChatInput';
import { avatarColor } from '@/lib/avatarColors';
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
  // PR2/3/4 — if I have an acceptance on this challenge, store the full
  // summary so the lifecycle pipeline can render my current phase + the
  // Accept button can morph into "Open thread →".
  const [myAcceptance, setMyAcceptance] = useState<ChallengeThreadSummary | null>(null);

  // PR18 — once an acceptance is terminal (approved = both rated and the
  // mutual debrief landed, rejected = creator turned the take-on down)
  // the challenge has returned to "available" globally. From the user's
  // POV we should unlock the detail screen: drop the locked "Mission
  // accomplished" pipeline, re-show the Take-on CTA, allow them to
  // re-engage. Chat history stays — they're still a channel participant
  // (iAmParticipant gates on membership, not on acceptance state).
  // Re-accepting creates a new acceptance row; score_events.UNIQUE
  // prevents double-earning points on the same (user, challenge, role).
  const activeAcceptance = (myAcceptance &&
    (myAcceptance.phase === 'approved' || myAcceptance.phase === 'rejected'))
    ? null
    : myAcceptance;

  // Participation gate (the channel is now members-only). null = still
  // loading, false = visitor sees public detail page only, true = visitor
  // sees the full chat. Resolves via a single GET /participants/me probe.
  const [iAmParticipant, setIAmParticipant] = useState<boolean | null>(null);
  const [joiningChannel, setJoiningChannel] = useState(false);
  // Picker for the FIRST proposal (no existing proposal yet). Counter-propose
  // has its own picker inside ThreadScheduleBlock; this one is reached from
  // the pipeline's "Propose a date →" sub-CTA so we don't double up.
  const [pickerOpen, setPickerOpen] = useState(false);

  // Owner check — two paths, mutually exclusive:
  //   1. Challenge has a registered creator → ownership is decided STRICTLY
  //      by account.id. The challenge's guest_id is incidental (it captures
  //      whichever guest session backed the creator's signup) and must NOT
  //      be used as an ownership signal — the same guest_id can persist
  //      across signup/logout on a device, which would otherwise let a
  //      second account on that device falsely "own" the first's challenge.
  //   2. Challenge has NO registered creator (pure guest creation) →
  //      ownership is decided by guest_id, the only identifier on file.
  const isOwner = !!(
    challenge?.created_by != null
      ? (account?.id && account.id === challenge.created_by)
      : (identity?.guestId && challenge?.guest_id && identity.guestId === challenge.guest_id)
  );

  // "Am I currently a participant?" — derived from the participant list.
  const isParticipant = !!(
    (account?.id   && participants.some(p => p.id === account.id)) ||
    (identity?.guestId && participants.some(p => p.id === identity.guestId))
  );

  // Target city — only meaningful for International challenges. For Local
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

  // Probe whether I already have an acceptance for this challenge — drives
  // the Accept (+) button morph AND the lifecycle pipeline below.
  //
  // The backend stamps exactly one row per (challenge, viewer) with
  // `is_primary_for_challenge=true`, using a deterministic "most actionable
  // first" priority. That's the source of truth — no client-side priority
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
        // International fields — empty string when the challenge is Local so
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

  // Owner-only "Manage challenge" modal — opens from the inline pill in
  // the meta row. Bundles Edit / Close (lifecycle) / Delete.
  const [manageOpen, setManageOpen] = useState(false);
  // International proof-spec popin — tapping the pipeline's "Waiting for
  // the proof" pill opens this read-only sheet.
  const [proofSpecOpen, setProofSpecOpen] = useState(false);
  // Imperative handle into ChallengeProofBlock so the pipeline's "Submit
  // your proof →" sub-CTA can trigger the photo picker + GPS + upload
  // flow directly. Replaces the standalone big button that used to live
  // inside the proof block.
  const proofRef = useRef<ChallengeProofBlockHandle>(null);

  // Creator-only visibility flip (Public ↔ Friends). Private isn't
  // reachable here — that's the mutual go-private flow. International
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
  // Unified visibility picker — Public / Friends / Private. Private maps
  // to closed_to_new_joins=true; Public / Friends clear that flag and
  // align the visibility column.
  const [visMenuOpen, setVisMenuOpen] = useState(false);
  // Channel-header details (second pill row + pipeline + proof + members
  // strip) collapse behind a chevron next to the share pill — frees
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
      if (choice === 'private') {
        if (!challenge.closed_to_new_joins) {
          setCloseBusy(true);
          await setChallengeCloseToJoins(id, true);
          setChallenge(prev => prev ? { ...prev, closed_to_new_joins: true } : prev);
          setCloseBusy(false);
        }
        return;
      }
      if (challenge.closed_to_new_joins) {
        setCloseBusy(true);
        await setChallengeCloseToJoins(id, false);
        setChallenge(prev => prev ? { ...prev, closed_to_new_joins: false } : prev);
        setCloseBusy(false);
      }
      if ((challenge.visibility ?? 'public') !== choice) {
        setVisBusy(true);
        await setChallengeVisibility(id, choice);
        setChallenge(prev => prev ? { ...prev, visibility: choice } : prev);
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

  // Share — uses the shared shareLink helper so Android gets URL-only in
  // `message` (Intent.EXTRA_TEXT) while iOS gets the three fields separate.
  // Available to everyone (creator + participants + drive-by visitors), even
  // when the challenge is validated — sharing an archived défi is fine.
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
      // user cancelled or share failed — no-op
    }
  }, [challenge, t]);

  /**
   * PR2 — take-on flow.
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

    // Already actively accepted? No-op — the inline chat is right here.
    // A terminal myAcceptance (approved/rejected) does NOT block: the user
    // is re-engaging with a completed challenge; the new row coexists with
    // the old, and score_events.UNIQUE keeps points from re-firing.
    if (activeAcceptance) return;

    // Guest? Send them to register first.
    if (!account?.id) {
      router.push('/auth-gate?reason=accept_challenge' as never);
      return;
    }

    setAcceptBusy(true);
    try {
      await acceptChallenge(id);
      // Refresh the full summary — the pipeline flips to "Date" and the inline
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

  // PR2 — refresh acceptance state when someone takes on or cancels this
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

  // PR3/4/5 — refresh on date/verdict/take-on-review pushes. Schedule block
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

  const loadMessagesFn = useCallback(
    (opts?: { beforeId?: string }) =>
      id && iAmParticipant === true
        ? fetchChallengeMessages(id, opts)
        : Promise.resolve({ messages: [], hasMore: false }),
    [id, iAmParticipant],
  );
  const postTextFn = useCallback(
    (content: string): Promise<Message> =>
      id && account?.id
        ? sendChallengeMessage(id, account.id, nicknameForChat || 'You', content)
        : Promise.reject(new Error('No challenge channel')),
    [id, account?.id, nicknameForChat],
  );
  const postImageFn = useCallback(
    (imageUrl: string): Promise<Message> =>
      id && account?.id
        ? sendChallengeImageMessage(id, account.id, nicknameForChat || 'You', imageUrl)
        : Promise.reject(new Error('No challenge channel')),
    [id, account?.id, nicknameForChat],
  );

  const { messages, loading: msgsLoading, loadingOlder, hasMore, sending,
          sendText, sendImage, loadOlder, reload } = useMessages({
    channelId: id ?? '__no_challenge__',
    loadFn:    loadMessagesFn,
    postTextFn,
    postImageFn,
  });

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

  // Join the challenge channel's WS room for live newMessage broadcasts.
  // Only join once we're a confirmed participant — non-participants don't
  // need the firehose. Leaves on unmount / challenge change.
  useEffect(() => {
    if (!id || !sessionId || iAmParticipant !== true) return;
    socket.joinChallenge(id, sessionId);
    return () => socket.leaveChallenge(id, sessionId);
  }, [id, iAmParticipant, sessionId]);

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
    } catch { /* silent — re-probe on next visit */ }
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
  // violation — first render (challengeLoading=true) returns before reaching
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

  // 1:1 gate — `inProgress` is true when the challenge has a non-terminal
  // acceptance owned by someone else. Visitors don't see the Accept button
  // (and see the in-progress locked state); the owner / current taker are
  // unaffected because they already have their own acceptance row. Uses
  // `activeAcceptance` (defined near the top — terminal acceptances treated
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
  //     trigger — user can scroll back to top to expand)
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
  const onChatScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    collapseTo(e.nativeEvent.contentOffset.y > 30 ? 1 : 0);
  }, [collapseTo]);
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
      {/* Nav — web parity: back pill | centered title | large type emoji on
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
              {/* Notifications pill — joined participants only. Lives next
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

      {/* Collapsible region — badges, pipeline, owner actions, challenger row
          and participants row all live here. Shrinks to 0 (maxHeight + opacity
          interpolation) when the chat is scrolled into older messages OR the
          composer is focused. Mirrors the event channel collapse so the
          conversation gets vertical space when it matters. */}
      <Animated.View style={{ maxHeight: collapsibleMaxHeight, opacity: collapsibleOpacity, overflow: 'hidden' }}>
      {/* Hero — type badge + audience pill + status pill (3rd on the same row
          to save vertical space). The status pill is THE source of truth for
          the challenge's state and is visible to EVERYONE. Owner taps it to
          toggle (open ⇄ validated); non-owners see it as a read-only status. */}
      <View style={styles.hero}>
        <View style={styles.badgeRow}>
          <View style={styles.kindBadge}>
            <Text style={styles.kindBadgeText}>{t(`typeBadge.${challenge.challenge_type}`).toUpperCase()}</Text>
          </View>
          {/* Audience / mode pill — Local rows get the audience target
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
          {/* Share — distinct violet tint so it doesn't blur in with the
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
          {/* Collapse chevron — toggles all the details below (visibility
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

        {/* Collapsible details — everything below the always-visible badge
            row. Conditional render + LayoutAnimation gives the slide-up
            collapse without a heavy Reanimated dep. */}
        {detailsOpen && (
        <View style={styles.detailsBlock}>
        <View style={[styles.hero, { paddingTop: 0 }]}>
        {/* Same badgeRow shape as the top row above so the pills sit on a
            wrapping row at their natural width instead of stretching to
            full container width inside the column-laid hero. */}
        <View style={styles.badgeRow}>
          {/* Leave the channel — joined participants who aren't the creator
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
          {/* Visibility dropdown — Public / Friends / Private. Private folds
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
          {/* Manage challenge — creator-only pill. Opens a modal with
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
          {/* Close-to-new-joins pill removed — Private inside the
              visibility dropdown above maps to closed_to_new_joins. */}
        </View>
        </View>

        {/* Scoring info — small (i) button right-aligned just above the
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
          mode={challenge.mode ?? 'local'}
          onPress={(() => {
            if ((challenge.mode ?? 'local') === 'local'
                && myAcceptance && !myAcceptance.proposed_starts_at && myAcceptance.phase === 'accepted') {
              return () => setPickerOpen(true);
            }
            if ((challenge.mode ?? 'local') === 'international' && myAcceptance && !isOwner) {
              // Acceptor with an active acceptance — tapping the pipeline's
              // "Submit your proof →" sub-CTA fires the photo picker + GPS
              // + upload via the ChallengeProofBlock's imperative handle.
              return () => proofRef.current?.submit();
            }
            if ((challenge.mode ?? 'local') === 'international' && challenge.proof_requirements) {
              // Creator (no submit action) — still useful to surface the
              // requirements popin so they can re-read what they asked for.
              return () => setProofSpecOpen(true);
            }
            return undefined;
          })()}
        />

        {/* International — proof submission + verdict block. Renders only
            when there's an acceptance to act on; visitors and creators-
            without-acceptance see no extra surface here (the pipeline
            educates them passively). */}
        {(challenge.mode ?? 'local') === 'international' && myAcceptance && (
          <ChallengeProofBlock
            ref={proofRef}
            acceptanceId={myAcceptance.id}
            iAmCreator={isOwner}
            iAmAcceptor={!isOwner}
            proofRequirements={challenge.proof_requirements ?? null}
          />
        )}

        {/* Channel members strip — mounted directly under the pipeline /
            proof block. Tap opens the full members sheet. */}
        {iAmParticipant === true && (
          <ChallengeChannelMembersStrip
            challenge={challenge}
            activeTaker={otherParticipants[0] ?? null}
            onOpen={() => setMembersOpen(true)}
          />
        )}
        </View>
        )}{/* /detailsOpen */}

        {/* Owner re-invite CTA — only while the challenge is genuinely free.
            Opens the same "seed it" sheet shown right after creation, so the
            creator can ping more city members + re-share at any later moment.
            Hidden once the challenge is in-progress or validated (the slot is
            no longer available, no point inviting). */}
        {isOwner && !isValidated && !challenge.is_in_progress && (
          <TouchableOpacity
            style={styles.ownerInviteCta}
            onPress={() => setPostCreateOpen(true)}
            activeOpacity={0.85}
            accessibilityLabel={t('postCreate.ctaInvite', { city: inviteCityName ?? t('postCreate.thisCity') })}
          >
            <Text style={styles.ownerInviteCtaIcon}>⚡</Text>
            <Text style={styles.ownerInviteCtaText} numberOfLines={1}>
              {t('postCreate.ctaInvite', { city: inviteCityName ?? t('postCreate.thisCity') })}
            </Text>
          </TouchableOpacity>
        )}

        {/* Edit / Close challenge / Delete moved into the Manage modal
            opened from the inline pill in the meta row. */}

      </View>

      {/* Challenger — the originating user. Tap opens their profile.
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

      {/* Participants row — three layouts:
            A) acceptors exist → avatars + count on the left, accept button on
               the right (icon + label when the viewer can still take on).
            B) no acceptors, viewer can take on → full-width prominent labeled
               button (replaces the old "Be the first to accept" + small + duo).
            C) full → "Challenge full" label, no button.
          Skipped entirely for owners on a validated challenge (nothing to do). */}
      {/* Lifecycle-state row (was "Participants · N" + accept-pill row).
          Legacy avatar strip dropped — the channel-members strip above
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
        // PR18 — gate "Currently being taken by X" on challenge.is_in_progress
        // (server-derived: a non-terminal acceptance EXISTS) rather than on
        // otherParticipants.length, so a previously-completed challenge
        // (terminal acceptance still in the participants list) no longer
        // reads as "in progress" — the slot is genuinely free.
        if (challenge?.is_in_progress && !isValidated && !isOwner && !activeAcceptance) {
          return (
            <View style={styles.participantsRow}>
              <Text style={styles.participantsEmpty} numberOfLines={1}>
                {t('cta.takenBy', { name: otherParticipants[0]?.displayName ?? '—' })}
              </Text>
            </View>
          );
        }
        // PR18 — show the Take-on CTA whenever the slot is open + viewer is
        // not the owner + challenge not closed. Replaces the
        // "otherParticipants.length === 0" guard which kept a terminal user
        // (whose row is still in participants) locked at "Mission
        // accomplished" — the bug the user reported.
        if (!isOwner && !isValidated && !challenge?.is_in_progress) {
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
          challenge — acceptors see their own thread, creators see their
          most-recently-active acceptor's thread (server-ordered).
          paddingBottom keeps the composer above the (tabs) bar that overlaps
          this route's bottom edge (Expo Router quirk: parent tab bar isn't
          unmounted when child routes are pushed). When this screen is reached
          via a non-tabs path, tabBarHeight=0 — no dead space. */}
      <KeyboardAvoidingView
        style={[styles.flex, { paddingBottom: tabBarHeight || insets.bottom }]}
        behavior="padding"
      >
        {iAmParticipant === true && (!myAcceptance || (myAcceptance.phase !== 'pending' && myAcceptance.phase !== 'rejected')) ? (
          <>
            <FlatList
              /* Filter out type='event' messages — they were auto-injected by
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
                // PR9 — challenger / taker pill next to the nickname (web parity).
                // Heuristic matches ChallengeChatPage.jsx: first non-creator
                // channel participant = active taker.
                // PR23 — anyone else with a userId who posts in the channel
                // is a Spectator (channel joiner without an active acceptance).
                // Anonymous posters (no userId) get no badge.
                const senderId = item.userId ?? null;
                const roleBadge: 'challenger' | 'taker' | 'spectator' | null =
                    !senderId
                      ? null
                      : (challenge.created_by && senderId === challenge.created_by)
                          ? 'challenger'
                          : (otherParticipants[0]?.id && senderId === otherParticipants[0].id)
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
                  <Text style={styles.emptyChatText}>{t('thread.empty')}</Text>
                </View>
              ) : null}
            />

            {/* Schedule band — Local-only AND only for the creator + ACTIVE
                taker. Uses activeAcceptance so a previously-completed user
                doesn't see a stale "proposed at HH:MM" from their old
                approved row — the slot is open again, the schedule belongs
                to whoever takes it next. */}
            {(challenge.mode ?? 'local') === 'local' && activeAcceptance && account?.id && (
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
              onSendText={(text) => sendText(text, null)}
              onSendImage={sendImage}
            />
          </>
        ) : (
          /* Non-chat surface. Branches (in priority order):
             - iAmParticipant === false → Join CTA (the channel is gated)
             - Creator + pending acceptance → review banner with accept/reject
             - Acceptor + pending           → "Waiting for review"
             - Acceptor + rejected          → "Your take-on was declined" */
          (() => {
            // Non-participant — show the Join CTA in place of the chat.
            // Hide while iAmParticipant is still null (probe in flight) to
            // avoid a brief flash of the visitor surface.
            if (iAmParticipant === false) {
              return (
                <View style={styles.lockedWrap}>
                  <Text style={styles.lockedEmoji}>🔓</Text>
                  <Text style={styles.lockedTitle}>{t('join.gateTitle')}</Text>
                  <Text style={styles.lockedBody}>
                    {t('join.gateBody', { count: otherParticipants.length })}
                  </Text>
                  <TouchableOpacity
                    style={styles.joinCta}
                    onPress={handleJoinChannel}
                    disabled={joiningChannel}
                    activeOpacity={0.85}
                  >
                    {joiningChannel
                      ? <ActivityIndicator color="#1a0f00" size="small" />
                      : <Text style={styles.joinCtaText}>{t('join.cta')}</Text>}
                  </TouchableOpacity>
                </View>
              );
            }

            const isPending  = myAcceptance?.phase === 'pending';
            const isRejected = myAcceptance?.phase === 'rejected';

            // Creator side — a pending request awaiting their review. Inline
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

            // Acceptor — pending / rejected states.
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

            // Default — visitor (available) or empty-creator state.
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

      {/* Date picker — opened by the pipeline's "Propose a date →" sub-CTA. */}
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

      {/* Channel members sheet — synthesizes Challenger + Taker rows
          at the head from the challenge/acceptance context, then lists
          joined participants. Kick button surfaces for creator +
          active taker (server enforces too). */}
      {challenge && (
        <ChallengeChannelMembersSheet
          visible={membersOpen}
          challenge={challenge}
          activeTaker={otherParticipants[0] ?? null}
          currentUserId={account?.id ?? null}
          isCreator={isOwner}
          isActiveTaker={!!myAcceptance && !myAcceptance.i_am_creator}
          onClose={() => setMembersOpen(false)}
          onSelect={(uid) => {
            setMembersOpen(false);
            router.push({ pathname: '/user/[id]', params: { id: uid } });
          }}
          onMembersChanged={() => loadParticipants()}
        />
      )}

      {/* Manage challenge modal — Edit / Close / Delete bundled. */}
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

      {/* Proof-spec popin — read-only sheet showing what the creator asked
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

      {/* Visibility picker — Public / Friends / Private dropdown. */}
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

      {/* Post-create "seed it" sheet — first opens with two CTAs (invite city
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  flex:      { flex: 1 },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: FontSizes.md, color: Colors.red, padding: Spacing.md, textAlign: 'center' },

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

  // Violet tint — see ChallengeCard for the rationale (distinct from
  // orange brand + green validated, the other pills on the same row).
  audiencePill: {
    backgroundColor:   'rgba(139,92,246,0.12)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8, paddingVertical: 2,
    borderWidth:       1, borderColor: 'rgba(139,92,246,0.32)',
  },
  audiencePillText: { fontSize: 11, fontWeight: '700', color: '#A78BFA', letterSpacing: 0.3 },

  // International chip — cyan, distinct from audience violet so Local vs
  // Intl reads at a glance (mirrors the NOW-card pattern from step 8).
  intlPill: {
    backgroundColor:   'rgba(56,189,248,0.12)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8, paddingVertical: 2,
    borderWidth:       1, borderColor: 'rgba(56,189,248,0.36)',
    flexShrink:        1,
  },
  intlPillText: { fontSize: 11, fontWeight: '700', color: '#38bdf8', letterSpacing: 0.3 },

  // Share inline pill — same height/padding as the kind + audience pills so
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

  // Share gets its own violet tint — distinct from the orange admin
  // pills (Manage / Leave / Visibility-public-default).
  sharePillInlineShare: {
    backgroundColor: 'rgba(167,139,250,0.10)',
    borderColor:     'rgba(167,139,250,0.35)',
  },
  sharePillInlineShareText: { color: '#c4b5fd' },

  // Collapse chevron at the far right of badgeRow — toggles the channel-
  // header details (second pill row + pipeline + proof + members strip).
  // marginLeft:'auto' floats it right so the role reads as "fold what's
  // below", not as another inline pill.
  detailsToggle: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
    marginLeft: 'auto',
  },

  // Detail block — wraps the collapsible content below the always-visible
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

  // Visibility pill tints — applied to BOTH the TouchableOpacity (for
  // background + borderColor) and the inner Text (for color). Split into
  // pill/text objects so the View vs Text types stay clean.
  visibilityPillPublic:      { backgroundColor: 'rgba(255,122,60,0.10)', borderColor: 'rgba(255,122,60,0.30)' },
  visibilityPillFriends:     { backgroundColor: 'rgba(147,197,253,0.10)', borderColor: 'rgba(147,197,253,0.30)' },
  visibilityPillPrivate:     { backgroundColor: 'rgba(252,165,165,0.10)', borderColor: 'rgba(252,165,165,0.30)' },
  visibilityPillTextPublic:  { color: '#FFB37A' },
  visibilityPillTextFriends: { color: '#93c5fd' },
  visibilityPillTextPrivate: { color: '#fca5a5' },

  // Close-to-new-joins pill — on-state retints to a deeper orange so the
  // creator can see at a glance whether the channel is locked.
  closedPillOn: {
    backgroundColor: 'rgba(255,122,60,0.20)',
    borderColor:     'rgba(255,122,60,0.55)',
  },

  // (Old status-pill styles removed — the ChallengePipeline component owns
  // the lifecycle visual now. The close-challenge action moved to the
  // owner-secondary row as a small ghost button.)

  // Secondary housekeeping row — icon + small label, ghost styling so the
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

  // Primary owner CTA — "Send it to someone in {city}". Cyan rather than
  // orange so it visually separates from the share pill above (which IS
  // orange — both stacked oranges read as the same call repeated). Cyan
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

  // Challenger row — the creator, distinguished from regular participants
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

  // Inline quick-action group — Share is a labeled pill (verb is the
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

  // Participants row — always shown for non-owners so the Accept button
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

  // Labeled Accept button — full-width when nobody has taken on yet (replaces
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

  // Locked state — shown to visitors / creators with no acceptances yet.
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

  // Manage / proof-spec modal — bottom-sheet style with backdrop. Reuses
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

  // PR5 — creator's review banner inside the locked state. Inline Reject /
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
