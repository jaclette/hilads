import { useState, useEffect } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, StyleSheet, Platform, KeyboardAvoidingView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useDMThread } from '@/hooks/useDMThread';
import { findOrCreateDM } from '@/api/conversations';
import { useApp } from '@/context/AppContext';
import { track } from '@/services/analytics';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { DmMessage } from '@/types';

// ── Avatar — hash-based color, same palette as People here ───────────────────

const AVATAR_PALETTE = [
  '#C24A38', '#B87228', '#3ddc84', '#8B5CF6',
  '#0EA5E9', '#E879A0', '#F59E0B', '#14B8A6',
];

function avatarColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

// ── Message row ───────────────────────────────────────────────────────────────
// Own messages: orange gradient (web: linear-gradient(135deg, #FF7A3C, #C24A38))
// Other messages: dark surface bubble

function DmRow({ msg, isMine }: { msg: DmMessage; isMine: boolean }) {
  const isSending = msg.status === 'sending';
  const isFailed  = msg.status === 'failed';
  return (
    <View style={[styles.row, isMine && styles.rowMine, isSending && styles.rowSending]}>
      {!isMine && <Text style={styles.senderName}>{msg.sender_name}</Text>}
      {isMine ? (
        <>
          <View style={[styles.bubble, styles.bubbleMine, isFailed && styles.bubbleFailed]}>
            <Text style={[styles.bubbleText, styles.bubbleTextMine]}>{msg.content}</Text>
          </View>
          {isFailed && <Text style={styles.failedLabel}>Failed to send</Text>}
        </>
      ) : (
        <View style={[styles.bubble, styles.bubbleOther]}>
          <Text style={styles.bubbleText}>{msg.content}</Text>
        </View>
      )}
    </View>
  );
}

// ── Thread — only rendered once conversationId is resolved ────────────────────

function DMThread({ conversationId }: { conversationId: string }) {
  const { account } = useApp();
  const { messages, loading, sending, error, clearError, sendText } = useDMThread(conversationId);
  const [text,      setText]      = useState('');
  const [focused,   setFocused]   = useState(false);

  function handleSend() {
    const t = text.trim();
    if (!t || sending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendText(t);
    setText('');
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {error && (
        <TouchableOpacity style={styles.errorBanner} onPress={clearError} activeOpacity={0.8}>
          <Text style={styles.errorText}>{error} · tap to dismiss</Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <DmRow msg={item} isMine={item.sender_id === account?.id} />
          )}
          inverted
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>Say hello! 👋</Text>
            </View>
          }
        />
      )}

      {/* Composer — matches web .input-bar */}
      <View style={styles.composer}>
        <TextInput
          style={[styles.input, focused && styles.inputFocused]}
          value={text}
          onChangeText={setText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Message…"
          placeholderTextColor={Colors.muted2}
          multiline
          maxLength={1000}
          returnKeyType="send"
          blurOnSubmit={Platform.OS !== 'ios'}
          onSubmitEditing={Platform.OS !== 'ios' ? handleSend : undefined}
          editable={!sending}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnOff]}
          onPress={handleSend}
          disabled={!text.trim() || sending}
          activeOpacity={0.8}
        >
          {sending
            ? <ActivityIndicator size="small" color={Colors.white} />
            : <Feather name="send" size={24} color={text.trim() ? Colors.white : Colors.muted} />
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────
// `id` is a userId — call POST /conversations/direct to get/create conversationId first.

export default function DMThreadScreen() {
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [resolveError,   setResolveError]   = useState<string | null>(null);

  const displayName = name ?? 'Message';
  const color       = avatarColor(displayName);
  const initial     = displayName.slice(0, 1).toUpperCase();

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    console.log('[DM] opening DM → targetUserId:', id, '| name:', displayName);
    findOrCreateDM(id)
      .then(({ conversation }) => {
        if (!cancelled) {
          console.log('[DM] conversationId resolved:', conversation.id);
          setConversationId(conversation.id);
          track('dm_opened', { conversationId: conversation.id });
        }
      })
      .catch((err) => {
        console.error('[DM] findOrCreateDM failed:', err);
        if (!cancelled) setResolveError('Could not open this conversation.');
      });
    return () => { cancelled = true; };
  }, [id]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* Header — web: back button + avatar + name */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Feather name="chevron-left" size={22} color={Colors.text} />
        </TouchableOpacity>

        {/* Avatar circle — same color system as People here */}
        <View style={[styles.avatar, { backgroundColor: color + '28', borderColor: color + '60' }]}>
          <Text style={[styles.avatarText, { color }]}>{initial}</Text>
        </View>

        <Text style={styles.headerName} numberOfLines={1}>{displayName}</Text>
      </View>

      {resolveError ? (
        <View style={styles.center}>
          <Text style={styles.resolveErrorText}>{resolveError}</Text>
        </View>
      ) : !conversationId ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <DMThread conversationId={conversationId} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  flex:      { flex: 1 },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               12,
    paddingHorizontal: Spacing.md,
    paddingVertical:   12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width:           40,
    height:          40,
    borderRadius:    12,
    backgroundColor: Colors.bg2,
    borderWidth:     1,
    borderColor:     Colors.border,
    alignItems:      'center',
    justifyContent:  'center',
  },
  avatar: {
    width:          38,
    height:         38,
    borderRadius:   Radius.full,
    borderWidth:    1,
    alignItems:     'center',
    justifyContent: 'center',
  },
  avatarText:  { fontWeight: '700', fontSize: FontSizes.md },
  headerName:  { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text, flex: 1 },

  // ── States ──────────────────────────────────────────────────────────────────
  errorBanner:      { backgroundColor: Colors.red, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  errorText:        { color: Colors.white, fontSize: FontSizes.xs, textAlign: 'center' },
  resolveErrorText: { color: Colors.muted, fontSize: FontSizes.sm },
  center:           { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // ── Messages ─────────────────────────────────────────────────────────────────
  listContent: { paddingVertical: Spacing.md, paddingHorizontal: 4 },
  emptyWrap:   { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  emptyText:   { color: Colors.muted, fontSize: FontSizes.sm },

  row: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   6,
    alignItems:        'flex-start',
  },
  rowMine:    { alignItems: 'flex-end' },
  rowSending: { opacity: 0.65 },
  senderName: { fontSize: FontSizes.xs, color: Colors.muted, marginBottom: 5, marginLeft: 8 },

  // Bubble base — shared geometry
  bubble: {
    maxWidth:          '80%',
    borderRadius:      24,
    paddingHorizontal: 20,
    paddingVertical:   14,
  },
  // Other: visible warm dark surface — clearly distinct from bg (#0d0b09)
  bubbleOther: {
    backgroundColor:        '#2d2416',
    borderBottomLeftRadius: 6,
  },
  // Mine: flat orange — replace with LinearGradient after native rebuild
  bubbleMine: {
    backgroundColor:         '#FF7A3C',
    borderBottomRightRadius: 6,
    // Orange glow (iOS shadow; Android uses elevation below)
    shadowColor:    '#FF7A3C',
    shadowOffset:   { width: 0, height: 3 },
    shadowOpacity:  0.4,
    shadowRadius:   10,
    elevation:      5,
  },
  bubbleText:     { fontSize: 15, color: Colors.text, lineHeight: 23 },
  bubbleTextMine: { color: '#fff', fontWeight: '500' },
  bubbleFailed: {
    borderWidth: 1.5,
    borderColor: 'rgba(248,113,113,0.55)',
  },
  failedLabel: {
    fontSize:    11,
    color:       Colors.red,
    marginTop:   4,
    marginRight: 8,
  },

  // ── Composer — web: .input-bar ───────────────────────────────────────────────
  composer: {
    flexDirection:     'row',
    alignItems:        'flex-end',
    paddingHorizontal: Spacing.sm,
    paddingVertical:   12,
    borderTopWidth:    1,
    borderTopColor:    Colors.border,
    backgroundColor:   Colors.bg,
    gap:               10,
  },
  input: {
    flex:              1,
    minHeight:         54,
    maxHeight:         140,
    backgroundColor:   Colors.bg2,
    borderRadius:      Radius.full,
    borderWidth:       1.5,
    borderColor:       Colors.border,
    paddingHorizontal: 20,
    paddingTop:        17,
    paddingBottom:     17,
    color:             Colors.text,
    fontSize:          FontSizes.sm,
  },
  inputFocused: {
    borderColor: Colors.accent,
  },
  // Active: solid orange + strong glow  |  Off: visible dark surface, not invisible
  sendBtn: {
    width:           56,
    height:          56,
    borderRadius:    Radius.full,
    backgroundColor: '#FF7A3C',
    justifyContent:  'center',
    alignItems:      'center',
    flexShrink:      0,
    shadowColor:    '#FF7A3C',
    shadowOffset:   { width: 0, height: 4 },
    shadowOpacity:  0.55,
    shadowRadius:   12,
    elevation:      8,
  },
  sendBtnOff: {
    backgroundColor: '#2d2416',
    borderWidth:     1,
    borderColor:     '#3d3020',
    shadowOpacity:   0,
    elevation:       0,
  },
});
