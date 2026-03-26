import { useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Image,
  ActivityIndicator, RefreshControl, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { useConversations } from '@/hooks/useConversations';
import { UpgradePrompt } from '@/features/auth/UpgradePrompt';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { Conversation } from '@/types';

// ── Conversation row ──────────────────────────────────────────────────────────

function ConversationRow({ convo, onPress }: { convo: Conversation; onPress: () => void }) {
  const initials = convo.other_display_name.slice(0, 2).toUpperCase();

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      {/* Avatar */}
      {convo.other_photo_url ? (
        <Image source={{ uri: convo.other_photo_url }} style={styles.avatar} />
      ) : (
        <View style={styles.avatarFallback}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
      )}

      {/* Content */}
      <View style={styles.rowContent}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowName, convo.has_unread && styles.rowNameUnread]}>
            {convo.other_display_name}
          </Text>
          {convo.last_message_at && (
            <Text style={styles.rowTime}>
              {new Date(convo.last_message_at).toLocaleTimeString([], {
                hour: '2-digit', minute: '2-digit',
              })}
            </Text>
          )}
        </View>
        {convo.last_message && (
          <Text style={[styles.rowPreview, convo.has_unread && styles.rowPreviewUnread]} numberOfLines={1}>
            {convo.last_message}
          </Text>
        )}
      </View>

      {/* Unread indicator */}
      {convo.has_unread && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function MessagesScreen() {
  const router = useRouter();
  const { account } = useApp();
  const { conversations, loading, error, reload } = useConversations();

  const handleOpen = useCallback((convo: Conversation) => {
    router.push({
      pathname: '/dm/[id]',
      params: { id: convo.id, name: convo.other_display_name },
    });
  }, [router]);

  // Guest: show upgrade prompt
  if (!account) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>💬 Messages</Text>
        </View>
        <UpgradePrompt
          title="Messages are for members"
          subtitle="Create a free account to send direct messages and stay connected."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>💬 Messages</Text>
      </View>

      {loading && conversations.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={reload} activeOpacity={0.8}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <ConversationRow convo={item} onPress={() => handleOpen(item)} />
          )}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} tintColor={Colors.accent} />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyIcon}>💬</Text>
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptySub}>
                Connect with people you meet in the city.
              </Text>
            </View>
          }
          contentContainerStyle={conversations.length === 0 ? styles.flex1 : undefined}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  flex1:     { flex: 1 },

  header: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSizes.lg, fontWeight: '700', color: Colors.text },

  center: {
    flex:            1,
    justifyContent:  'center',
    alignItems:      'center',
    padding:         Spacing.xl,
    gap:             Spacing.sm,
  },
  errorText: { fontSize: FontSizes.sm, color: Colors.red },
  retryBtn: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.bg3, borderRadius: Radius.md,
  },
  retryText:  { color: Colors.accent, fontWeight: '600', fontSize: FontSizes.sm },
  emptyIcon:  { fontSize: 40, marginBottom: Spacing.sm },
  emptyTitle: { fontSize: FontSizes.md, fontWeight: '600', color: Colors.text, textAlign: 'center' },
  emptySub:   { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center', lineHeight: 20 },

  row: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    gap:               Spacing.sm,
  },
  avatar:        { width: 44, height: 44, borderRadius: Radius.full },
  avatarFallback: {
    width: 44, height: 44, borderRadius: Radius.full,
    backgroundColor: Colors.bg3, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.muted },
  rowContent: { flex: 1, gap: 3 },
  rowTop:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowName:    { fontSize: FontSizes.sm, fontWeight: '500', color: Colors.text },
  rowNameUnread: { fontWeight: '700', color: Colors.white },
  rowTime:    { fontSize: FontSizes.xs, color: Colors.muted2 },
  rowPreview: { fontSize: FontSizes.xs, color: Colors.muted, lineHeight: 16 },
  rowPreviewUnread: { color: Colors.text },

  unreadDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: Colors.accent,
  },
  separator: { height: 1, backgroundColor: Colors.border, marginLeft: 44 + Spacing.md + Spacing.sm },
});
