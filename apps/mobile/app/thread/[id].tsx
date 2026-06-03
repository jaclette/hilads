import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, ActivityIndicator,
  TouchableOpacity, StyleSheet, KeyboardAvoidingView, Alert, AppState,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { socket } from '@/lib/socket';
import {
  fetchMyAcceptances, cancelAcceptance,
  fetchThreadMessages, sendThreadMessage, sendThreadImageMessage,
} from '@/api/challenges';
import { avatarColor } from '@/lib/avatarColors';
import { useMessages } from '@/hooks/useMessages';
import { ChatMessage } from '@/features/chat/ChatMessage';
import { ChatInput } from '@/features/chat/ChatInput';
import { MessageActionSheet } from '@/features/chat/MessageActionSheet';
import * as Clipboard from 'expo-clipboard';
import i18n from '@/i18n';
import { isSameDay, formatDateLabel } from '@/lib/messageTime';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { ChallengeThreadSummary, Message } from '@/types';

/**
 * Per-acceptance thread chat (PR2). 1:1 channel between the challenge creator
 * and an acceptor (channels.type='challenge_thread'). Loaded by thread_channel_id
 * (the URL param `id`).
 *
 * Header carries the challenge title + counterparty name. Cancel button only
 * appears in phase='accepted' (PR3+ phases lock cancel, server returns 409).
 */
export default function ThreadChatScreen() {
  const router = useRouter();
  const { t } = useTranslation('challenge');
  const { id: threadChannelId } = useLocalSearchParams<{ id: string }>();
  const { identity, account, sessionId } = useApp();

  const [summary, setSummary]           = useState<ChallengeThreadSummary | null>(null);
  const [summaryLoading, setLoading]    = useState(true);
  const [cancelBusy, setCancelBusy]     = useState(false);
  const [actionSheetMsg, setActionSheetMsg] = useState<Message | null>(null);

  // ── Load the thread summary (via /me/acceptances). Cheap: one round trip,
  // bounded by my total relationships. Stored client-side; refreshed on focus.
  const loadSummary = useCallback(() => {
    if (!threadChannelId || !account?.id) return;
    fetchMyAcceptances()
      .then(threads => {
        const found = threads.find(thr => thr.thread_channel_id === threadChannelId);
        setSummary(found ?? null);
      })
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [threadChannelId, account?.id]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  // ── Messages — same hook + WS join pattern as challenge detail chat ─────
  const loadFn = useCallback(
    (opts?: { beforeId?: string }) => fetchThreadMessages(threadChannelId, opts),
    [threadChannelId],
  );
  const postTextFn = useCallback(
    (content: string): Promise<Message> => sendThreadMessage(threadChannelId, content),
    [threadChannelId],
  );
  const postImageFn = useCallback(
    (imageUrl: string): Promise<Message> => sendThreadImageMessage(threadChannelId, imageUrl),
    [threadChannelId],
  );
  const { messages, loading: msgsLoading, loadingOlder, hasMore, sending,
          error: msgError, clearError, sendText, sendImage, loadOlder, reload,
          deleteMessage } = useMessages({
    channelId:   threadChannelId,
    loadFn,
    postTextFn,
    postImageFn,
  });

  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useFocusEffect(useCallback(() => {
    loadSummary();
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
    const sync = () => {
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
  }, [loadSummary]));

  useEffect(() => {
    if (!threadChannelId || !sessionId) return;
    socket.joinChallengeThread(threadChannelId, sessionId);
    return () => socket.leaveChallengeThread(threadChannelId, sessionId);
  }, [threadChannelId, sessionId]);

  // If the OTHER party cancels (server pushes to my user-room), bounce out.
  useEffect(() => {
    const off = socket.on('challenge_acceptance_cancelled', (data: Record<string, unknown>) => {
      const payload = data.payload as { threadChannelId?: string } | undefined;
      if (payload?.threadChannelId === threadChannelId) {
        Alert.alert(t('thread.cancelledByOther.title'), t('thread.cancelledByOther.body'));
        router.back();
      }
    });
    return off;
  }, [threadChannelId, router, t]);

  // ── Cancel acceptance ──────────────────────────────────────────────────────
  const handleCancel = useCallback(() => {
    if (!summary || cancelBusy) return;
    Alert.alert(
      summary.i_am_creator ? t('thread.cancel.creatorTitle') : t('thread.cancel.acceptorTitle'),
      t('thread.cancel.body'),
      [
        { text: t('cancel', { ns: 'common' }), style: 'cancel' },
        {
          text: t('thread.cancel.confirm'),
          style: 'destructive',
          onPress: async () => {
            setCancelBusy(true);
            try {
              await cancelAcceptance(summary.id);
              router.back();
            } catch {
              Alert.alert(t('thread.cancel.failed'));
            } finally {
              setCancelBusy(false);
            }
          },
        },
      ],
    );
  }, [summary, cancelBusy, router, t]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (summaryLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><ActivityIndicator color={Colors.accent} /></View>
      </SafeAreaView>
    );
  }

  if (!summary) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.nav}>
          <TouchableOpacity style={styles.backPill} onPress={() => router.back()} activeOpacity={0.75}>
            <Ionicons name="chevron-back" size={18} color={Colors.text} />
            <Text style={styles.backPillText}>{t('back', { ns: 'common' })}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.center}><Text style={styles.errorText}>{t('thread.notFound')}</Text></View>
      </SafeAreaView>
    );
  }

  const counterparty = summary.counterparty;
  const canCancel    = summary.phase === 'accepted';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header — back | counterparty + challenge title | cancel (when allowed) */}
      <View style={styles.nav}>
        <TouchableOpacity style={styles.backPill} onPress={() => router.back()} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={18} color={Colors.text} />
          <Text style={styles.backPillText} numberOfLines={1}>{t('back', { ns: 'common' })}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navCenter}
          activeOpacity={0.75}
          onPress={() => router.push({ pathname: '/user/[id]', params: { id: counterparty.id } } as never)}
        >
          <View style={[styles.headerAvatar, { backgroundColor: avatarColor(counterparty.id) }]}>
            {counterparty.thumbAvatarUrl ? (
              <Image
                source={{ uri: counterparty.thumbAvatarUrl }}
                style={StyleSheet.absoluteFill}
                cachePolicy="memory-disk"
                contentFit="cover"
                transition={120}
              />
            ) : (
              <Text style={styles.headerAvatarLetter}>
                {(counterparty.displayName?.[0] ?? '?').toUpperCase()}
              </Text>
            )}
          </View>
          <View style={styles.navTitleWrap}>
            <Text style={styles.navTitle} numberOfLines={1}>{counterparty.displayName}</Text>
            <Text style={styles.navSubtitle} numberOfLines={1}>{summary.challenge_title}</Text>
          </View>
        </TouchableOpacity>
        {canCancel && (
          <TouchableOpacity style={styles.headerActionBtn} onPress={handleCancel} activeOpacity={0.75} disabled={cancelBusy}>
            {cancelBusy
              ? <ActivityIndicator size="small" color={Colors.muted} />
              : <Ionicons name="close" size={18} color={Colors.muted} />}
          </TouchableOpacity>
        )}
      </View>

      {/* Error banner */}
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
              <Text style={styles.emptyChatHello}>👋</Text>
              <Text style={styles.emptyChatText}>{t('thread.empty')}</Text>
            </View>
          ) : null}
        />

        <ChatInput
          sending={sending}
          onSendText={(text) => sendText(text, null)}
          onSendImage={sendImage}
        />
      </KeyboardAvoidingView>

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
  navCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minWidth: 0 },
  headerAvatar: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  headerAvatarLetter: { color: '#fff', fontWeight: '700', fontSize: 14 },
  navTitleWrap: { flex: 1, minWidth: 0 },
  navTitle:    { fontSize: FontSizes.md, fontWeight: '800', color: Colors.text },
  navSubtitle: { fontSize: 11, fontWeight: '600', color: Colors.muted, marginTop: 1 },
  headerActionBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
  },

  listContent:      { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: Spacing.md, gap: 4 },
  loadingOlderWrap: { paddingVertical: Spacing.md, alignItems: 'center' },
  emptyChat:        { paddingVertical: 60, alignItems: 'center', gap: 8 },
  emptyChatHello:   { fontSize: 36 },
  emptyChatText:    { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center', paddingHorizontal: Spacing.lg },

  errorBanner: {
    backgroundColor: 'rgba(239,68,68,0.10)',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  errorBannerText: { fontSize: FontSizes.sm, color: Colors.red },
});
