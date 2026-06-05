import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ActivityIndicator, Animated,
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
  fetchThreadMessages, sendThreadMessage, sendThreadImageMessage,
} from '@/api/challenges';
import { AttendeeAvatars } from '@/components/AttendeeAvatars';
import { ChallengePipeline } from '@/features/challenge/ChallengePipeline';
import { ThreadScheduleBlock } from '@/features/challenge/ThreadScheduleBlock';
import { DatePickerModal } from '@/features/challenge/DatePickerModal';
import { proposeDate as proposeDateApi, approveTakeOn, rejectTakeOn } from '@/api/challenges';
import { MembersSheet } from '@/components/MembersSheet';
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
  const myThreadChannelId = myAcceptance?.thread_channel_id ?? null;
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

  const loadChallenge = useCallback(() => {
    if (!id) return;
    fetchChallengeById(id)
      .then(({ challenge: c, channelId, cityName }) => {
        setChallenge(c);
        setChallengeCityName(cityName);
        setChallengeCityChannel(channelId != null ? String(channelId) : null);
      })
      .catch(() => setChallenge(null))
      .finally(() => setChallengeLoading(false));
  }, [id]);

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
        editId:          challenge.id,
        title:           challenge.title,
        type:            challenge.challenge_type,
        audience:        challenge.audience,
        returnClause:    challenge.return_clause ?? '',
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

    // Already accepted? No-op — the inline chat is right here.
    if (myThreadChannelId) return;

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
  }, [id, account?.id, acceptBusy, myThreadChannelId, loadMyAcceptance, router, t]);

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

  // ── Inline thread chat ───────────────────────────────────────────────────
  // The chat below is the per-acceptance THREAD chat (channels.type=
  // 'challenge_thread'), folded into the challenge channel surface so users
  // see + use one screen. `myAcceptance` is the viewer's thread on this
  // challenge — for acceptors that's their relationship with the creator;
  // for creators with N acceptances /me/acceptances returns the most-recently-
  // active one (server ORDER BY last_message_at DESC) — good default.
  const threadChannelId = myThreadChannelId;

  const loadMessagesFn = useCallback(
    (opts?: { beforeId?: string }) =>
      threadChannelId
        ? fetchThreadMessages(threadChannelId, opts)
        : Promise.resolve({ messages: [], hasMore: false }),
    [threadChannelId],
  );
  const postTextFn = useCallback(
    (content: string): Promise<Message> =>
      threadChannelId
        ? sendThreadMessage(threadChannelId, content)
        : Promise.reject(new Error('No thread')),
    [threadChannelId],
  );
  const postImageFn = useCallback(
    (imageUrl: string): Promise<Message> =>
      threadChannelId
        ? sendThreadImageMessage(threadChannelId, imageUrl)
        : Promise.reject(new Error('No thread')),
    [threadChannelId],
  );

  const { messages, loading: msgsLoading, loadingOlder, hasMore, sending,
          sendText, sendImage, loadOlder } = useMessages({
    channelId: threadChannelId ?? '__no_thread__',
    loadFn:    loadMessagesFn,
    postTextFn,
    postImageFn,
  });

  // Join the thread WS room (for live newMessage broadcasts) only when we
  // actually have a thread to join. Leaves on unmount / thread change.
  useEffect(() => {
    if (!threadChannelId || !sessionId) return;
    socket.joinChallengeThread(threadChannelId, sessionId);
    return () => socket.leaveChallengeThread(threadChannelId, sessionId);
  }, [threadChannelId, sessionId]);

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
  // unaffected because they already have their own acceptance row.
  const inProgress = !!(
    challenge?.is_in_progress &&
    !isOwner &&
    !myAcceptance
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
          <View style={styles.audiencePill}>
            <Text style={styles.audiencePillText}>{audienceLabel[challenge.audience]}</Text>
          </View>
          {/* Share — always visible. Previously lived in the challenger row,
              which was hidden when there were no acceptors (1:1 model =
              no participants until someone takes on), so the CTA disappeared
              entirely. Placing it next to the audience pill keeps it on the
              page at every lifecycle stage. */}
          <TouchableOpacity
            style={styles.sharePillInline}
            onPress={handleShare}
            activeOpacity={0.75}
            accessibilityLabel={t('shareCta')}
          >
            <Ionicons name="share-social-outline" size={14} color="#FF7A3C" />
            <Text style={styles.sharePillInlineText} numberOfLines={1}>{t('shareCta')}</Text>
          </TouchableOpacity>
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
          acceptance={myAcceptance}
          iAmCreator={isOwner}
          onPress={
            myAcceptance && !myAcceptance.proposed_starts_at && myAcceptance.phase === 'accepted'
              ? () => setPickerOpen(true)
              : undefined
          }
        />

        {isOwner && (
          <View style={styles.ownerSecondaryRow}>
            <TouchableOpacity style={styles.ownerIconBtn} onPress={handleEdit} activeOpacity={0.75} accessibilityLabel={t('editTitle')}>
              <Ionicons name="create-outline" size={16} color={Colors.muted} />
              <Text style={styles.ownerIconLabel}>{t('editTitle')}</Text>
            </TouchableOpacity>
            {/* Close-challenge — moved here from the old PR2 status-pill toggle.
                Same /validate endpoint, just a smaller affordance now that the
                pipeline owns the visible lifecycle. Green check icon when
                already closed; tapping flips back. */}
            <TouchableOpacity
              style={styles.ownerIconBtn}
              onPress={handleToggleStatus}
              activeOpacity={0.75}
              disabled={validateBusy}
              accessibilityLabel={isValidated ? t('reopenCta') : t('closeCta')}
            >
              {validateBusy
                ? <ActivityIndicator size="small" color={Colors.muted} />
                : <Ionicons
                    name={isValidated ? 'checkmark-circle' : 'lock-closed-outline'}
                    size={16}
                    color={isValidated ? '#22c55e' : Colors.muted}
                  />}
              <Text style={[styles.ownerIconLabel, isValidated && { color: '#22c55e' }]}>
                {isValidated ? t('reopenCta') : t('closeCta')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.ownerIconBtn} onPress={handleDelete} activeOpacity={0.75} accessibilityLabel={t('deleteConfirm')}>
              <Ionicons name="trash-outline" size={16} color={Colors.muted} />
              <Text style={styles.ownerIconLabel}>{t('deleteConfirm')}</Text>
            </TouchableOpacity>
          </View>
        )}

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
      {(otherParticipants.length > 0 || (!isOwner && !isValidated)) && (
        <View style={styles.participantsRow}>
          {otherParticipants.length > 0 ? (
            <>
              <TouchableOpacity
                style={styles.participantsInfo}
                activeOpacity={0.75}
                onPress={() => setMembersOpen(true)}
              >
                <AttendeeAvatars
                  preview={otherParticipants.slice(0, 5).map(p => ({ id: p.id, displayName: p.displayName, thumbAvatarUrl: p.thumbAvatarUrl ?? p.avatarUrl }))}
                  total={otherParticipants.length}
                  borderColor={Colors.bg}
                />
                <Text style={styles.membersLabel}>
                  {t('participantsLabel')} · {otherParticipants.length}
                </Text>
              </TouchableOpacity>
              {!isOwner && !isValidated && !myThreadChannelId && !inProgress && (
                <TouchableOpacity
                  style={styles.acceptCompact}
                  onPress={handleAccept}
                  activeOpacity={0.7}
                  disabled={acceptBusy}
                  accessibilityLabel={t('acceptCta')}
                >
                  {acceptBusy
                    ? <ActivityIndicator color="#FF7A3C" size="small" />
                    : <>
                        <Ionicons name="add" size={18} color="#FF7A3C" />
                        <Text style={styles.acceptCompactText}>{t('pipeline.subcta.tapToAccept')}</Text>
                      </>}
                </TouchableOpacity>
              )}
            </>
          ) : inProgress ? (
            <Text style={styles.participantsEmpty}>⏳ {t('card.inProgress')}</Text>
          ) : (
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
          )}
        </View>
      )}
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
        {myAcceptance && account?.id && myAcceptance.phase !== 'pending' && myAcceptance.phase !== 'rejected' ? (
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
                return (
                  <ChatMessage
                    message={item}
                    myGuestId={identity?.guestId}
                    isGrouped={isGrouped}
                    showTime={showTime}
                    dateLabel={dateLabel}
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

            {/* Schedule band — handles propose-pending / approve / debrief /
                verdict states. The bare "Propose a date" empty state is
                suppressed (hideEmptyCta) because the pipeline sub-CTA above
                already says it and triggers the picker. */}
            <ThreadScheduleBlock
              thread={myAcceptance}
              myUserId={account.id}
              onChange={loadMyAcceptance}
              hideEmptyCta
            />

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
          /* Locked / pending / rejected state — chat is hidden. Branches:
             - Creator + pending acceptance → review banner with accept/reject buttons.
             - Acceptor + pending           → "Waiting for review" state.
             - Acceptor + rejected          → "Your take-on was declined" state.
             - Visitor + cap full           → "Challenge full" state.
             - Visitor + free slots         → "Take on the challenge" nudge.
             - Creator + no acceptances     → "Waiting for someone to take it on" state. */
          (() => {
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

      {/* Members modal — opened by tapping the participants row above. */}
      <MembersSheet
        visible={membersOpen}
        loading={false}
        participants={participants}
        count={participants.length}
        noun={t('createTitle')}
        onClose={() => setMembersOpen(false)}
        onSelect={(uid) => {
          setMembersOpen(false);
          router.push({ pathname: '/user/[id]', params: { id: uid } });
        }}
      />

      {/* Post-create "seed it" sheet — first opens with two CTAs (invite city
          members / share externally), then morphs into a multi-select picker. */}
      <ChallengePostCreateSheet
        visible={postCreateOpen}
        challenge={challenge}
        cityChannelId={challengeCityChannel}
        cityName={challengeCityName}
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
  navCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  navTitle:  { fontSize: FontSizes.md, fontWeight: '800', color: Colors.text, flexShrink: 1, textAlign: 'center' },
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
