import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, ActivityIndicator,
  TouchableOpacity, StyleSheet, KeyboardAvoidingView, Alert, AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { socket } from '@/lib/socket';
import {
  fetchChallengeById, fetchChallengeParticipants, fetchChallengeMessages,
  sendChallengeMessage, sendChallengeImageMessage,
  toggleChallengeParticipation, validateChallenge, deleteChallenge,
} from '@/api/challenges';
import { AttendeeAvatars } from '@/components/AttendeeAvatars';
import { MembersSheet } from '@/components/MembersSheet';
import { useMessages } from '@/hooks/useMessages';
import { ChatMessage } from '@/features/chat/ChatMessage';
import { ChatInput } from '@/features/chat/ChatInput';
import { MessageActionSheet } from '@/features/chat/MessageActionSheet';
import * as Clipboard from 'expo-clipboard';
import i18n from '@/i18n';
import { isSameDay, formatDateLabel } from '@/lib/messageTime';
import { track } from '@/services/analytics';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { Challenge, ChallengeType, ChallengeAudience, Message, UserDTO } from '@/types';

const TYPE_ICONS: Record<ChallengeType, string> = {
  food:    '🍜',
  place:   '📍',
  culture: '🎭',
  help:    '🤝',
};

export default function ChallengeChatScreen() {
  const router = useRouter();
  const { t } = useTranslation('challenge');
  const { id } = useLocalSearchParams<{ id: string }>();
  const { identity, account, sessionId } = useApp();
  const nickname = account?.display_name ?? identity?.nickname ?? '';

  const [challenge,        setChallenge]        = useState<Challenge | null>(null);
  const [challengeLoading, setChallengeLoading] = useState(true);
  const [participants,     setParticipants]     = useState<UserDTO[]>([]);
  const [membersOpen,      setMembersOpen]      = useState(false);
  const [acceptBusy,       setAcceptBusy]       = useState(false);
  const [validateBusy,     setValidateBusy]     = useState(false);
  const [actionSheetMsg,   setActionSheetMsg]   = useState<Message | null>(null);

  // Owner is either the registered creator OR the guest who created it.
  const isOwner = !!(
    (account?.id && challenge?.created_by && account.id === challenge.created_by) ||
    (identity?.guestId && challenge?.guest_id && identity.guestId === challenge.guest_id)
  );

  // "Am I currently a participant?" — derived from the participant list.
  const isParticipant = !!(
    (account?.id   && participants.some(p => p.id === account.id)) ||
    (identity?.guestId && participants.some(p => p.id === identity.guestId))
  );

  const loadChallenge = useCallback(() => {
    if (!id) return;
    fetchChallengeById(id)
      .then(({ challenge: c }) => setChallenge(c))
      .catch(() => setChallenge(null))
      .finally(() => setChallengeLoading(false));
  }, [id]);

  const loadParticipants = useCallback(() => {
    if (!id) return;
    fetchChallengeParticipants(id)
      .then(d => setParticipants(d.participants))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    loadChallenge();
    loadParticipants();
  }, [loadChallenge, loadParticipants]);

  // ── Owner actions ───────────────────────────────────────────────────────────

  const handleEdit = useCallback(() => {
    if (!challenge) return;
    router.push({
      pathname: '/challenge/create',
      params: {
        editId:   challenge.id,
        title:    challenge.title,
        type:     challenge.challenge_type,
        audience: challenge.audience,
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

  const handleValidate = useCallback(async () => {
    if (!identity) return;
    // One-click validate — no Alert popup. The orange Validate button is its
    // own confirmation; the extra dialog was friction per user feedback.
    setValidateBusy(true);
    try {
      const updated = await validateChallenge(id, identity.guestId);
      setChallenge(updated);
      track('challenge_validated', { challengeId: id });
    } catch {
      Alert.alert(t('errSave'));
    } finally {
      setValidateBusy(false);
    }
  }, [id, identity, t]);

  // ── Participant actions (non-owner) ──────────────────────────────────────────

  const handleAccept = useCallback(async () => {
    if (!identity || acceptBusy) return;
    setAcceptBusy(true);
    try {
      await toggleChallengeParticipation(id, identity.guestId, nickname || null);
      loadParticipants();
      // Refresh challenge so participant_count updates in the hero.
      loadChallenge();
      if (!isParticipant) track('challenge_accepted', { challengeId: id });
    } finally {
      setAcceptBusy(false);
    }
  }, [id, identity, nickname, acceptBusy, isParticipant, loadParticipants, loadChallenge]);

  // ── Messages ─────────────────────────────────────────────────────────────────

  const loadFn = useCallback(
    (opts?: { beforeId?: string }) => fetchChallengeMessages(id, opts),
    [id],
  );

  const postTextFn = useCallback(
    (content: string, _replyToId?: string | null, mentions?: import('@/types').MentionRef[]): Promise<Message> => {
      if (!identity) return Promise.reject(new Error('Not ready'));
      return sendChallengeMessage(id, identity.guestId, nickname, content, mentions);
    },
    [id, identity, nickname],
  );

  const postImageFn = useCallback(
    (imageUrl: string): Promise<Message> => {
      if (!identity) return Promise.reject(new Error('Not ready'));
      return sendChallengeImageMessage(id, identity.guestId, nickname, imageUrl);
    },
    [id, identity, nickname],
  );

  const { messages, loading: msgsLoading, loadingOlder, hasMore, sending, error: msgError, clearError, sendText, sendImage, loadOlder, reload, deleteMessage } = useMessages({
    channelId: id,
    loadFn,
    postTextFn,
    postImageFn,
  });

  // Join the WS challenge room while focused; leave on blur. Same pattern as
  // topic chat — fallback poll only while WS is disconnected + app active.
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useFocusEffect(useCallback(() => {
    // Refresh the challenge on focus so a recently-validated state shows
    // immediately after returning from another tab.
    loadChallenge();
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop  = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
    const sync  = () => {
      if (!socket.isConnected && AppState.currentState === 'active') {
        if (timer === null) timer = setInterval(() => reloadRef.current(), 30_000);
      } else stop();
    };
    sync();
    const offDisc = socket.on('disconnected', sync);
    const offConn = socket.on('connected',    () => { stop(); reloadRef.current(); });
    const appSub  = AppState.addEventListener('change', s => {
      if (s === 'active') { reloadRef.current(); sync(); } else stop();
    });
    return () => { stop(); offDisc(); offConn(); appSub.remove(); };
  }, [loadChallenge]));

  useEffect(() => {
    if (!id || !sessionId) return;
    socket.joinChallenge(id, sessionId);
    return () => socket.leaveChallenge(id, sessionId);
  }, [id, sessionId]);

  // Listen for WS 'challenge_validated' for this exact challenge so the badge
  // flips live when the creator validates from another device.
  useEffect(() => {
    const off = socket.on('challenge_validated', (data: Record<string, unknown>) => {
      const ch = data.challenge as Challenge | undefined;
      if (ch?.id === id) setChallenge(ch);
    });
    return off;
  }, [id]);

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
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Nav */}
      <View style={styles.nav}>
        <TouchableOpacity style={styles.backPill} onPress={() => router.back()} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={18} color={Colors.text} />
          <Text style={styles.backPillText} numberOfLines={1}>{t('back', { ns: 'common' })}</Text>
        </TouchableOpacity>
        <View style={styles.navCenter}>
          <Text style={styles.navIcon}>{typeIcon}</Text>
          <Text style={styles.navTitle} numberOfLines={2}>{challenge.title}</Text>
        </View>
        {/* Spacer for symmetry with the back pill */}
        <View style={{ width: 64 }} />
      </View>

      {/* Hero — badge row + audience pill + (validated) check + owner actions */}
      <View style={styles.hero}>
        <View style={styles.badgeRow}>
          <View style={styles.kindBadge}>
            <Text style={styles.kindBadgeText}>{t('createTitle').toUpperCase()}</Text>
          </View>
          <View style={styles.audiencePill}>
            <Text style={styles.audiencePillText}>{audienceLabel[challenge.audience]}</Text>
          </View>
          {isValidated && (
            <View style={styles.validatedBadge}>
              <Text style={styles.validatedBadgeText}>✓ {t('validatedBadge')}</Text>
            </View>
          )}
        </View>

        {/* Owner actions: Edit / Delete / Validate. Only the creator sees these.
            Validate is hidden once the challenge is already validated. */}
        {isOwner && (
          <View style={styles.ownerRow}>
            {!isValidated && (
              <TouchableOpacity
                style={[styles.ownerBtn, styles.ownerBtnPrimary]}
                onPress={handleValidate}
                activeOpacity={0.8}
                disabled={validateBusy}
              >
                {validateBusy
                  ? <ActivityIndicator color="#FF7A3C" size="small" />
                  : <>
                      <Ionicons name="checkmark-circle-outline" size={15} color="#FF7A3C" />
                      <Text style={[styles.ownerBtnText, { color: '#FF7A3C' }]}>{t('validateConfirm')}</Text>
                    </>}
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.ownerBtn} onPress={handleEdit} activeOpacity={0.8}>
              <Ionicons name="create-outline" size={15} color={Colors.text} />
              <Text style={styles.ownerBtnText}>{t('editTitle')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.ownerBtn, styles.ownerBtnDanger]} onPress={handleDelete} activeOpacity={0.8}>
              <Ionicons name="trash-outline" size={15} color={Colors.red} />
              <Text style={[styles.ownerBtnText, { color: Colors.red }]}>{t('deleteConfirm')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Non-owner accept CTA — also hidden when the challenge is validated. */}
        {!isOwner && !isValidated && (
          <TouchableOpacity
            style={[styles.acceptBtn, isParticipant && styles.acceptBtnSecondary]}
            onPress={handleAccept}
            activeOpacity={0.85}
            disabled={acceptBusy}
          >
            {acceptBusy
              ? <ActivityIndicator color={Colors.white} size="small" />
              : <Text style={styles.acceptBtnText}>
                  {isParticipant ? t('acceptedCta') : t('acceptCta')}
                </Text>}
          </TouchableOpacity>
        )}
      </View>

      {/* Members strip — tappable opens the full list. Same component pattern
          as Hangouts/Events for visual consistency. */}
      {participants.length > 0 && (
        <TouchableOpacity style={styles.membersStrip} activeOpacity={0.75} onPress={() => setMembersOpen(true)}>
          <AttendeeAvatars
            preview={participants.slice(0, 5).map(p => ({ id: p.id, displayName: p.displayName, thumbAvatarUrl: p.thumbAvatarUrl ?? p.avatarUrl }))}
            total={participants.length}
            borderColor={Colors.bg}
          />
          <Text style={styles.membersLabel}>
            {participants.length === 1 ? participants[0].displayName : `${participants.length}`}
          </Text>
        </TouchableOpacity>
      )}

      {/* Message error banner */}
      {msgError && (
        <TouchableOpacity style={styles.errorBanner} onPress={clearError} activeOpacity={0.8}>
          <Text style={styles.errorBannerText}>{msgError}</Text>
        </TouchableOpacity>
      )}

      {/* Chat */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <FlatList
          data={messages}
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
                onLongPress={(msg) => {
                  if (!msg.id || msg.id.startsWith('local-')) return;
                  setActionSheetMsg(msg);
                }}
              />
            );
          }}
          inverted
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          onEndReached={hasMore ? loadOlder : undefined}
          onEndReachedThreshold={0.2}
          ListFooterComponent={loadingOlder ? (
            <View style={styles.loadingOlderWrap}><ActivityIndicator size="small" color={Colors.muted} /></View>
          ) : null}
          ListEmptyComponent={!msgsLoading ? (
            <View style={styles.emptyChat}>
              <Text style={styles.emptyChatText}>💬</Text>
            </View>
          ) : null}
        />

        {/* Disable the input when the challenge is validated — the chat is
            preserved (read-only) so the conversation history stays intact. */}
        {!isValidated && (
          <ChatInput
            sending={sending}
            mentionContext="challenge"
            mentionChannelId={id}
            onSendText={(text, mentions) => sendText(text, null, mentions)}
            onSendImage={sendImage}
          />
        )}
      </KeyboardAvoidingView>

      {/* Members modal */}
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

      {/* Message long-press action sheet (copy / delete — challenges don't
          support reactions in this cut, same as topic detail). */}
      <MessageActionSheet
        visible={actionSheetMsg !== null}
        reactions={actionSheetMsg?.reactions ?? []}
        onReact={() => {}}
        onCopy={actionSheetMsg?.content ? () => { Clipboard.setStringAsync(actionSheetMsg.content!).catch(() => {}); } : undefined}
        onDelete={(() => {
          if (!actionSheetMsg) return undefined;
          const mine = (account?.id && actionSheetMsg.userId === account.id) || (identity?.guestId && actionSheetMsg.guestId === identity.guestId);
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
                    catch { Alert.alert(i18n.t('deleteFailed', { ns: 'chat' })); }
                  } },
              ],
            );
          } : undefined;
        })()}
        onClose={() => setActionSheetMsg(null)}
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
  navCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  navIcon:   { fontSize: 18, lineHeight: 20 },
  navTitle:  { fontSize: FontSizes.md, fontWeight: '800', color: Colors.text, flexShrink: 1 },

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

  audiencePill: {
    backgroundColor:   'rgba(255,255,255,0.06)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8, paddingVertical: 2,
    borderWidth:       1, borderColor: 'rgba(255,255,255,0.10)',
  },
  audiencePillText: { fontSize: 11, fontWeight: '700', color: Colors.muted, letterSpacing: 0.3 },

  validatedBadge: {
    backgroundColor:   'rgba(34,197,94,0.10)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8, paddingVertical: 2,
    borderWidth:       1, borderColor: 'rgba(34,197,94,0.20)',
  },
  validatedBadgeText: { fontSize: 11, fontWeight: '700', color: '#4ade80', letterSpacing: 0.3 },

  ownerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.xs },
  ownerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm - 2,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: Colors.border,
  },
  ownerBtnPrimary: { backgroundColor: 'rgba(255,122,60,0.10)', borderColor: 'rgba(255,122,60,0.30)' },
  ownerBtnDanger:  { backgroundColor: 'rgba(239,68,68,0.06)',  borderColor: 'rgba(239,68,68,0.20)' },
  ownerBtnText:    { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.text },

  acceptBtn: {
    marginTop: Spacing.xs,
    backgroundColor: '#FF7A3C',
    borderRadius:    Radius.full,
    paddingVertical: Spacing.md,
    alignItems:      'center',
  },
  acceptBtnSecondary: {
    backgroundColor: 'rgba(255,122,60,0.14)',
    borderWidth:     1,
    borderColor:     'rgba(255,122,60,0.30)',
  },
  acceptBtnText: { fontSize: FontSizes.md, fontWeight: '800', color: Colors.white },

  // Members
  membersStrip: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  membersLabel: { fontSize: FontSizes.sm, color: Colors.muted, fontWeight: '600' },

  // Chat
  listContent:      { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: Spacing.md, gap: 4 },
  loadingOlderWrap: { paddingVertical: Spacing.md, alignItems: 'center' },
  emptyChat:        { paddingVertical: 60, alignItems: 'center' },
  emptyChatText:    { fontSize: 32, opacity: 0.3 },

  errorBanner: {
    backgroundColor: 'rgba(239,68,68,0.10)',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  errorBannerText: { fontSize: FontSizes.sm, color: Colors.red },
});
