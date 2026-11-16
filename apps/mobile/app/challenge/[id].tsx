import { thumbUrl } from '@/lib/imageThumb';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ActivityIndicator, Animated, Modal, LayoutAnimation,
  TouchableOpacity, StyleSheet, KeyboardAvoidingView, Alert, FlatList,
  Keyboard,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { IconButton } from '@/ui/IconButton';
import { useApp } from '@/context/AppContext';
import { socket } from '@/lib/socket';
import {
  fetchChallengeById, fetchChallengeParticipants,
  validateChallenge, unvalidateChallenge, deleteChallenge,
  acceptChallenge, fetchMyAcceptances, AcceptChallengeError,
  fetchChallengeMessages, sendChallengeMessage, sendChallengeImageMessage,
  fetchMyChallengeParticipation, leaveChallengeChannel,
  setChallengeVisibility, toggleChallengeReaction,
  relaunchChallenge, validatePresence,
} from '@/api/challenges';
import { ValidatePresenceSheet } from '@/features/challenge/ValidatePresenceSheet';
import { GroupSubmissionsGallery } from '@/features/challenge/GroupSubmissionsGallery';
import { MessageActionSheet } from '@/features/chat/MessageActionSheet';
import { CopyTranslateText } from '@/features/chat/CopyTranslateText';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { reactionEmitter, EMOJI_TO_TYPE } from '@/lib/reactionEmitter';
import i18n from '@/i18n';
import { CampaignCelebration } from '@/features/challenge/CampaignCelebration';
import { ChallengeProofBlock } from '@/features/challenge/ChallengeProofBlock';
import { ChallengeNotificationPill } from '@/features/challenge/ChallengeNotificationPill';
import { ChallengeChannelMembersStrip } from '@/features/challenge/ChallengeChannelMembersStrip';
import { countryToFlag } from '@/lib/countryFlag';
import { ChallengeChannelMembersSheet } from '@/features/challenge/ChallengeChannelMembersSheet';
import { ChallengePostCreateSheet } from '@/components/ChallengePostCreateSheet';
import { useMessages } from '@/hooks/useMessages';
import { ChatMessage } from '@/features/chat/ChatMessage';
import { ChatInput } from '@/features/chat/ChatInput';
import { ComposerEndedNotice } from '@/features/chat/ComposerEndedNotice';
import { avatarColor } from '@/lib/avatarColors';
import { canAccessProfile } from '@/lib/profileAccess';
import { shareLink } from '@/lib/shareLink';
import { ShareToCityPill } from '@/components/ShareToCityPill';
import { ShareToWorldPill } from '@/components/ShareToWorldPill';
import { isSameDay, formatDateLabel } from '@/lib/messageTime';
import { track } from '@/services/analytics';
import { Space, Border, FontSizes, Spacing, Radius, buildChallengeUrl, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import type { Challenge, ChallengeType, ChallengeThreadSummary, Message, UserDTO } from '@/types';
import { goBack } from '@/lib/nav';

// Outline icon per challenge type (V3: no emoji as chrome).
type IoniconName = keyof typeof Ionicons.glyphMap;
const TYPE_ICONS: Record<ChallengeType, IoniconName> = {
  food:    'restaurant-outline',
  place:   'location-outline',
  culture: 'color-palette-outline',
  help:    'happy-outline',
};

// Campaign celebration fires once per challenge per app session (so re-opening
// the same campaign doesn't re-confetti on every visit).
const celebratedCampaigns = new Set<string>();

export default function ChallengeChatScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const router = useRouter();
  const { t } = useTranslation('challenge');
  const { id, reviewProof } = useLocalSearchParams<{ id: string; reviewProof?: string }>();
  const { identity, account, sessionId } = useApp();
  const nickname = account?.display_name ?? identity?.nickname ?? '';

  const [challenge,        setChallenge]        = useState<Challenge | null>(null);
  const [challengeLoading, setChallengeLoading] = useState(true);
  // Campaign (2× points) arrival celebration - confetti + badge, once per session.
  const [showCampaignCelebration, setShowCampaignCelebration] = useState(false);
  useEffect(() => {
    if (challenge?.is_campaign && id && !celebratedCampaigns.has(id)) {
      celebratedCampaigns.add(id);
      setShowCampaignCelebration(true);
    }
  }, [challenge?.is_campaign, id]);
  // Carry these alongside the challenge so the post-create modal can fetch
  // city members and label them by city name without re-querying.
  const [challengeCityName,    setChallengeCityName]    = useState<string | null>(null);
  const [challengeCityChannel, setChallengeCityChannel] = useState<string | null>(null);
  // Invite sheet (city members / share), opened by the owner's invite CTA.
  const [postCreateOpen, setPostCreateOpen] = useState(false);
  const [participants,     setParticipants]     = useState<UserDTO[]>([]);
  const [membersOpen,      setMembersOpen]      = useState(false);
  const [validateBusy,     setValidateBusy]     = useState(false);
  // My acceptance on this challenge (group: joined / present / absent), if any.
  const [myAcceptance, setMyAcceptance] = useState<ChallengeThreadSummary | null>(null);

  // Participation gate. null = still loading, false = visitor with no
  // explicit join row, true = creator / active taker / explicit joiner.
  // Resolves via a single GET /participants/me probe.
  //
  // Note: this gate now applies ONLY to non-public challenges. Public
  // channels (visibility='public', the default) are open to anyone - the
  // conversation surface is part of the public detail page, no join
  // step. See challengeIsPublic below.
  const [iAmParticipant, setIAmParticipant] = useState<boolean | null>(null);
  // Wider than iAmParticipant: on a public challenge, chatting subscribes you
  // to the channel's pushes without any join row. Drives the notif pill so a
  // talker can mute what they now receive.
  const [iCanSubscribe, setICanSubscribe] = useState(false);

  // "How challenges work" carousel - same primitive the city chat
  // surfaces from its delayed feed prompt. Mounting it here too so a
  // user who lands straight on a challenge (deeplink, push, share) can
  // still learn the rules without backtracking. Banner appears 8 s
  // after entering the channel (matches city chat's t4 delay) and
  // sticks around until the user taps it or dismisses with ×; both
  // dispose it for the rest of this session.
  // Guest welcome banner - shown immediately (no 8 s delay) to anyone
  // landing on a public challenge without an account. Dismissed on ×
  // or after tapping into the auth-gate, per session. Replaces the
  // intro banner for that audience so they don't see two stacked
  // affordances on entry. Guests are by definition the audience for
  // the explicit "chat free / sign up to take it" message.
  const [showGuestWelcome, setShowGuestWelcome] = useState(true);

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

  // Public channels are open to anyone - guests included. The conversation
  // surface renders inline regardless of iAmParticipant. Only friends /
  // private fall back to the gated view (and there, the lock state
  // explains the channel is private). Defaulting to 'public' on a null
  // challenge means we never flash the locked surface during the initial
  // fetch - much safer than the reverse.
  const challengeIsPublic = (challenge?.visibility ?? 'public') === 'public';


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

  // ── Owner actions ───────────────────────────────────────────────────────────

  const handleDelete = useCallback(() => {
    if (!identity) return;
    Alert.alert(t('deleteTitle'), t('deleteBody'), [
      { text: t('cancel', { ns: 'common' }), style: 'cancel' },
      {
        text: t('deleteConfirm'), style: 'destructive',
        onPress: async () => {
          try {
            await deleteChallenge(id, identity.guestId);
            goBack();
          } catch {
            Alert.alert(t('errSave'));
          }
        },
      },
    ]);
  }, [id, identity, router, t]);


  // Creator relaunches an ENDED challenge: reopens with the SAME countdown it was
  // originally given (server recomputes the deadline). One tap, confirm first.
  const handleRelaunch = useCallback(() => {
    Alert.alert(
      t('relaunch.confirmTitle', { defaultValue: 'Restart this challenge?' }),
      t('relaunch.confirmBody', { defaultValue: 'It reopens with the same countdown you set the first time.' }),
      [
        { text: t('cancel', { ns: 'common' }), style: 'cancel' },
        {
          text: t('relaunch.confirmCta', { defaultValue: 'Restart' }),
          onPress: async () => {
            try {
              const res = await relaunchChallenge(id);
              if (res?.challenge) setChallenge(res.challenge);
              else loadChallenge();
            } catch {
              Alert.alert(t('relaunch.failed', { defaultValue: 'Could not restart' }));
            }
          },
        },
      ],
    );
  }, [id, t, loadChallenge]);

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
  // the meta row. Bundles Close (lifecycle) / Delete.
  const [manageOpen, setManageOpen] = useState(false);
  // Group-challenge UI state (Phase 4).
  const [joining,      setJoining]      = useState(false);
  const [validateOpen, setValidateOpen] = useState(false);
  // Bumped on proof-submitted / validated WS events so the group submissions
  // gallery re-fetches when someone else's photo (or the winner) lands.
  const [galleryTick,  setGalleryTick]  = useState(0);
  // Bumped to open the submissions gallery (e.g. proof-submitted push deep-link).
  const [gallerySignal, setGallerySignal] = useState(0);
  const [validating,   setValidating]   = useState(false);

  const reviewProofFiredRef = useRef(false);

  // Proof-review deep-link: a "📸 new proof" push routes here with ?reviewProof=1.
  // GROUP photo-proof → open the submissions gallery (pick-the-winner). Param is
  // stripped after so a back-nav / refresh doesn't re-open it. MUST stay in the
  // hooks section (before the loading early-return) - computing the group-photo
  // flag inline avoids a rules-of-hooks violation.
  useEffect(() => {
    if (reviewProof !== '1' || reviewProofFiredRef.current || !isOwner || !challenge) return;
    const groupPhoto = (challenge.challenge_format ?? 'legacy') === 'group'
      && ((challenge.validation_method ?? 'meet') === 'photo_proof' || (challenge.mode ?? 'local') === 'international');
    if (groupPhoto) {
      reviewProofFiredRef.current = true;
      setGallerySignal(s => s + 1);
      router.setParams({ reviewProof: undefined } as never);
    }
  }, [reviewProof, isOwner, challenge, router]);

  // Creator-only visibility picker state (see handlePickVisibility).
  const [visBusy, setVisBusy] = useState(false);
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
    if (visBusy || !challenge) return;
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
      setVisBusy(false);
      Alert.alert(t('errSave'));
    }
  }, [id, challenge, visBusy, t]);

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

  // ── Group challenge (Phase 4): join + validate presence ─────────────────────
  // Joining a group challenge reuses /accept (the backend branches on
  // challenge_format and does a no-approval group join + the +2 spark).
  const handleGroupJoin = useCallback(async () => {
    if (joining) return;
    if (!account?.id) {
      const returnTo = encodeURIComponent(`/challenge/${id}`);
      router.push(`/auth-gate?reason=join_challenge&returnTo=${returnTo}` as never);
      return;
    }
    setJoining(true);
    try {
      await acceptChallenge(id);
      await loadChallenge();
      loadMyAcceptance();
      loadParticipants();
    } catch (e) {
      const code = e instanceof AcceptChallengeError ? (e.code as string) : 'unknown';
      Alert.alert(
        code === 'closed_to_new_joins'
          ? t('group.closed', { defaultValue: 'Closed to new joins' })
          : t('group.joinFailed', { defaultValue: 'Could not join - try again.' }),
      );
    } finally {
      setJoining(false);
    }
  }, [joining, account?.id, id, router, t, loadChallenge, loadMyAcceptance, loadParticipants]);

  const handleValidatePresence = useCallback(async (presentIds: string[], rating: number | null) => {
    if (validating) return;
    setValidating(true);
    try {
      await validatePresence(id, presentIds, rating);
      setValidateOpen(false);
      await loadChallenge();
      loadParticipants();
    } catch (e) {
      Alert.alert(t('group.validateFailed', { defaultValue: 'Could not validate - try again.' }));
    } finally {
      setValidating(false);
    }
  }, [validating, id, t, loadChallenge, loadParticipants]);


  // Listen for WS status flips (validated ⇄ open) for this exact challenge
  // so the pill flips live when the creator toggles from another device.
  useEffect(() => {
    const onUpdate = (data: Record<string, unknown>) => {
      const ch = data.challenge as Challenge | undefined;
      if (ch?.id === id) setChallenge(ch);
    };
    const offV = socket.on('challenge_validated',   onUpdate);
    const offU = socket.on('challenge_unvalidated', onUpdate);
    // Owner edited the challenge (e.g. validation_method meet ⇄ photo_proof,
    // which swaps the whole pipeline) - refresh the row live, no reload needed.
    const offE = socket.on('challenge_updated',     onUpdate);
    return () => { offV(); offU(); offE(); };
  }, [id]);

  // Refresh acceptance state when someone joins this challenge (server pushes
  // to the creator's user-room + the joiner's user-room).
  useEffect(() => {
    const onAcceptanceChange = (data: Record<string, unknown>) => {
      const payload = data.payload as { challenge?: { id?: string }; challengeId?: string } | undefined;
      const eventChallengeId = payload?.challenge?.id ?? payload?.challengeId;
      if (eventChallengeId === id) { loadMyAcceptance(); loadParticipants(); }
    };
    const offA = socket.on('challenge_accepted',              onAcceptanceChange);
    return () => { offA(); };
  }, [id, loadMyAcceptance, loadParticipants]);

  // Photo proof submitted → refresh my acceptance and bump the group
  // submissions gallery so a new photo appears for everyone live. Winner
  // picked broadcasts 'challenge_validated' → refresh the gallery's crown too.
  useEffect(() => {
    const onProof = () => { loadMyAcceptance(); setGalleryTick(x => x + 1); };
    const off1 = socket.on('challenge_proof_submitted',   onProof);
    const off2 = socket.on('challenge_validated',         () => setGalleryTick(x => x + 1));
    return () => { off1(); off2(); };
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
  // (guestId, nickname) tuple - same model city channels use. Registered
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
  // Talking in a challenge channel subscribes you to it (backend fan-out
  // counts message senders), so flip the pill on locally the moment the first
  // message lands - no reload needed. Registered users only; guests get no push.
  const markSubscribed = useCallback(<T,>(msg: T): T => {
    if (account?.id) setICanSubscribe(true);
    return msg;
  }, [account?.id]);

  const postTextFn = useCallback(
    (content: string, replyToId?: string | null, mentions?: import('@/types').MentionRef[]): Promise<Message> =>
      id && senderId
        ? sendChallengeMessage(id, senderId, senderNickname, content, replyToId ?? null, mentions).then(markSubscribed)
        : Promise.reject(new Error('No challenge channel')),
    [id, senderId, senderNickname, markSubscribed],
  );
  const postImageFn = useCallback(
    (imageUrl: string): Promise<Message> =>
      id && senderId
        ? sendChallengeImageMessage(id, senderId, senderNickname, imageUrl).then(markSubscribed)
        : Promise.reject(new Error('No challenge channel')),
    [id, senderId, senderNickname, markSubscribed],
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

  // Join the challenge channel's WS room for live newMessage broadcasts.
  // Public channels are open - any viewer (guest included) joins the room
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
    if (!account?.id) { setIAmParticipant(false); setICanSubscribe(false); return; }
    try {
      const res = await fetchMyChallengeParticipation(id);
      setIAmParticipant(!!res?.isIn);
      setICanSubscribe(!!(res?.canSubscribe ?? res?.isIn));
    } catch { setIAmParticipant(false); setICanSubscribe(false); }
  }, [id, account?.id]);
  useEffect(() => { loadParticipation(); }, [loadParticipation, myAcceptance?.id]);

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

  // Active taker - derived from challenge.acceptor_user_id so it stays
  // accurate when the channel reopens after a finished round. The
  // previous taker often lingers in `participants` (they joined the
  // channel), so falling back to the first non-creator participant would surface
  // their TAKER pill even after the LATERAL slot was vacated. Hydrate
  // from `participants` when available (richer DTO - vibe/mode) and
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

  // Everyone who took the challenge - the legacy 1-1 active taker PLUS every
  // GROUP acceptor (participants = the acceptor list). Drives the chat role pill
  // so a group taker reads "Taker", not "Spectator".
  const takerIds = useMemo(() => {
    const ids = new Set<string>();
    if (activeTaker?.id) ids.add(activeTaker.id);
    for (const p of participants) if (p?.id) ids.add(p.id);
    return ids;
  }, [activeTaker?.id, participants]);


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
  // Re-expand the header whenever the keyboard hides. onBlur handles the normal
  // "tap away" case, but dismissing the keyboard via the system back gesture /
  // swipe doesn't blur the input on Android (it keeps focus) - so without this
  // the header would stay collapsed after the keyboard closes.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => collapseTo(0));
    return () => sub.remove();
  }, [collapseTo]);
  // Expanded cap = the MEASURED natural height of the collapsible header, so it
  // never clips whichever flow renders. The old fixed 320 clipped the members
  // strip once the photo-proof "Waiting for the verdict" card was added. Starts
  // generous (so nothing clips on the first frame) and settles to the real
  // height after the first onLayout pass.
  const [headerContentHeight, setHeaderContentHeight] = useState(600);
  const collapsibleMaxHeight = headerCollapse.interpolate({ inputRange: [0, 1], outputRange: [headerContentHeight, 0] });
  const collapsibleOpacity   = headerCollapse.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  // ── Render ──────────────────────────────────────────────────────────────────

  if (challengeLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      </SafeAreaView>
    );
  }

  if (!challenge) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.nav}>
          <IconButton icon="chevron-back" onPress={() => goBack()} label={t('back', { ns: 'common' })} testID="header-back" />
        </View>
        <View style={styles.center}><Text style={styles.errorText}>{t('notFound')}</Text></View>
      </SafeAreaView>
    );
  }

  const typeIcon: IoniconName = TYPE_ICONS[challenge.challenge_type] ?? 'flame-outline';
  const isValidated = challenge.status === 'validated';
  // Ended = meet date / deadline passed and never validated. The creator gets a
  // Restart pill (reopens with the same countdown); others see "Ended".
  const isEnded = !isValidated && challenge.meet_at != null && (challenge.meet_at * 1000) < Date.now();
  // closed = successfully completed (one-shot, no re-take). Treated like the
  // 'validated' archive for the passive "closed" state + Accept gating.
  const isClosed = !!challenge.closed;
  // Group challenge (Phase 4): join → meet → challenger validates presence.
  // Replaces the legacy accept→date→rate pipeline for these rows.
  const isGroup = (challenge.challenge_format ?? 'legacy') === 'group';
  // Two flavours of group: MEET (one shared meet, challenger validates presence)
  // and PHOTO-PROOF (everyone submits a photo before the deadline, challenger
  // picks the winner). meet_at is the meet date for meet, the deadline for photo.
  const isGroupPhoto = isGroup && ((challenge.validation_method ?? 'meet') === 'photo_proof' || (challenge.mode ?? 'local') === 'international');
  const isGroupMeet  = isGroup && !isGroupPhoto;
  const meetSummary = isGroup && challenge.meet_at
    ? new Date(challenge.meet_at * 1000).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;
  // The challenger can only validate presence AFTER the meet's start time.
  const meetStarted = !challenge.meet_at || (Date.now() / 1000) >= challenge.meet_at;
  // The viewer's own group membership (joined / present), if any.
  const myGroupPhase = (myAcceptance && !myAcceptance.i_am_creator) ? myAcceptance.phase : null;
  // Trust the participants list (every non-rejected acceptor) as well as the
  // phase - /me/acceptances doesn't always surface a group 'joined' row, which
  // left the join CTA showing for people who'd already joined.
  const iAmJoined = !isOwner && (myGroupPhase === 'joined' || myGroupPhase === 'present'
    || (!!account?.id && participants.some(p => p.id === account.id)));

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Nav - web parity: back pill | centered title | large type emoji on
          the right. The emoji is sized to roughly match the back pill so the
          title stays visually centered; no need for a manual spacer. */}
      <View style={styles.nav}>
        <IconButton icon="chevron-back" onPress={() => goBack()} label={t('back', { ns: 'common' })} testID="header-back" />
        <View style={styles.navCenter}>
          <CopyTranslateText value={challenge.title} style={styles.navTitle} numberOfLines={2} />
          {challenge.creator_display_name ? (
            <View style={styles.navCreatorRow}>
              {/* Tap the creator (avatar + "by name") to open their profile.
                  Only when there's a registered creator (created_by); guest
                  creators have no profile. Guests/ghosts hit the auth-gate. */}
              <TouchableOpacity
                style={styles.navCreatorTap}
                activeOpacity={0.7}
                disabled={!challenge.created_by}
                onPress={() => {
                  const uid = challenge.created_by;
                  if (!uid) return;
                  if (!canAccessProfile(account)) { router.push('/auth-gate'); return; }
                  router.push({ pathname: '/user/[id]', params: { id: uid } });
                }}
              >
                {challenge.creator_thumb_avatar_url ? (
                  <Image
                    source={{ uri: thumbUrl(challenge.creator_thumb_avatar_url) }}
                    style={styles.navCreatorAvatar}
                    cachePolicy="memory-disk"
                    contentFit="cover"
                  />
                ) : null}
                <Text style={styles.navCreatorText} numberOfLines={1}>
                  {t('byCreator', { name: challenge.creator_display_name })}
                </Text>
              </TouchableOpacity>
              {/* Notifications pill - joined participants only. Lives next
                  to the creator name at the very top so subscription state
                  is visible without scrolling past the meta row. */}
              {(iAmParticipant === true || iCanSubscribe) && account?.id && (
                <ChallengeNotificationPill challengeId={id} currentUserId={account.id} />
              )}
            </View>
          ) : null}
        </View>
        <Ionicons name={typeIcon} size={28} color={colors.primaryText} style={styles.navEmoji} accessibilityElementsHidden importantForAccessibility="no" />
      </View>

      {/* Collapsible region - badges, pipeline, owner actions, challenger row
          and participants row all live here. Shrinks to 0 (maxHeight + opacity
          interpolation) when the chat is scrolled into older messages OR the
          composer is focused. Mirrors the event channel collapse so the
          conversation gets vertical space when it matters. */}
      <Animated.View style={{ maxHeight: collapsibleMaxHeight, opacity: collapsibleOpacity, overflow: 'hidden' }}>
      {/* Inner measuring wrapper: reports the content's natural height (the
          maxHeight clamp above only clips visually, the child still lays out
          full height) so collapsibleMaxHeight can fit every flow. */}
      <View onLayout={(e) => {
        const h = Math.ceil(e.nativeEvent.layout.height);
        if (h > 0 && h !== headerContentHeight) setHeaderContentHeight(h);
      }}>
      {/* Hero - type badge + audience pill + status pill (3rd on the same row
          to save vertical space). The status pill is THE source of truth for
          the challenge's state and is visible to EVERYONE. Owner taps it to
          toggle (open ⇄ validated); non-owners see it as a read-only status. */}
      <View style={styles.hero}>
        <View style={styles.badgeRow}>
          <View style={styles.kindBadge}>
            <Text style={styles.kindBadgeText}>{t(`typeBadge.${challenge.challenge_type}`).toUpperCase()}</Text>
          </View>
          {/* Status pill - the challenge's state at a glance (replaces the big
              "This contest is done" line below, saving vertical space). */}
          {(isValidated || isClosed) ? (
            <View style={[styles.statusPill, styles.statusPillDone]}>
              <Ionicons name="checkmark" size={11} color={colors.localText} />
              <Text style={[styles.statusPillText, styles.statusPillTextDone]}>{t('status.done', { defaultValue: 'Done' })}</Text>
            </View>
          ) : isEnded ? (
            isOwner ? (
              <TouchableOpacity style={[styles.statusPill, styles.statusPillRestart]} onPress={handleRelaunch} activeOpacity={0.8}>
                <Ionicons name="refresh-outline" size={11} color={colors.onCta} />
                <Text style={[styles.statusPillText, styles.statusPillTextRestart]}>{t('relaunch.cta', { defaultValue: 'Restart' })}</Text>
              </TouchableOpacity>
            ) : (
              <View style={[styles.statusPill, styles.statusPillEnded]}>
                <Ionicons name="hourglass-outline" size={11} color={colors.mutedDim} />
                <Text style={[styles.statusPillText, styles.statusPillTextEnded]}>{t('status.ended', { defaultValue: 'Ended' })}</Text>
              </View>
            )
          ) : (
            <View style={[styles.statusPill, styles.statusPillLive]}>
              <View style={styles.statusLiveDot} />
              <Text style={[styles.statusPillText, styles.statusPillTextLive]}>{t('status.live', { defaultValue: 'Live' })}</Text>
            </View>
          )}
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
              : `${t('mode.international')}${cityTail}`;
            return (
              <View style={styles.intlPill}>
                {!fromFlag && <Ionicons name="globe-outline" size={12} color={colors.travelerText} />}
                <Text style={styles.intlPillText} numberOfLines={1}>{label}</Text>
              </View>
            );
          })() : null /* Local = for everyone in the city; no audience pill. */}
          {/* Share - distinct violet tint so it doesn't blur in with the
              orange admin pills below. The verb is the social growth hook
              of the screen; it deserves its own color. */}
          <TouchableOpacity
            style={[styles.sharePillInline, styles.sharePillInlineShare]}
            onPress={handleShare}
            activeOpacity={0.75}
            accessibilityLabel={t('shareCta')}
          >
            <Ionicons name="share-social-outline" size={14} color={colors.primaryText} />
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
              color={colors.muted}
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
              <Ionicons name="exit-outline" size={14} color={colors.primaryText} />
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
            const caretColor =
              effective === 'friends' ? colors.travelerText :
              effective === 'private' ? colors.red :
              colors.primaryOnTint;
            const busyAny = visBusy;
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
                  <Ionicons name="chevron-down" size={10} color={caretColor} style={{ marginLeft: Space.xxs }} />
                )}
              </TouchableOpacity>
            );
          })()}
          {/* Manage challenge - creator-only pill. Opens a modal with
              Close challenge / Delete to keep the meta row tight. */}
          {isOwner && challenge && (
            <TouchableOpacity
              style={styles.sharePillInline}
              onPress={() => setManageOpen(true)}
              activeOpacity={0.75}
              accessibilityLabel={t('manage.cta')}
            >
              <Ionicons name="settings-outline" size={14} color={colors.primaryText} />
              <Text style={styles.sharePillInlineText} numberOfLines={1}>{t('manage.cta')}</Text>
            </TouchableOpacity>
          )}
          {/* Close-to-new-joins pill removed - Private inside the
              visibility dropdown above maps to closed_to_new_joins. */}
        </View>
        </View>

        {/* ── GROUP CHALLENGE (Phase 4): meet/contest info + join / resolve ──
            Replaces the legacy accept→date→rate pipeline for group rows.
            MEET → date + place + "validate who showed up".
            PHOTO-PROOF → submission deadline + "pick the winner"; joined
            takers submit via the ChallengeProofBlock rendered below. */}
        {isGroup && (
          <View style={styles.groupBlock}>
            {(meetSummary || challenge.venue) ? (
              <View style={styles.groupMeetCard}>
                <Text style={styles.groupMeetLine} numberOfLines={2}>
                  {isGroupPhoto
                    ? <><Ionicons name="hourglass-outline" size={12} color={colors.muted} />{` ${t('group.deadlinePrefix', { defaultValue: 'Submit by' })} ${meetSummary ?? ''}`}</>
                    : <>
                        <Ionicons name="calendar-outline" size={12} color={colors.muted} />{` ${meetSummary ?? ''}`}
                        {isGroupMeet && challenge.venue
                          ? <>{'   ·   '}<Ionicons name="location-outline" size={12} color={colors.muted} />{` ${challenge.venue}`}</>
                          : null}
                      </>}
                </Text>
              </View>
            ) : null}
            {isValidated ? null /* status now shown as a pill in the header */ : isOwner ? (
              // MEET: open the presence sheet. PHOTO: the winner is picked from
              // the "N photos · pick the best one" card below (no extra hint).
              isGroupPhoto ? null : !meetStarted ? (
                // Before the meet's start time there's nothing to validate yet.
                <Text style={styles.groupStateText}>
                  <Ionicons name="hourglass-outline" size={14} color={colors.green} /> {t('group.validateAfter', { time: meetSummary ?? '', defaultValue: `You can validate after the meet · ${meetSummary ?? ''}` })}
                </Text>
              ) : (
                <TouchableOpacity style={styles.groupPrimaryBtn} activeOpacity={0.85} onPress={() => setValidateOpen(true)}>
                  <Text style={styles.groupPrimaryBtnText}>
                    {t('group.validateCta', { defaultValue: 'Validate who showed up' })}  →
                  </Text>
                </TouchableOpacity>
              )
            ) : iAmJoined ? (
              <Text style={styles.groupStateText}>
                <Ionicons name="checkmark" size={14} color={colors.green} /> {isGroupPhoto
                  ? t('group.youreInPhoto', { defaultValue: "You're in — submit your photo below." })
                  : t('group.youreIn', { defaultValue: "You're in — see you there!" })}
              </Text>
            ) : (
              <TouchableOpacity
                style={[styles.groupPrimaryBtn, (challenge.closed_to_new_joins || joining) && { opacity: 0.6 }]}
                activeOpacity={0.85}
                disabled={!!challenge.closed_to_new_joins || joining}
                onPress={handleGroupJoin}
              >
                <Text style={styles.groupPrimaryBtnText}>
                  {challenge.closed_to_new_joins
                    ? t('group.closed', { defaultValue: 'Closed to new joins' })
                    : <>
                        <Ionicons name="add" size={16} color={colors.onCta} />{' '}
                        {isGroupPhoto
                          ? t('group.joinContestCta', { defaultValue: 'Join the challenge (+2 pts)' })
                          : t('group.joinCta', { defaultValue: 'Join the challenge (+2 pts)' })}
                      </>}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Photo-proof GROUP: the joined taker submits a photo (and sees their
            "waiting" state) via the same proof block the legacy flow uses, keyed
            on their own group acceptance. Hidden for the challenger (they pick a
            winner above) and for non-participants. */}
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

        {/* Members strip sits ABOVE the submissions gallery (the photos card
            reads as the call-to-action, with the roster as context). */}
        {iAmParticipant === true && (
          <ChallengeChannelMembersStrip
            challenge={challenge}
            activeTaker={activeTaker}
            onOpen={() => setMembersOpen(true)}
          />
        )}

        {/* Photo-proof GROUP submissions gallery - EVERYONE sees every photo +
            who submitted it. The challenger picks the winner straight from here;
            once picked, the winning tile is crowned for all viewers. */}
        {isGroupPhoto && (
          <GroupSubmissionsGallery
            challengeId={id}
            isChallenger={isOwner}
            isValidated={isValidated}
            refreshKey={galleryTick}
            onChanged={() => { loadChallenge(); loadParticipants(); }}
            openSignal={gallerySignal}
          />
        )}

        </View>
        )}{/* /detailsOpen */}

        {/* PR54 - Owner re-invite CTA dropped. It was rendering between
            the members strip and the chat with a glitchy clipped top
            edge on intl creator views, and the same share affordance
            already lives in the meta row (the "↗ Share" pill).
            ChallengePostCreateSheet stays mounted for the owner's invite CTA. */}

        {/* Close challenge / Delete moved into the Manage modal
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
                  source={{ uri: thumbUrl(creator.thumbAvatarUrl ?? creator.avatarUrl ?? undefined) }}
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
              <Text style={styles.challengerTag}><Ionicons name="ribbon-outline" size={11} color={colors.primaryText} /> {t('challengerTag')}</Text>
            </View>
          </TouchableOpacity>

          {/* Share moved up next to the audience pill in the badge row so
              it's visible at every lifecycle stage (not just when there's a
              creator-participant row). */}
        </View>
      )}

      </View>{/* /measuring wrapper */}
      </Animated.View>

      {/* Owner re-invite CTA - parity with the web ChallengeChatPage. Visible
          only while the challenge is genuinely free (not validated, not
          actively held). Opens the same post-create seed sheet so the
          creator can re-ping more members or share again at any later
          moment. Cyan tint matches the international badge so on intl
          rows the visual link "this targets the city" reads at a glance.
          inviteCityName already resolves to the TARGET city for intl with
          a target, falling through to the origin city otherwise - so the
          label says "in Paris" for HCMC→Paris challenges, "in HCMC" for
          plain locals, etc. */}
      {isOwner && !isValidated && !challenge?.is_in_progress && (
        <TouchableOpacity
          style={styles.ownerInviteCta}
          onPress={() => setPostCreateOpen(true)}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          <Ionicons name="flash-outline" size={14} color={colors.travelerText} style={styles.ownerInviteCtaIcon} />
          <Text style={styles.ownerInviteCtaText} numberOfLines={1}>
            {t('postCreate.ctaInvite', { city: inviteCityName ?? t('postCreate.thisCity') })}
          </Text>
        </TouchableOpacity>
      )}

      {/* Share-to-my-city: owner OR the taker (any phase) can drop the
          challenge deeplink into their own city feed in one tap. International
          challenges carry both cities so the feed reads who's challenging whom. */}
      {challenge && (isOwner || !!myAcceptance) && (() => {
        const isIntl = (challenge.mode ?? 'local') === 'international';
        const from = [countryToFlag(challenge.country ?? null), challengeCityName].filter(Boolean).join(' ');
        const to   = [countryToFlag(challenge.target_country ?? null) || '🌍', challengeTargetCityName].filter(Boolean).join(' ');
        const shareLabel = isIntl
          ? `🌍 International Challenge ${from} → ${to}`
          : '⚡ Challenge';
        return (
          <>
            <ShareToCityPill
              url={buildChallengeUrl(challenge)}
              title={challenge.title}
              label={shareLabel}
              style={{ alignSelf: 'center', marginTop: Spacing.sm, marginHorizontal: Spacing.md }}
            />
            {/* International challenges can also be broadcast to the World channel. */}
            {isIntl && (
              <ShareToWorldPill
                url={buildChallengeUrl(challenge)}
                title={challenge.title}
                label={shareLabel}
                style={{ alignSelf: 'center', marginTop: Spacing.sm, marginHorizontal: Spacing.md }}
              />
            )}
          </>
        );
      })()}

      {/* Inline thread chat (was previously a separate /thread/[id] screen).
          Mounts only when the viewer has an active acceptance for this
          challenge - acceptors see their own thread, creators see their
          most-recently-active acceptor's thread (server-ordered).

          KAV is a bare styles.flex + behavior="padding" - IDENTICAL to the
          working city chat. It must NOT carry its own paddingBottom: RN's
          'padding' behavior overwrites the container's bottom padding with the
          keyboard height, and on Android (edge-to-edge, targetSdk 35+) that
          overwrite doesn't reliably reset on dismiss → stale padding (dead space
          after closing) and a doubled inset that hid the composer on the 2nd open.
          The home-indicator inset is handled by the SafeAreaView (edges bottom)
          instead, so it never touches the KAV. (This route is a root-stack screen,
          not inside the tabs, so there's no tab bar to clear here.) */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
      >
        {/* The chat shows for everyone on a public channel and for
            participants of a friends / private one. */}
        {(challengeIsPublic || iAmParticipant === true) ? (
          <>
            {/* Guest welcome - fires on entry for any unauthenticated
                viewer of a public channel. Two-line: "chat free, no
                sign-up" + a direct sign-up CTA that ports the existing
                returnTo handshake so they land back here primed to tap
                Take-on. × dismisses for the session. */}
            {!account?.id && challengeIsPublic && showGuestWelcome ? (
              <View style={styles.guestWelcome}>
                <TouchableOpacity
                  style={styles.guestWelcomeBody}
                  onPress={() => {
                    // Push to sign-up BEFORE flipping local state - if state
                    // updates batch with re-render and the navigation gets
                    // dropped, the user at least sees the gate. Route
                    // straight to /sign-up (skipping /auth-gate's marketing
                    // intermezzo) since the banner copy already promised
                    // "3 seconds" - the user is convinced, give them the
                    // form. The returnTo handshake brings them back here
                    // post-signup primed to tap Take-on.
                    const returnTo = encodeURIComponent(`/challenge/${id}`);
                    router.push(`/sign-up?returnTo=${returnTo}` as never);
                    setShowGuestWelcome(false);
                  }}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                >
                  <Text style={styles.guestWelcomeText} numberOfLines={2}>
                    {i18n.t('welcomeGuest.title', { ns: 'challenge', defaultValue: 'Welcome! Chat freely here - no sign-up needed.' })}
                  </Text>
                  <Text style={styles.guestWelcomeCta} numberOfLines={2}>
                    {i18n.t('welcomeGuest.cta', { ns: 'challenge', defaultValue: 'Want to take this challenge? Sign up in 3 seconds' })}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setShowGuestWelcome(false)}
                  hitSlop={10}
                  accessibilityLabel={i18n.t('close', { ns: 'common' })}
                  style={styles.guestWelcomeClose}
                >
                  <Ionicons name="close" size={16} color={colors.mutedDim} />
                </TouchableOpacity>
              </View>
            ) : null}

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
                // Challenger / taker pill next to the nickname. The creator is
                // the challenger; anyone who took the challenge (the legacy 1-1
                // active taker OR any GROUP acceptor) is a taker; everyone else
                // who posts with a userId is a spectator. Anonymous → no badge.
                const senderId = item.userId ?? null;
                const roleBadge: 'challenger' | 'taker' | 'spectator' | null =
                    !senderId
                      ? null
                      : (challenge.created_by && senderId === challenge.created_by)
                          ? 'challenger'
                          : takerIds.has(senderId)
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
                <View style={styles.loadingOlderWrap}><ActivityIndicator size="small" color={colors.muted} /></View>
              ) : null}
              ListEmptyComponent={!msgsLoading ? (
                <View style={styles.emptyChat}>
                  <Ionicons name="hand-right-outline" size={36} color={colors.muted} style={styles.emptyChatEmoji} />
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


            {(isValidated || isClosed) ? (
              <ComposerEndedNotice text={i18n.t('composer.closedChallenge', { ns: 'common' })} />
            ) : (
              <ChatInput
                sending={sending}
                placeholder={i18n.t('composer.placeholderChallenge', { ns: 'common' })}
                mentionContext="challenge"
                mentionChannelId={id}
                onFocus={() => collapseTo(1)}
                onBlur={() => collapseTo(0)}
                dismissOnSend
                onSendText={(text, mentions) => {
                  const reply = replyingToRef.current;
                  setReplyingTo(null);
                  sendText(text, reply, mentions);
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
            )}
          </>
        ) : (
          /* Non-chat surface: non-public + iAmParticipant=false → private
             lock state, else the default locked state. Public channels never
             reach this branch - the chat above renders for them directly. */
          (() => {
            // Non-public + non-participant → conversation is locked. No
            // CTA, no join step (those channels are tied to creator +
            // taker only); the line just explains why the chat is hidden.
            // Hide while iAmParticipant is still null (probe in flight)
            // to avoid a brief flash of the locked surface.
            if (!challengeIsPublic && iAmParticipant === false) {
              return (
                <View style={styles.lockedWrap}>
                  <Ionicons name="lock-closed-outline" size={40} color={colors.muted} style={styles.lockedEmoji} />
                  <Text style={styles.lockedTitle}>{t('lock.private.title')}</Text>
                  <Text style={styles.lockedBody}>{t('lock.private.body')}</Text>
                </View>
              );
            }

            // Default - visitor (available) or empty-creator state.
            return (
              <View style={styles.lockedWrap}>
                <Ionicons name="lock-closed-outline" size={40} color={colors.muted} style={styles.lockedEmoji} />
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

      {/* Manage challenge modal - Close / Delete bundled. */}
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
              onPress={() => { setManageOpen(false); handleToggleStatus(); }}
              disabled={validateBusy}
              activeOpacity={0.75}
            >
              <Ionicons
                name={isValidated ? 'checkmark-circle' : 'lock-closed-outline'}
                size={18}
                color={isValidated ? colors.localText : colors.text}
              />
              <Text style={[styles.manageRowText, isValidated && { color: colors.localText }]}>
                {isValidated ? t('reopenCta') : t('closeCta')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.manageRow, styles.manageRowDanger]}
              onPress={() => { setManageOpen(false); handleDelete(); }}
              activeOpacity={0.75}
            >
              <Ionicons name="trash-outline" size={18} color={colors.red} />
              <Text style={[styles.manageRowText, { color: colors.red }]}>{t('deleteConfirm')}</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      )}


      {/* Group MEET presence validation (challenger-only, multi-select). */}
      {isGroupMeet && (
        <ValidatePresenceSheet
          visible={validateOpen}
          participants={participants}
          submitting={validating}
          mode="presence"
          onClose={() => setValidateOpen(false)}
          onConfirm={handleValidatePresence}
        />
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
                  style={[styles.manageRow, selected && { backgroundColor: colors.primaryTint, borderWidth: Border, borderColor: colors.primary }]}
                  onPress={() => handlePickVisibility(opt)}
                  disabled={visBusy}
                  activeOpacity={0.75}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.manageRowText}>{t(`visibility.badge.${opt}`)}</Text>
                    <Text style={{ fontSize: FontSizes.xs, color: colors.muted, marginTop: Space.xxs }}>{hint}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </Modal>
      )}

      {/* Invite "seed it" sheet - first opens with two CTAs (invite city
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
        translateText={actionSheetMsg?.content}
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

      {showCampaignCelebration && (
        <CampaignCelebration onDone={() => setShowCampaignCelebration(false)} />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  flex:      { flex: 1 },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: FontSizes.md, color: c.red, padding: Spacing.md, textAlign: 'center' },

  // Guest welcome - slightly taller than the intro banner because the
  // copy splits across two lines (welcome + sign-up CTA). Same warm-
  // dark fill + accent-orange ring so the two surfaces feel like
  // siblings even though only one shows at a time.
  guestWelcome: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               Space.sm,
    marginHorizontal:  Spacing.md,
    marginTop:         Spacing.xs,
    marginBottom:      Spacing.xs,
    paddingVertical:   Space.md,
    paddingHorizontal: Space.md,
    backgroundColor:   c.bg2,
    borderRadius:      Radius.card,
    borderWidth:       Border,
    borderColor:       c.primary,
  },
  guestWelcomeBody: {
    flex: 1,
    gap:  Space.xxs,
  },
  guestWelcomeText: {
    color:      c.text,
    fontSize:   FontSizes.sm,
    fontWeight: '600',
  },
  guestWelcomeCta: {
    color:      c.primaryText,
    fontSize:   FontSizes.sm,
    fontWeight: '700',
  },
  guestWelcomeClose: {
    alignSelf: 'flex-start',
    paddingTop: Space.xxs,
  },

  // Nav
  nav: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: c.line,
    gap:               Spacing.sm,
  },
  navCenter: { flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  navTitle:  { fontSize: FontSizes.md, fontWeight: '800', color: c.text, flexShrink: 1, textAlign: 'center' },
  navCreatorRow:    { flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginTop: Space.xxs },
  navCreatorTap:    { flexDirection: 'row', alignItems: 'center', gap: Space.xs, flexShrink: 1 },
  navCreatorAvatar: { width: 14, height: 14, borderRadius: 7 },
  navCreatorText:   { fontSize: FontSizes.xs, fontWeight: '600', color: c.muted, flexShrink: 1 },
  // Sized to roughly match the back-pill width so the title stays centered
  // without needing a manual right-side spacer.
  navEmoji:  { fontSize: 28, lineHeight: 32, minWidth: 44, textAlign: 'center' },

  // Hero (badge + audience + status + actions)
  hero: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    gap:               Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: c.line,
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Space.sm },

  kindBadge: {
    backgroundColor:   c.primaryTint,
    borderRadius:      Radius.full,
    paddingHorizontal: Space.sm, paddingVertical: Space.xxs,
    borderWidth:       Border, borderColor: c.primary,
  },
  kindBadgeText: { fontSize: FontSizes.tiny, fontWeight: '800', color: c.primaryOnTint, letterSpacing: 0.5 },

  // Row so the leading stroke icon (checkmark / refresh / hourglass / live
  // dot) sits next to the label.
  statusPill:          { flexDirection: 'row', alignItems: 'center', gap: Space.xs, borderRadius: Radius.full, paddingHorizontal: Space.sm, paddingVertical: Space.xxs, borderWidth: Border },
  statusPillDone:      { backgroundColor: c.localBg,  borderColor: c.localText },
  statusPillLive:      { backgroundColor: c.goldTint, borderColor: c.gold },
  statusPillEnded:     { backgroundColor: c.bg3, borderColor: c.line },
  statusPillRestart:   { backgroundColor: c.cta, borderColor: 'transparent' },
  statusPillText:      { fontSize: FontSizes.xs, fontWeight: '800', letterSpacing: 0.5 },
  statusPillTextDone:  { color: c.localText },
  statusPillTextLive:  { color: c.gold },
  statusPillTextEnded: { color: c.mutedDim },
  statusPillTextRestart: { color: c.onCta },
  statusLiveDot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: c.green },

  // International chip - cyan, distinct from audience violet so Local vs
  // Intl reads at a glance (mirrors the NOW-card pattern from step 8).
  intlPill: {
    flexDirection:     'row', alignItems: 'center', gap: Space.xs,
    backgroundColor:   c.travelerBg,
    borderRadius:      Radius.full,
    paddingHorizontal: Space.sm, paddingVertical: Space.xxs,
    borderWidth:       Border, borderColor: c.travelerText,
    flexShrink:        1,
  },
  intlPillText: { fontSize: FontSizes.xs, fontWeight: '700', color: c.travelerText, letterSpacing: 0.3, flexShrink: 1 },

  // Share inline pill - same height/padding as the kind + audience pills so
  // the three sit on a single row without alignment drift. Orange brand tint
  // because Share is the most user-facing growth lever on this screen.
  sharePillInline: {
    flexDirection: 'row', alignItems: 'center', gap: Space.xs,
    backgroundColor:   c.primaryTint,
    borderRadius:      Radius.full,
    paddingHorizontal: Space.sm, paddingVertical: Space.xxs,
    borderWidth:       Border, borderColor: c.primary,
  },
  sharePillInlineText: { fontSize: FontSizes.xs, fontWeight: '700', color: c.primaryText, letterSpacing: 0.3 },

  // Share - V3 drops the legacy violet: same primary tint as the other
  // inline pills (kept as a separate style so it can diverge again).
  sharePillInlineShare: {
    backgroundColor: c.primaryTint,
    borderColor:     c.primary,
  },
  sharePillInlineShareText: { color: c.primaryText },

  // Collapse chevron at the far right of badgeRow - toggles the channel-
  // header details (second pill row + pipeline + proof + members strip).
  // marginLeft:'auto' floats it right so the role reads as "fold what's
  // below", not as another inline pill.
  detailsToggle: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: Border, borderColor: c.line,
    marginLeft: 'auto',
  },

  // Detail block - wraps the collapsible content below the always-visible
  // hero row. LayoutAnimation handles the height transition.
  detailsBlock: { },

  // Group challenge block (meet info + join / validate).
  groupBlock:     { paddingHorizontal: Spacing.md, paddingTop: Spacing.xs, gap: Space.sm },
  groupMeetCard:  {
    flexDirection: 'row', alignItems: 'center', gap: Space.sm,
    backgroundColor: c.bg2, borderRadius: Radius.card, borderWidth: Border, borderColor: c.line,
    paddingHorizontal: Spacing.md, paddingVertical: Space.sm,
  },
  groupMeetLine:  { flex: 1, fontSize: FontSizes.sm, fontWeight: '600', color: c.muted },
  groupStateText: { fontSize: FontSizes.sm, fontWeight: '700', color: c.green, textAlign: 'center', paddingVertical: Space.xs },
  groupPrimaryBtn: {
    // Solid fill = unmistakably tappable. The old translucent/outlined style
    // read as an already-done state ("✓ validated") rather than a CTA.
    minHeight: 48, paddingVertical: Space.md, paddingHorizontal: Space.lg, borderRadius: Radius.button, alignItems: 'center', justifyContent: 'center',
    // V3: the shared primary look (Button): tangerine with ink text.
    backgroundColor: c.cta,
  },
  groupPrimaryBtnText: { color: c.onCta, fontSize: FontSizes.md, fontWeight: '800', textAlign: 'center' },

  // Visibility pill tints - applied to BOTH the TouchableOpacity (for
  // background + borderColor) and the inner Text (for color). Split into
  // pill/text objects so the View vs Text types stay clean.
  visibilityPillPublic:      { backgroundColor: c.primaryTint, borderColor: c.primary },
  visibilityPillFriends:     { backgroundColor: c.travelerBg, borderColor: c.travelerText },
  visibilityPillPrivate:     { backgroundColor: 'transparent', borderColor: c.red },
  visibilityPillTextPublic:  { color: c.primaryOnTint },
  visibilityPillTextFriends: { color: c.travelerText },
  visibilityPillTextPrivate: { color: c.red },

  // (Old status-pill styles removed - the ChallengePipeline component owns
  // the lifecycle visual now. The close-challenge action moved to the
  // owner-secondary row as a small ghost button.)

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
    gap:               Space.sm,
    paddingVertical:   Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    borderRadius:      Radius.full,
    borderWidth:       Border,
    borderColor:       c.travelerText,
    backgroundColor:   c.travelerBg,
    marginTop:         Spacing.sm,
    alignSelf:         'center',
  },
  ownerInviteCtaIcon: { fontSize: 14, lineHeight: 18 },
  ownerInviteCtaText: { fontSize: FontSizes.sm, fontWeight: '700', color: c.travelerText, flexShrink: 1 },

  // Challenger row - the creator, distinguished from regular participants
  // with a 👑 pill in brand orange. Bigger avatar (44px) so the originating
  // user reads as the anchor of the défi.
  challengerRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: c.line,
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
  challengerAvatarLetter: { color: c.white, fontWeight: '700', fontSize: FontSizes.md },
  challengerInfo: { flex: 1, gap: Space.xxs, minWidth: 0 },
  challengerName: { fontSize: FontSizes.md, fontWeight: '700', color: c.text },
  challengerTag:  { fontSize: FontSizes.xs, fontWeight: '800', color: c.primaryText, letterSpacing: 0.3 },

  // Inline thread chat
  chatList:         { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: Spacing.md, gap: Space.xs },
  loadingOlderWrap: { paddingVertical: Spacing.md, alignItems: 'center' },
  emptyChat:        { paddingVertical: 60, alignItems: 'center', gap: Space.sm },
  emptyChatEmoji:   { },
  emptyChatText:    { fontSize: FontSizes.sm, color: c.muted, textAlign: 'center', paddingHorizontal: Spacing.lg },

  // Locked state - shown to visitors / creators with no acceptances yet.
  // Centered card-like block in the middle of the empty area below the
  // participants row.
  lockedWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: Spacing.xl, gap: Space.md,
  },
  lockedEmoji: { opacity: 0.7 },
  lockedTitle: { fontSize: FontSizes.md, fontWeight: '800', color: c.text, textAlign: 'center' },
  lockedBody:  { fontSize: FontSizes.sm, color: c.muted, textAlign: 'center', maxWidth: 320 },

  // Join-the-channel CTA shown to non-participants in place of the chat.
  joinCta: {
    marginTop:       Spacing.sm,
    paddingHorizontal: Spacing.xl,
    minHeight:         48,
    justifyContent:    'center',
    borderRadius:      Radius.button,
    backgroundColor:   c.cta,
  },

  // Manage / proof-spec modal - bottom-sheet style with backdrop. Reuses
  // the same shape as the existing MembersSheet (handle + header) but
  // simpler: stacked rows.
  modalBackdrop: { flex: 1, backgroundColor: c.scrim },
  manageSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: c.bg2,
    borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.sm,
  },
  manageTitle: {
    fontSize: FontSizes.lg, fontWeight: '800', color: c.text,
    marginBottom: Spacing.sm,
  },
  manageRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm + 2,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: c.bg3,
  },
  // V3: red outline on a transparent ground instead of a red tint.
  manageRowDanger: { backgroundColor: 'transparent', borderWidth: Border, borderColor: c.red },
  manageRowText:   { fontSize: FontSizes.md, fontWeight: '700', color: c.text },
});
