import { useCallback, useRef, useState } from 'react';
import {
  View, FlatList, ActivityIndicator, Text,
  TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { useMessages } from '@/hooks/useMessages';
import { fetchMessages, sendMessage, sendImageMessage } from '@/api/channels';
import { ChatMessage } from '@/features/chat/ChatMessage';
import { ChatInput } from '@/features/chat/ChatInput';
import { Colors, FontSizes, Spacing } from '@/constants';
import type { Message, ReplyRef } from '@/types';

export default function CityChatScreen() {
  const router = useRouter();
  const { city, identity, sessionId, account } = useApp();
  const nickname = account?.display_name ?? identity?.nickname ?? '';

  const channelId = city?.channelId ?? '';

  const [replyingTo, setReplyingTo] = useState<ReplyRef | null>(null);
  const replyingToRef = useRef<ReplyRef | null>(null);
  replyingToRef.current = replyingTo;

  const loadFn = useCallback(
    (opts?: { beforeId?: string }) => fetchMessages(channelId, opts),
    [channelId],
  );

  const postTextFn = useCallback(
    (content: string, replyToId?: string | null): Promise<Message> => {
      if (!identity || !sessionId) return Promise.reject(new Error('Not ready'));
      return sendMessage(channelId, sessionId, identity.guestId, nickname, content, replyToId);
    },
    [channelId, identity, sessionId, nickname],
  );

  const postImageFn = useCallback(
    (imageUrl: string): Promise<Message> => {
      if (!identity || !sessionId) return Promise.reject(new Error('Not ready'));
      return sendImageMessage(channelId, sessionId, identity.guestId, nickname, imageUrl);
    },
    [channelId, identity, sessionId, nickname],
  );

  const { messages, loading, loadingOlder, hasMore, sending, error, clearError, sendText, sendImage, loadOlder } = useMessages({
    channelId,
    loadFn,
    postTextFn,
    postImageFn,
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>City Chat</Text>
          {city && <Text style={styles.headerSub}>{city.name}</Text>}
        </View>
      </View>

      {/* Error banner */}
      {error && (
        <TouchableOpacity style={styles.errorBanner} onPress={clearError} activeOpacity={0.8}>
          <Text style={styles.errorText}>{error} · tap to dismiss</Text>
        </TouchableOpacity>
      )}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Message list */}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : (
          <FlatList
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => (
              <ChatMessage
                message={item}
                myGuestId={identity?.guestId}
                onLongPress={(msg) => {
                  if (!msg.id) return;
                  setReplyingTo({ id: msg.id, nickname: msg.nickname, content: msg.content ?? '', type: msg.type });
                }}
              />
            )}
            inverted
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            onEndReached={hasMore ? loadOlder : undefined}
            onEndReachedThreshold={0.2}
            ListFooterComponent={
              loadingOlder ? (
                <View style={styles.loadingOlderWrap}>
                  <ActivityIndicator size="small" color={Colors.muted} />
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>No messages yet. Say hello 👋</Text>
              </View>
            }
          />
        )}

        {/* Composer */}
        <ChatInput
          sending={sending}
          onSendText={(text) => {
            const reply = replyingToRef.current;
            setReplyingTo(null);
            sendText(text, reply);
          }}
          onSendImage={sendImage}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: Colors.bg },
  flex:         { flex: 1 },
  header: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            12,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn:     { padding: 4 },
  backIcon:    { fontSize: 22, color: Colors.text },
  headerTitle: { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
  headerSub:   { fontSize: FontSizes.xs, color: Colors.muted },

  errorBanner:  { backgroundColor: Colors.red, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  errorText:    { color: Colors.white, fontSize: FontSizes.xs, textAlign: 'center' },

  center:       { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingOlderWrap: { paddingVertical: 14, alignItems: 'center' },
  listContent:  { paddingVertical: Spacing.sm },
  emptyWrap:    { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  emptyText:    { color: Colors.muted, fontSize: FontSizes.sm, textAlign: 'center' },
});
