/**
 * DM conversation screen — redesigned for Hilads visual identity.
 *
 * Two open modes (set by route params):
 *   Notification:  conv param present → open existing conversation by conversationId directly
 *   Profile flow:  no conv param → id is a userId, call findOrCreateDM to resolve thread
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, Image, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, StyleSheet, Platform, KeyboardAvoidingView,
  Animated, Alert, InteractionManager,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useDMThread } from '@/hooks/useDMThread';
import { findOrCreateDM } from '@/api/conversations';
import { useApp } from '@/context/AppContext';
import { track } from '@/services/analytics';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import { isSameDay, formatDateLabel, formatTime } from '@/lib/messageTime';
import type { DmMessage } from '@/types';

// ── Date separator — reused from ChatMessage visual style ─────────────────────

function DateSeparator({ label }: { label: string }) {
  return (
    <View style={sepStyles.row}>
      <View style={sepStyles.line} />
      <Text style={sepStyles.text}>{label}</Text>
      <View style={sepStyles.line} />
    </View>
  );
}

const sepStyles = StyleSheet.create({
  row: {
    flexDirection:     'row',
    alignItems:        'center',
    marginVertical:    18,
    paddingHorizontal: 16,
    gap:               10,
  },
  line: {
    flex:            1,
    height:          1,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  text: {
    fontSize:          11,
    fontWeight:        '600',
    color:             Colors.muted2,
    letterSpacing:     0.5,
    textTransform:     'uppercase',
    backgroundColor:   Colors.bg2,
    paddingHorizontal: 10,
    paddingVertical:   3,
    borderRadius:      999,
    overflow:          'hidden',
  },
});

// ── Avatar color — hash-based, warm palette ───────────────────────────────────

const AVATAR_COLORS = [
  '#C24A38', '#B87228', '#8B5CF6', '#0EA5E9',
  '#E879A0', '#3ddc84', '#F59E0B', '#14B8A6',
];

function avatarColor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// ── Message row ───────────────────────────────────────────────────────────────
// In a 1:1 DM sender names are omitted — position (left/right) makes it obvious.
// Grouping: consecutive messages from the same sender are visually clustered.
//   isFirst = oldest in the group (top of cluster)
//   isLast  = newest in the group (bottom of cluster, shows timestamp)

interface RowProps {
  msg:        DmMessage;
  isMine:     boolean;
  isFirst:    boolean;   // first (oldest) msg in this sender's run
  isLast:     boolean;   // last  (newest) msg in this sender's run
  color:      string;    // avatar accent color for received messages
  initial:    string;
  dateLabel?: string;    // if set, render a date separator above this row
}

function DmRow({ msg, isMine, isFirst, isLast, color, initial, dateLabel }: RowProps) {
  const router = useRouter();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(6)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity,    { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start();
  }, []);

  const isSending = msg.status === 'sending';
  const isFailed  = msg.status === 'failed';

  // Bubble shape: the "tail" corner is only on the first message of each group.
  // Mine (right): bottom-right corner flattened on first.
  // Theirs (left): bottom-left corner flattened on first.
  const bubbleMineShape  = isFirst ? styles.bubbleMineFirst  : undefined;
  const bubbleOtherShape = isFirst ? styles.bubbleOtherFirst : undefined;

  return (
    <>
      {dateLabel && <DateSeparator label={dateLabel} />}
      <Animated.View style={[
        styles.rowWrapper,
        isMine ? styles.rowWrapperMine : styles.rowWrapperOther,
        isFirst ? styles.rowFirst : styles.rowGrouped,
        { opacity, transform: [{ translateY }] },
      ]}>
      {/* Received: small avatar dot to the left, visible only on first of group */}
      {/* Tap avatar → open sender's public profile */}
      {!isMine && (
        <View style={styles.avatarSlot}>
          {isFirst && (
            <TouchableOpacity
              onPress={() => router.push(`/user/${msg.sender_id}` as Parameters<typeof router.push>[0])}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <View style={[styles.avatar, { backgroundColor: color }]}>
                <Text style={styles.avatarText}>{initial}</Text>
              </View>
            </TouchableOpacity>
          )}
        </View>
      )}

      <View style={[styles.bubbleCol, isMine && styles.bubbleColMine]}>
        {msg.type === 'image' && msg.image_url ? (
          <View style={[
            styles.imageBubble,
            isMine  ? styles.bubbleMine  : styles.bubbleOther,
            isMine  ? bubbleMineShape    : bubbleOtherShape,
            isSending && styles.bubbleSending,
            isFailed  && styles.bubbleFailed,
          ]}>
            <Image
              source={{ uri: msg.image_url }}
              style={styles.bubbleImage}
              resizeMode="cover"
            />
          </View>
        ) : (
          <View style={[
            styles.bubble,
            isMine  ? styles.bubbleMine  : styles.bubbleOther,
            isMine  ? bubbleMineShape    : bubbleOtherShape,
            isSending && styles.bubbleSending,
            isFailed  && styles.bubbleFailed,
          ]}>
            <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>
              {msg.content}
            </Text>
          </View>
        )}

        {/* Status / timestamp row — only on last message of group */}
        {isLast && (
          <View style={[styles.metaRow, isMine && styles.metaRowMine]}>
            {isSending && (
              <Text style={styles.metaText}>Sending…</Text>
            )}
            {isFailed && (
              <Text style={styles.metaTextFailed}>Failed · tap to retry</Text>
            )}
            {!isSending && !isFailed && (
              <Text style={styles.metaText}>{formatTime(msg.created_at)}</Text>
            )}
          </View>
        )}
      </View>
    </Animated.View>
    </>
  );
}

// ── Thread — rendered once conversationId is known ────────────────────────────

function DMThread({ conversationId, displayName }: { conversationId: string; displayName: string }) {
  const { account } = useApp();
  const { messages, loading, sending, error, clearError, sendText, sendImage } = useDMThread(conversationId);
  const [text,      setText]      = useState('');
  const [uploading, setUploading] = useState(false);
  const [focused,   setFocused]   = useState(false);

  const color   = avatarColor(displayName);
  const initial = displayName.slice(0, 1).toUpperCase();
  const busy    = sending || uploading;

  function handleSend() {
    const t = text.trim();
    if (!t || busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendText(t);
    setText('');
  }

  async function sendImageUri(uri: string) {
    setUploading(true);
    try {
      await sendImage(uri);
    } finally {
      setUploading(false);
    }
  }

  async function openLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to share images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets[0]?.uri) await sendImageUri(result.assets[0].uri);
  }

  async function openCamera() {
    console.log('[camera/dm] openCamera called');
    try {
      console.log('[camera/dm] requesting permission...');
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      console.log('[camera/dm] permission status:', status);
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow camera access to take photos.');
        return;
      }
      console.log('[camera/dm] launching camera...');
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
      console.log('[camera/dm] result canceled:', result.canceled);
      if (!result.canceled && result.assets[0]?.uri) await sendImageUri(result.assets[0].uri);
    } catch (err) {
      console.error('[camera/dm] launch failed:', String(err));
      Alert.alert('Camera unavailable', 'Could not open the camera. Please try again.');
    }
  }

  function handlePickImage() {
    if (busy) return;
    console.log('[camera/dm] handlePickImage called');
    Alert.alert('Send a photo', undefined, [
      { text: 'Take Photo',          onPress: () => { console.log('[camera/dm] Take Photo tapped'); InteractionManager.runAfterInteractions(() => openCamera()); } },
      { text: 'Choose from Library', onPress: () => InteractionManager.runAfterInteractions(() => openLibrary()) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // Inverted FlatList: index 0 = newest (bottom), index n-1 = oldest (top).
  // "isFirst" = oldest in sender run → avatar shown here.
  // "isLast"  = newest in sender run → timestamp shown here.
  const renderItem = useCallback(({ item, index }: { item: DmMessage; index: number }) => {
    const isMine  = item.sender_id === account?.id;
    const prevMsg = messages[index + 1]; // older message
    const nextMsg = messages[index - 1]; // newer message
    const isFirst = !prevMsg || prevMsg.sender_id !== item.sender_id;
    const isLast  = !nextMsg || nextMsg.sender_id !== item.sender_id;
    // Show date separator when this item starts a new calendar day vs the older message
    const dateLabel = !isSameDay(item.created_at, prevMsg?.created_at)
      ? formatDateLabel(item.created_at)
      : undefined;
    return (
      <DmRow
        msg={item}
        isMine={isMine}
        isFirst={isFirst}
        isLast={isLast}
        color={color}
        initial={initial}
        dateLabel={dateLabel}
      />
    );
  }, [messages, account?.id, color, initial]);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {error && (
        <TouchableOpacity style={styles.errorBanner} onPress={clearError} activeOpacity={0.8}>
          <Text style={styles.errorBannerText}>{error} · tap to dismiss</Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          inverted
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyEmoji}>💬</Text>
              <Text style={styles.emptyTitle}>Start a conversation</Text>
              <Text style={styles.emptySub}>Say hi to {displayName}</Text>
            </View>
          }
        />
      )}

      {/* ── Composer ── */}
      <View style={[styles.composer, focused && styles.composerFocused]}>
        <TouchableOpacity
          style={[styles.imageBtn, busy && styles.imageBtnDisabled]}
          onPress={handlePickImage}
          disabled={busy}
          activeOpacity={0.7}
        >
          {uploading
            ? <ActivityIndicator size="small" color={Colors.accent} />
            : <Ionicons name="image-outline" size={22} color={Colors.text} />
          }
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={`Message ${displayName}…`}
          placeholderTextColor={Colors.muted2}
          multiline
          maxLength={1000}
          returnKeyType="send"
          blurOnSubmit={Platform.OS !== 'ios'}
          onSubmitEditing={Platform.OS !== 'ios' ? handleSend : undefined}
          editable={!busy}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!text.trim() || busy) && styles.sendBtnOff]}
          onPress={handleSend}
          disabled={!text.trim() || busy}
          activeOpacity={0.8}
        >
          {sending
            ? <ActivityIndicator size="small" color={Colors.white} />
            : <Ionicons name="send" size={20} color={text.trim() ? '#fff' : Colors.muted2} />
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────
// Two open modes:
//   Notification flow: conv param is set → open existing conversation directly by conversationId.
//   User-profile flow: no conv param → id is a userId, call findOrCreateDM to get/create thread.

export default function DMThreadScreen() {
  const router = useRouter();
  const { id, name, conv } = useLocalSearchParams<{ id: string; name?: string; conv?: string }>();

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [resolveError,   setResolveError]   = useState<string | null>(null);

  const displayName = name ?? 'Message';
  const color       = avatarColor(displayName);
  const initial     = displayName.slice(0, 1).toUpperCase();

  useEffect(() => {
    console.log('[dm-screen] route params = id:', id, '| name:', name, '| conv:', conv);

    if (conv) {
      // Notification flow: conversationId already known — open directly, no API call needed.
      console.log('[dm-screen] opened from notification');
      console.log('[dm-screen] using existing conversationId, skipping findOrCreateDM');
      console.log('[dm-screen] loading conversation', conv);
      setConversationId(conv);
      track('dm_opened', { conversationId: conv, source: 'notification' });
      return;
    }

    if (!id) return;
    let cancelled = false;
    // User-profile flow: id is a userId — find or create the DM thread.
    console.log('[DM] opening DM → targetUserId:', id, '| name:', displayName);
    findOrCreateDM(id)
      .then(({ conversation }) => {
        if (!cancelled) {
          console.log('[DM] conversationId resolved:', conversation.id);
          setConversationId(conversation.id);
          track('dm_opened', { conversationId: conversation.id, source: 'profile' });
        }
      })
      .catch((err) => {
        console.error('[DM] findOrCreateDM failed:', err);
        if (!cancelled) setResolveError('Could not open this conversation.');
      });
    return () => { cancelled = true; };
  }, [id, conv]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Feather name="chevron-left" size={26} color={Colors.text} />
        </TouchableOpacity>

        <View style={[styles.headerAvatar, { backgroundColor: color + '22', borderColor: color + '55' }]}>
          <Text style={[styles.headerAvatarText, { color }]}>{initial}</Text>
        </View>

        <View style={styles.headerInfo}>
          <Text style={styles.headerName} numberOfLines={1}>{displayName}</Text>
          <Text style={styles.headerSub}>Direct message</Text>
        </View>
      </View>

      {/* ── Body ── */}
      {resolveError ? (
        <View style={styles.center}>
          <Text style={styles.resolveErrorText}>{resolveError}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => router.back()} activeOpacity={0.8}>
            <Text style={styles.retryBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      ) : !conversationId ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : (
        <DMThread conversationId={conversationId} displayName={displayName} />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const AVATAR_SIZE = 28;
const SEND_BTN    = 48;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  flex:      { flex: 1 },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap:               12,
  },
  backBtn: {
    width:           40,
    height:          40,
    borderRadius:    Radius.md,
    backgroundColor: Colors.bg2,
    borderWidth:     1,
    borderColor:     Colors.border,
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
  },
  headerAvatar: {
    width:          44,
    height:         44,
    borderRadius:   Radius.full,
    borderWidth:    1.5,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
  },
  headerAvatarText: { fontWeight: '800', fontSize: FontSizes.md },
  headerInfo: { flex: 1, gap: 1 },
  headerName: {
    fontSize:      FontSizes.md,
    fontWeight:    '700',
    color:         Colors.text,
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: FontSizes.xs,
    color:    Colors.muted2,
  },

  // ── States ──────────────────────────────────────────────────────────────────
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  resolveErrorText: {
    color:      Colors.muted,
    fontSize:   FontSizes.sm,
    textAlign:  'center',
    paddingHorizontal: Spacing.xl,
  },
  retryBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    backgroundColor:   Colors.bg2,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       Colors.border,
  },
  retryBtnText: { color: Colors.text, fontSize: FontSizes.sm, fontWeight: '600' },

  errorBanner: {
    backgroundColor:   Colors.accent2,
    paddingHorizontal: Spacing.md,
    paddingVertical:   8,
  },
  errorBannerText: { color: '#fff', fontSize: FontSizes.xs, textAlign: 'center' },

  // ── Message list ────────────────────────────────────────────────────────────
  listContent: {
    paddingTop:        24,
    paddingBottom:     8,
    paddingHorizontal: 16,
  },

  // ── Row wrapper ─────────────────────────────────────────────────────────────
  rowWrapper: {
    flexDirection: 'row',
    alignItems:    'flex-end',
    maxWidth:      '82%',
  },
  rowWrapperMine:  { alignSelf: 'flex-end' },
  rowWrapperOther: { alignSelf: 'flex-start' },
  rowFirst:   { marginTop: 18 },
  rowGrouped: { marginTop: 3 },

  // ── Avatar slot (received messages only) ────────────────────────────────────
  avatarSlot: {
    width:       AVATAR_SIZE + 6,   // fixed slot keeps bubbles aligned within a run
    alignItems:  'flex-end',
    paddingRight: 6,
    paddingBottom: 2,
  },
  avatar: {
    width:          AVATAR_SIZE,
    height:         AVATAR_SIZE,
    borderRadius:   Radius.full,
    alignItems:     'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 11, fontWeight: '800' },

  // ── Bubble column ────────────────────────────────────────────────────────────
  bubbleCol:     { flexShrink: 1 },
  bubbleColMine: { alignItems: 'flex-end' },

  // ── Bubble ──────────────────────────────────────────────────────────────────
  bubble: {
    borderRadius:      22,
    paddingHorizontal: 18,
    paddingVertical:   12,
    maxWidth:          '100%',
  },
  // Received: warm dark surface with subtle border
  bubbleOther: {
    backgroundColor: Colors.bg3,
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.06)',
  },
  // "Tail" corner on first message of a received group
  bubbleOtherFirst: {
    borderBottomLeftRadius: 5,
  },
  // Sent: brand orange — bright, unmistakably mine
  bubbleMine: {
    backgroundColor: Colors.accent,
    shadowColor:     Colors.accent,
    shadowOffset:    { width: 0, height: 3 },
    shadowOpacity:   0.35,
    shadowRadius:    8,
    elevation:       5,
  },
  // "Tail" corner on first message of a sent group
  bubbleMineFirst: {
    borderBottomRightRadius: 5,
  },
  bubbleSending: { opacity: 0.6 },
  bubbleFailed: {
    borderWidth: 1.5,
    borderColor: 'rgba(248,113,113,0.6)',
    backgroundColor: 'rgba(248,113,113,0.08)',
  },
  bubbleText: {
    fontSize:   15,
    color:      Colors.text,
    lineHeight: 22,
  },
  bubbleTextMine: { color: '#fff', fontWeight: '500' },

  // ── Meta row (timestamp / status) ────────────────────────────────────────────
  metaRow:     { marginTop: 4, paddingHorizontal: 4 },
  metaRowMine: { alignItems: 'flex-end' },
  metaText: {
    fontSize: 11,
    color:    Colors.muted2,
  },
  metaTextFailed: {
    fontSize: 11,
    color:    Colors.red,
  },

  // ── Empty state ──────────────────────────────────────────────────────────────
  emptyWrap: {
    flex:           1,
    justifyContent: 'center',
    alignItems:     'center',
    paddingVertical: Spacing.xxl,
    gap:            8,
  },
  emptyEmoji: { fontSize: 40 },
  emptyTitle: {
    fontSize:   FontSizes.md,
    fontWeight: '600',
    color:      Colors.text,
    textAlign:  'center',
  },
  emptySub: {
    fontSize:  FontSizes.sm,
    color:     Colors.muted,
    textAlign: 'center',
  },

  // ── Composer ─────────────────────────────────────────────────────────────────
  composer: {
    flexDirection:     'row',
    alignItems:        'flex-end',
    paddingHorizontal: 14,
    paddingVertical:   12,
    paddingBottom:     Platform.OS === 'android' ? 12 : 14,
    borderTopWidth:    1,
    borderTopColor:    Colors.border,
    backgroundColor:   Colors.bg,
    gap:               10,
    shadowColor:       '#000',
    shadowOffset:      { width: 0, height: -4 },
    shadowOpacity:     0.22,
    shadowRadius:      10,
    elevation:         8,
  },
  composerFocused: {
    borderTopColor: 'rgba(255,122,60,0.3)',
  },
  imageBtn: {
    width:           SEND_BTN,
    height:          SEND_BTN,
    borderRadius:    Radius.full,
    backgroundColor: Colors.bg2,
    borderWidth:     1,
    borderColor:     Colors.border,
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
  },
  imageBtnDisabled: { opacity: 0.4 },
  input: {
    flex:              1,
    minHeight:         48,
    maxHeight:         130,
    backgroundColor:   Colors.bg2,
    borderRadius:      Radius.full,
    borderWidth:       1.5,
    borderColor:       Colors.border,
    paddingHorizontal: 20,
    paddingTop:        13,
    paddingBottom:     13,
    color:             Colors.text,
    fontSize:          FontSizes.sm,
    lineHeight:        22,
  },
  sendBtn: {
    width:           SEND_BTN,
    height:          SEND_BTN,
    borderRadius:    Radius.full,
    backgroundColor: Colors.accent,
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
    shadowColor:     Colors.accent,
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.5,
    shadowRadius:    10,
    elevation:       8,
  },
  sendBtnOff: {
    backgroundColor: Colors.bg2,
    borderWidth:     1,
    borderColor:     Colors.border,
    shadowOpacity:   0,
    elevation:       0,
  },

  // ── Image bubble ─────────────────────────────────────────────────────────────
  imageBubble: {
    borderRadius:    22,
    overflow:        'hidden',
    maxWidth:        '100%',
    padding:         0,
  },
  bubbleImage: {
    width:  220,
    height: 180,
  },
});
