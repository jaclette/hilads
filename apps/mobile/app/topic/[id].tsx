import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, ActivityIndicator,
  TouchableOpacity, StyleSheet, KeyboardAvoidingView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { socket } from '@/lib/socket';
import { shareLink } from '@/lib/shareLink';
import {
  fetchTopicById, fetchTopicMessages,
  sendTopicMessage, sendTopicImageMessage, markTopicRead,
  resolveHangoutJoinRequest, requestToJoinHangout, deleteTopic, fetchHangoutParticipants,
} from '@/api/topics';
import { AttendeeAvatars } from '@/components/AttendeeAvatars';
import { MembersSheet } from '@/components/MembersSheet';
import { useMessages } from '@/hooks/useMessages';
import { ChatMessage } from '@/features/chat/ChatMessage';
import { ChatInput } from '@/features/chat/ChatInput';
import { isSameDay, formatDateLabel } from '@/lib/messageTime';
import { formatExpiresIn } from '@/lib/expiry';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { Message, Topic, UserDTO } from '@/types';

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
  const [participants, setParticipants] = useState<UserDTO[]>([]);
  const [membersOpen,  setMembersOpen]  = useState(false);

  const loadParticipants = useCallback(() => {
    if (!id) return;
    fetchHangoutParticipants(id).then(d => setParticipants(d.participants)).catch(() => {});
  }, [id]);
  const [shared, setShared] = useState(false);
  const [joinState, setJoinState] = useState<'idle' | 'requested' | 'in'>('idle');
  // Members-only gate: true once the server returns 403 on the message load
  // (non-member / pending requester). Flips back to false the moment a member
  // accepts and the next load succeeds.
  const [gated, setGated] = useState(false);

  const handleRequestToJoin = useCallback(async () => {
    const res = await requestToJoinHangout(id).catch(() => null);
    if (!res) return;
    setJoinState(res.status === 'already_participant' ? 'in' : 'requested');
  }, [id]);

  // Owner-only edit/delete (CTA lives in the hangout chat).
  const isOwner = !!(account?.id && topic?.created_by && account.id === topic.created_by);

  const handleEdit = useCallback(() => {
    if (!topic) return;
    router.push({
      pathname: '/topic/create',
      params: { editId: id, title: topic.title, description: topic.description ?? '', category: topic.category },
    });
  }, [id, topic, router]);

  const handleDelete = useCallback(() => {
    Alert.alert('Delete hangout?', 'This ends the hangout for everyone. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          if (!identity) return;
          try {
            await deleteTopic(id, identity.guestId);
            router.back();
          } catch {
            Alert.alert('Could not delete', 'Please try again.');
          }
        },
      },
    ]);
  }, [id, identity, router]);

  async function handleShare() {
    if (!id) return;
    const url   = `https://hilads.live/t/${id}`;
    const title = topic?.title ? `💬 ${topic.title}` : 'Conversation on Hilads';
    const message = topic?.title
      ? `New conversation: "${topic.title}" — jump in on Hilads.`
      : `Jump into the conversation on Hilads.`;
    try {
      await shareLink({ title, message, url });
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
    loadParticipants();
  }, [id, loadParticipants]);

  // Mark read on open (fire-and-forget)
  useEffect(() => {
    if (id && identity?.guestId) markTopicRead(id, identity.guestId);
  }, [id, identity?.guestId]);

  const loadFn = useCallback(async (opts?: { beforeId?: string }) => {
    const res = await fetchTopicMessages(id, opts);
    setGated(!!res.forbidden);
    // Restore the "Requested" CTA if the server says a request is still pending,
    // so navigating away and back doesn't reset it to "Request to join".
    if (res.forbidden && res.hasPendingRequest) setJoinState('requested');
    return res;
  }, [id]);

  // Accept/Reject a join request. The backend is first-write-wins and
  // re-broadcasts the resolved feed item over WS, so every participant's card
  // (including this one) updates via useMessages' join_request upsert. An
  // already-resolved race returns gracefully — nothing to show the user.
  const handleResolveJoinRequest = useCallback((requestId: string, action: 'accept' | 'reject') => {
    resolveHangoutJoinRequest(id, requestId, action)
      .then(() => { if (action === 'accept') loadParticipants(); }) // new member joined
      .catch(() => { /* WS/refetch reconciles */ });
  }, [id, loadParticipants]);

  const postTextFn = useCallback(
    (content: string, _replyToId?: string | null, mentions?: import('@/types').MentionRef[]): Promise<Message> => {
      if (!identity) return Promise.reject(new Error('Not ready'));
      return sendTopicMessage(id, identity.guestId, nickname, content, mentions);
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

  const { messages, loading: msgsLoading, loadingOlder, hasMore, sending, error: msgError, clearError, sendText, sendImage, loadOlder, reload } = useMessages({
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
    // Refresh topic metadata on focus so an owner's edit shows immediately
    // after returning from the edit screen.
    if (id) fetchTopicById(id).then(setTopic).catch(() => {});

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
    };
  }, [id, sessionId]));

  // Join the WS topic room ONLY as a confirmed member. The WS server can't
  // verify membership (no DB), so a gated/pending user must not join — otherwise
  // they'd receive live message broadcasts despite the HTTP 403. Leaves on gate.
  useEffect(() => {
    if (gated || !id || !sessionId) return;
    socket.joinTopic(id, sessionId);
    return () => socket.leaveTopic(id, sessionId);
  }, [id, sessionId, gated]);

  // While gated (request pending), re-check membership periodically so the
  // conversation unlocks the moment a member accepts — no manual refresh needed.
  // (A tapped acceptance push re-opens the screen and re-loads too.)
  useEffect(() => {
    if (!gated || !account) return;
    const t = setInterval(() => { reloadRef.current(); }, 15_000);
    return () => clearInterval(t);
  }, [gated, account]);

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
            <Text style={styles.infoExpiry}>⏱ {formatExpiresIn(topic.expires_at) ?? 'Active for 24 h'}</Text>
            {isOwner && (
              <View style={styles.ownerRow}>
                <TouchableOpacity style={styles.ownerBtn} onPress={handleEdit} activeOpacity={0.8}>
                  <Ionicons name="create-outline" size={15} color={Colors.text} />
                  <Text style={styles.ownerBtnText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.ownerBtn, styles.ownerBtnDanger]} onPress={handleDelete} activeOpacity={0.8}>
                  <Ionicons name="trash-outline" size={15} color={Colors.red} />
                  <Text style={[styles.ownerBtnText, { color: Colors.red }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : null
      ) : (
        <View style={styles.infoBlockLoading}>
          <Text style={styles.errorText}>Hangout not found or expired</Text>
        </View>
      )}

      {/* Members strip — same as an event's "going" strip. Members only. */}
      {!gated && participants.length > 0 && (
        <TouchableOpacity style={styles.membersStrip} activeOpacity={0.75} onPress={() => setMembersOpen(true)}>
          <AttendeeAvatars
            preview={participants.slice(0, 5).map(p => ({ id: p.id, displayName: p.displayName, thumbAvatarUrl: p.thumbAvatarUrl ?? p.avatarUrl }))}
            total={participants.length}
            borderColor={Colors.bg}
          />
          <Text style={styles.membersLabel}>
            {participants.length === 1 ? `${participants[0].displayName} is in` : `${participants.length} in this hangout`}
          </Text>
          <Text style={styles.membersSeeAll}>See all →</Text>
        </TouchableOpacity>
      )}

      {/* Error banner */}
      {msgError && (
        <TouchableOpacity style={styles.errorBanner} onPress={clearError} activeOpacity={0.8}>
          <Text style={styles.errorBannerText}>{msgError} · tap to dismiss</Text>
        </TouchableOpacity>
      )}

      {/* Members-only gate — pending requesters cannot read or post. */}
      {gated ? (
        <View style={styles.gatedWrap}>
          <Text style={styles.gatedEmoji}>🔒</Text>
          <Text style={styles.gatedTitle}>Members-only hangout</Text>
          <Text style={styles.gatedSub}>
            {joinState === 'requested'
              ? "Request pending — you'll be able to join the conversation once a member accepts."
              : 'Request to join to see the conversation and chat.'}
          </Text>
          {joinState !== 'requested' && (
            <TouchableOpacity style={styles.gatedBtn} activeOpacity={0.85} onPress={handleRequestToJoin}>
              <Text style={styles.joinBtnText}>Request to join</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
      /* Messages + Input */
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
                onResolveJoinRequest={handleResolveJoinRequest}
              />
            );
          }}
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
            ) : (!hasMore && !msgsLoading && messages.length > 0) ? (
              <View style={styles.loadingOlderWrap}>
                <Text style={styles.beginningText}>Beginning of conversation</Text>
              </View>
            ) : null
          }
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
          mentionContext="topic"
          mentionChannelId={id}
          onSendText={(text, mentions) => sendText(text, null, mentions)}
          onSendImage={sendImage}
          placeholder={
            messages.some(m => m.type !== 'system')
              ? `Reply to the conversation ✨`
              : `Be the first to reply ✨`
          }
        />
      </KeyboardAvoidingView>
      )}

      <MembersSheet
        visible={membersOpen}
        loading={false}
        participants={participants}
        count={participants.length}
        noun="in this hangout"
        onClose={() => setMembersOpen(false)}
        onSelect={(uid) => { setMembersOpen(false); router.push({ pathname: '/user/[id]', params: { id: uid } }); }}
      />

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
  ownerRow:   { flexDirection: 'row', gap: 8, marginTop: 8 },
  ownerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  ownerBtnDanger:  { borderColor: 'rgba(248,113,113,0.3)', backgroundColor: 'rgba(248,113,113,0.08)' },
  ownerBtnText:    { fontSize: FontSizes.sm, fontWeight: '600', color: Colors.text },

  membersStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: Spacing.md, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  membersLabel:  { flex: 1, fontSize: FontSizes.sm, color: Colors.muted, fontWeight: '500' },
  membersSeeAll: { fontSize: FontSizes.sm, color: Colors.accent, fontWeight: '700' },
  joinBtn: {
    marginTop:       10,
    alignSelf:       'flex-start',
    backgroundColor: Colors.accent,
    borderRadius:    Radius.full,
    paddingHorizontal: 16,
    paddingVertical:   8,
  },
  joinBtnDone: { backgroundColor: 'rgba(255,255,255,0.08)' },
  joinBtnText: { color: '#fff', fontWeight: '700', fontSize: FontSizes.sm },

  gatedWrap: {
    flex:              1,
    alignItems:        'center',
    justifyContent:    'center',
    paddingHorizontal: Spacing.xl,
    gap:               10,
  },
  gatedEmoji: { fontSize: 44 },
  gatedTitle: { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  gatedSub:   { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
  gatedBtn: {
    marginTop:         8,
    backgroundColor:   Colors.accent,
    borderRadius:      Radius.full,
    paddingHorizontal: 20,
    paddingVertical:   11,
  },

  errorBanner:     { backgroundColor: Colors.red, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  errorBannerText: { color: Colors.white, fontSize: FontSizes.xs, textAlign: 'center' },
  errorText:       { color: Colors.red, fontSize: FontSizes.sm, textAlign: 'center' },

  listContent: { paddingVertical: Spacing.sm },
  msgsLoading: { paddingVertical: Spacing.md, alignItems: 'center' },
  loadingOlderWrap: { paddingVertical: 14, alignItems: 'center' },
  beginningText: { fontSize: FontSizes.xs, color: Colors.muted2 },
  emptyWrap:   { paddingHorizontal: Spacing.md, paddingVertical: Spacing.lg, alignItems: 'center' },
  emptyText:   { color: Colors.muted, fontSize: FontSizes.sm, textAlign: 'center' },
});
