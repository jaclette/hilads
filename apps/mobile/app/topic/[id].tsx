import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, ActivityIndicator,
  TouchableOpacity, StyleSheet, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import {
  fetchTopicById, fetchTopicMessages,
  sendTopicMessage, markTopicRead,
} from '@/api/topics';
import { useMessages } from '@/hooks/useMessages';
import { ChatMessage } from '@/features/chat/ChatMessage';
import { ChatInput } from '@/features/chat/ChatInput';
import { isSameDay, formatDateLabel } from '@/lib/messageTime';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { Message, Topic } from '@/types';

const CATEGORY_ICONS: Record<string, string> = {
  general: '💬', tips: '💡', food: '🍴', drinks: '🍺', help: '🙋', meetup: '👋',
};

export default function TopicChatScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { identity, account } = useApp();
  const nickname = account?.display_name ?? identity?.nickname ?? '';

  const [topic, setTopic]   = useState<Topic | null>(null);
  const [topicLoading, setTopicLoading] = useState(true);

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
    (_imageUrl: string): Promise<Message> => Promise.reject(new Error('Images not supported in topics yet')),
    [],
  );

  const { messages, loading: msgsLoading, sending, error: msgError, clearError, sendText, reload } = useMessages({
    channelId: id,
    loadFn,
    postTextFn,
    postImageFn,
  });

  // Poll every 5s since there's no WS room join for topics yet
  useEffect(() => {
    const timer = setInterval(reload, 5_000);
    return () => clearInterval(timer);
  }, [reload]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>

      {/* Nav */}
      <View style={styles.nav}>
        <TouchableOpacity style={styles.backPill} onPress={() => router.back()} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={18} color={Colors.text} />
          <Text style={styles.backPillText} numberOfLines={1}>Back</Text>
        </TouchableOpacity>
      </View>

      {/* Topic info block */}
      {topicLoading ? (
        <View style={styles.infoBlockLoading}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : topic ? (
        <View style={styles.infoBlock}>
          <View style={styles.infoTitleRow}>
            <Text style={styles.infoIcon}>{CATEGORY_ICONS[topic.category] ?? '💬'}</Text>
            <Text style={styles.infoTitle} numberOfLines={3}>{topic.title}</Text>
          </View>
          {topic.description ? (
            <Text style={styles.infoDesc}>{topic.description}</Text>
          ) : null}
          <Text style={styles.infoExpiry}>⏱ Active for 24 h · {topic.message_count} {topic.message_count === 1 ? 'reply' : 'replies'}</Text>
        </View>
      ) : (
        <View style={styles.infoBlockLoading}>
          <Text style={styles.errorText}>Topic not found or expired</Text>
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
          onSendImage={() => {}}
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
    maxWidth:          180,
  },
  backPillText: {
    fontSize:   FontSizes.md,
    fontWeight: '700',
    color:      Colors.text,
  },

  infoBlock: {
    paddingHorizontal: Spacing.md,
    paddingTop:        4,
    paddingBottom:     16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(96,165,250,0.18)',
    gap:               8,
  },
  infoBlockLoading: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.lg,
    alignItems:        'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  infoTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  infoIcon:     { fontSize: 28, marginTop: 2 },
  infoTitle: {
    flex:          1,
    fontSize:      FontSizes.xl,
    fontWeight:    '800',
    color:         Colors.text,
    letterSpacing: -0.4,
    lineHeight:    30,
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
