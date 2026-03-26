import { useState, useEffect } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, StyleSheet, Platform, KeyboardAvoidingView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useDMThread } from '@/hooks/useDMThread';
import { useApp } from '@/context/AppContext';
import { track } from '@/services/analytics';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { DmMessage } from '@/types';

// ── Message row ───────────────────────────────────────────────────────────────

function DmRow({ msg, isMine }: { msg: DmMessage; isMine: boolean }) {
  return (
    <View style={[styles.row, isMine && styles.rowMine]}>
      {!isMine && <Text style={styles.senderName}>{msg.sender_name}</Text>}
      <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleOther]}>
        <Text style={styles.bubbleText}>{msg.content}</Text>
      </View>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function DMThreadScreen() {
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { account } = useApp();

  const { messages, loading, sending, error, clearError, sendText } = useDMThread(id);

  useEffect(() => {
    if (id) track('dm_opened', { conversationId: id });
  }, [id]);

  const [text, setText] = useState('');

  function handleSend() {
    const t = text.trim();
    if (!t || sending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendText(t);
    setText('');
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerName} numberOfLines={1}>
          {name ?? 'Message'}
        </Text>
      </View>

      {/* Error */}
      {error && (
        <TouchableOpacity style={styles.errorBanner} onPress={clearError} activeOpacity={0.8}>
          <Text style={styles.errorText}>{error} · tap to dismiss</Text>
        </TouchableOpacity>
      )}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Messages */}
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

        {/* Composer */}
        <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
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
              : <Text style={styles.sendIcon}>↑</Text>
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  flex:      { flex: 1 },

  header: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               12,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn:    { padding: 4 },
  backIcon:   { fontSize: 22, color: Colors.text },
  headerName: { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text, flex: 1 },

  errorBanner: { backgroundColor: Colors.red, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  errorText:   { color: Colors.white, fontSize: FontSizes.xs, textAlign: 'center' },

  center:      { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingVertical: Spacing.sm },
  emptyWrap:   { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  emptyText:   { color: Colors.muted, fontSize: FontSizes.sm },

  row: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   2,
    alignItems:        'flex-start',
  },
  rowMine: { alignItems: 'flex-end' },
  senderName: { fontSize: FontSizes.xs, color: Colors.muted, marginBottom: 2, marginLeft: 4 },
  bubble: {
    maxWidth:     '80%',
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.sm,
    paddingVertical:   6,
  },
  bubbleOther:  { backgroundColor: Colors.bg3, borderBottomLeftRadius: Radius.sm },
  bubbleMine:   { backgroundColor: Colors.accent, borderBottomRightRadius: Radius.sm },
  bubbleText:   { fontSize: FontSizes.sm, color: Colors.text, lineHeight: 20 },

  composer: {
    flexDirection:     'row',
    alignItems:        'flex-end',
    paddingHorizontal: Spacing.sm,
    paddingVertical:   Spacing.sm,
    borderTopWidth:    1,
    borderTopColor:    Colors.border,
    backgroundColor:   Colors.bg,
    gap:               Spacing.xs,
  },
  input: {
    flex:              1,
    minHeight:         40,
    maxHeight:         120,
    backgroundColor:   Colors.bg2,
    borderRadius:      Radius.lg,
    borderWidth:       1,
    borderColor:       Colors.border,
    paddingHorizontal: Spacing.sm,
    paddingTop:        10,
    paddingBottom:     10,
    color:             Colors.text,
    fontSize:          FontSizes.sm,
  },
  sendBtn: {
    width:           40,
    height:          40,
    borderRadius:    Radius.full,
    backgroundColor: Colors.accent,
    justifyContent:  'center',
    alignItems:      'center',
  },
  sendBtnOff: { backgroundColor: Colors.bg3 },
  sendIcon:   { fontSize: 18, color: Colors.white, fontWeight: '700' },
});
