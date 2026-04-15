import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, ActivityIndicator,
  TouchableOpacity, StyleSheet, KeyboardAvoidingView, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { socket } from '@/lib/socket';
import {
  fetchTopicById, fetchTopicMessages,
  sendTopicMessage, sendTopicImageMessage, markTopicRead,
} from '@/api/topics';
import { useMessages } from '@/hooks/useMessages';
import { ChatMessage } from '@/features/chat/ChatMessage';
import { ChatInput } from '@/features/chat/ChatInput';
import { isSameDay, formatDateLabel } from '@/lib/messageTime';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { Message, Topic } from '@/types';

const CATEGORY_ICONS: Record<string, string> = {
  general: '🗣️', tips: '💡', food: '🍴', drinks: '🍺', help: '🙋', meetup: '👋',
};

export default function TopicChatScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { identity, account, sessionId } = useApp();
  const nickname = account?.display_name ?? identity?.nickname ?? '';

  const [topic, setTopic]   = useState<Topic | null>(null);
  const [topicLoading, setTopicLoading] = useState(true);
  const [shared, setShared] = useState(false);

  async function handleShare() {
    if (!id) return;
    const url = `https://hilads.live/t/${id}`;
    try {
      await Share.share({ message: topic?.title ?? url, url });
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch {
      // dismissed or error — ignore
    }
  }

  // Fetch topic metadata
  useEffect(() => {
    if (!id) return;
    fetchTopicById(id)
      .then(setTopic)
      .catch(() => setTopic(null))
      .finally(() => setTopicLoading(false));
  }, [id]);

  // Mark read on open (fire-and-forget)
  useEffect(() => {
    if (id && identity?.guestId) markTopicRead(id, identity.guestId);
  }, [id, identity?.guestId]);

  const loadFn = useCallback((_opts?: { beforeId?: string }) => fetchTopicMessages(id), [id]);

  const postTextFn = useCallback(
    (content: string): Promise<Message> => {
      if (!identity) return Promise.reject(new Error('Not ready'));
      return sendTopicMessage(id, identity.guestId, nickname, content);
    },
    [id, identity, nickname],
  );

  const postImageFn = useCallback(
    (imageUrl: string): Promise<Message> => {
      if (!identity) return Promise.reject(new Error('Not ready'));
      return sendTopicImageMessage(id, identity.guestId, nickname, imageUrl);
    },
    [id, identity, nickname],
  );

  const { messages, loading: msgsLoading, sending, error: msgError, clearError, sendText, sendImage, reload } = useMessages({
    channelId: id,
    loadFn,
    postTextFn,
    postImageFn,
  });

  // Join the WS topic room while the screen is focused so new messages arrive
  // via the newMessage event (handled by useMessages). Leave on blur so the
  // server can clean up the room when it empties.
  // Fallback poll only runs when WS is disconnected; stops and reloads on reconnect.
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useFocusEffect(useCallback(() => {
    if (id && sessionId) socket.joinTopic(id, sessionId);

    let timer: ReturnType<typeof setInterval> | null = null;

    function startFallbackPoll() {
      if (timer !== null) return;
      timer = setInterval(() => reloadRef.current(), 30_000);
    }

    function stopFallbackPoll() {
      if (timer !== null) { clearInterval(timer); timer = null; }
    }

    // Start immediately if WS is already down; otherwise wait for a disconnect.
    if (!socket.isConnected) startFallbackPoll();

    const offDisconnected = socket.on('disconnected', () => startFallbackPoll());
    const offConnected    = socket.on('connected', () => {
      stopFallbackPoll();
      reloadRef.current(); // catch up on messages missed during the gap
    });

    return () => {
      stopFallbackPoll();
      offDisconnected();
      offConnected();
      if (id && sessionId) socket.leaveTopic(id, sessionId);
    };
  }, [id, sessionId]));

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>

      {/* Header — back | [icon + title] | share */}
      <View style={styles.nav}>
        <TouchableOpacity style={styles.backPill} onPress={() => router.back()} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={18} color={Colors.text} />
          <Text style={styles.backPillText} numberOfLines={1}>Back</Text>
        </TouchableOpacity>

        <View style={styles.navCenter}>
          {topic && (
            <>
              <Text style={styles.navIcon}>{CATEGORY_ICONS[topic.category] ?? '💬'}</Text>
              <Text style={styles.navTitle} numberOfLines={2}>{topic.title}</Text>
            </>
          )}
        </View>

        <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.7}>
          {shared ? (
            <Text style={styles.shareBtnCheck}>✓</Text>
          ) : (
            <Ionicons name="share-outline" size={20} color={Colors.text} />
          )}
        </TouchableOpacity>
      </View>

      {/* Topic info block — description + expiry only (title is in header) */}
      {topicLoading ? (
        <View style={styles.infoBlockLoading}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : topic ? (
        (topic.description || topic.message_count >= 0) ? (
          <View style={styles.infoBlock}>
            {topic.description ? (
              <Text style={styles.infoDesc}>{topic.description}</Text>
            ) : null}
            <Text style={styles.infoExpiry}>⏱ Active for 24 h</Text>
          </View>
        ) : null
      ) : (
        <View style={styles.infoBlockLoading}>
          <Text style={styles.errorText}>Pulse not found or expired</Text>
        </View>
      )}

      {/* Error banner */}
      {msgError && (
        <TouchableOpacity style={styles.errorBanner} onPress={clearError} activeOpacity={0.8}>
          <Text style={styles.errorBannerText}>{msgError} · tap to dismiss</Text>
        </TouchableOpacity>
      )}

      {/* Messages + Input */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <FlatList
          data={messages}
          keyExtractor={(m, i) => m.id ?? String(i)}
          renderItem={({ item, index }) => {
            const olderMsg = messages[index + 1];
            const newerMsg = messages[index - 1];
            const isGrouped =
              !!olderMsg &&
              olderMsg.guestId === item.guestId &&
              olderMsg.type !== 'system' &&
              item.type !== 'system';
            const showTime =
              item.type !== 'system' && (
                !newerMsg ||
                newerMsg.guestId !== item.guestId ||
                newerMsg.type === 'system'
              );
            const dateLabel =
              !isSameDay(item.createdAt, olderMsg?.createdAt)
                ? formatDateLabel(item.createdAt)
                : undefined;
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
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            msgsLoading ? (
              <View style={styles.msgsLoading}>
                <ActivityIndicator color={Colors.muted} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            msgsLoading ? null : (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>No replies yet. Say something! 💬</Text>
              </View>
            )
          }
        />

        <ChatInput
          sending={sending}
          onSendText={sendText}
          onSendImage={sendImage}
          placeholder={
            messages.some(m => m.type !== 'system')
              ? `Reply to the conversation ✨`
              : `Be the first to reply ✨`
          }
        />
      </KeyboardAvoidingView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  flex:      { flex: 1 },

  nav: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   10,
    gap:               8,
  },
  backPill: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               6,
    paddingHorizontal: 16,
    paddingVertical:   11,
    borderRadius:      14,
    backgroundColor:   'rgba(255,255,255,0.08)',
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.12)',
    flexShrink:        0,
  },
  backPillText: {
    fontSize:   FontSizes.md,
    fontWeight: '700',
    color:      Colors.text,
  },
  navCenter: {
    flex:           1,
    flexDirection:  'row',
    alignItems:     'flex-start',
    justifyContent: 'center',
    gap:            6,
  },
  navIcon:  { fontSize: 18, lineHeight: 24, marginTop: 1 },
  navTitle: {
    fontSize:   FontSizes.md,
    fontWeight: '700',
    color:      Colors.text,
    flexShrink: 1,
    textAlign:  'center',
    lineHeight: 22,
  },
  shareBtn: {
    width:           44,
    height:          44,
    flexShrink:      0,
    alignItems:      'center',
    justifyContent:  'center',
    borderRadius:    22,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.10)',
  },
  shareBtnCheck: {
    fontSize:   18,
    color:      '#4ade80',
    fontWeight: '700',
  },

  infoBlock: {
    paddingHorizontal: Spacing.md,
    paddingTop:        4,
    paddingBottom:     16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(96,165,250,0.18)',
    gap:               6,
  },
  infoBlockLoading: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.lg,
    alignItems:        'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  infoDesc:   { fontSize: FontSizes.sm, color: Colors.muted, lineHeight: 20 },
  infoExpiry: { fontSize: FontSizes.xs, color: '#60a5fa', fontWeight: '600' },

  errorBanner:     { backgroundColor: Colors.red, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  errorBannerText: { color: Colors.white, fontSize: FontSizes.xs, textAlign: 'center' },
  errorText:       { color: Colors.red, fontSize: FontSizes.sm, textAlign: 'center' },

  listContent: { paddingVertical: Spacing.sm },
  msgsLoading: { paddingVertical: Spacing.md, alignItems: 'center' },
  emptyWrap:   { paddingHorizontal: Spacing.md, paddingVertical: Spacing.lg, alignItems: 'center' },
  emptyText:   { color: Colors.muted, fontSize: FontSizes.sm, textAlign: 'center' },
});
