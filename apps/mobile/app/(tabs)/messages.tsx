import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, FontSizes, Spacing } from '@/constants';

// Messages (DMs + event chats) — requires registered account.
// Full implementation: Phase 2.

export default function MessagesScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>💬 Messages</Text>
      </View>

      <View style={styles.center}>
        <Text style={styles.icon}>💬</Text>
        <Text style={styles.emptyTitle}>No messages yet</Text>
        <Text style={styles.emptySubtitle}>
          Sign in to send direct messages and get notified about event chats.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  headerTitle: { fontSize: FontSizes.lg, fontWeight: '700', color: Colors.text },
  center: {
    flex:           1,
    justifyContent: 'center',
    alignItems:     'center',
    paddingHorizontal: Spacing.xl,
    gap:            Spacing.sm,
  },
  icon:          { fontSize: 40, marginBottom: Spacing.sm },
  emptyTitle:    { fontSize: FontSizes.md, fontWeight: '600', color: Colors.text, textAlign: 'center' },
  emptySubtitle: { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
});
