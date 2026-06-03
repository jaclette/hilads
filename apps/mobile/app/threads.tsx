import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, ActivityIndicator, TouchableOpacity, StyleSheet, RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { socket } from '@/lib/socket';
import { fetchMyAcceptances } from '@/api/challenges';
import { avatarColor } from '@/lib/avatarColors';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { ChallengeThreadSummary, ChallengeType } from '@/types';

const TYPE_ICONS: Record<ChallengeType, string> = {
  food:    '🍜',
  place:   '📍',
  culture: '🎭',
  help:    '🤝',
};

/**
 * My challenge threads (PR2). Every relationship I'm in — as creator OR
 * acceptor — appears as a row. Sorted by last message activity. Tap a row
 * to open the 1:1 thread chat.
 *
 * Reached from /me (settings) → "My challenge threads", or via deep link
 * from a push notification (planned).
 */
export default function ThreadsListScreen() {
  const router = useRouter();
  const { t } = useTranslation('challenge');
  const { account } = useApp();

  const [threads, setThreads] = useState<ChallengeThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!account?.id) { setThreads([]); setLoading(false); return; }
    try {
      const data = await fetchMyAcceptances();
      setThreads(data);
    } catch {
      setThreads([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [account?.id]);

  useEffect(() => { load(); }, [load]);

  // Refresh whenever the screen regains focus (new accepts pushed via WS
  // will also trigger via the listener below, but focus catches the case
  // where the user backs out of a thread).
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Live updates: new acceptance accepted somewhere, or an existing one
  // cancelled. Cheap reload (bounded by /me/acceptances LIMIT 100).
  useEffect(() => {
    const off1 = socket.on('challenge_accepted',              () => load());
    const off2 = socket.on('challenge_acceptance_cancelled',  () => load());
    return () => { off1(); off2(); };
  }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  if (!account?.id) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header title={t('threads.title')} onBack={() => router.back()} t={t} />
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyEmoji}>🔒</Text>
          <Text style={styles.emptyTitle}>{t('threads.guestGate.title')}</Text>
          <Text style={styles.emptyBody}>{t('threads.guestGate.body')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header title={t('threads.title')} onBack={() => router.back()} t={t} />

      {loading && threads.length === 0 ? (
        <View style={styles.center}><ActivityIndicator color={Colors.accent} /></View>
      ) : threads.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyEmoji}>🤝</Text>
          <Text style={styles.emptyTitle}>{t('threads.empty.title')}</Text>
          <Text style={styles.emptyBody}>{t('threads.empty.body')}</Text>
        </View>
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(t) => t.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
          renderItem={({ item }) => {
            const icon    = TYPE_ICONS[item.challenge_type] ?? '🔥';
            const cp      = item.counterparty;
            const preview = item.last_message_content
              ? item.last_message_content.length > 80 ? `${item.last_message_content.slice(0, 80)}…` : item.last_message_content
              : t('threads.noMessagesYet');
            return (
              <TouchableOpacity
                style={styles.row}
                activeOpacity={0.75}
                onPress={() => router.push(`/challenge/${item.challenge_id}` as never)}
              >
                <View style={[styles.avatar, { backgroundColor: avatarColor(cp.id) }]}>
                  {cp.thumbAvatarUrl ? (
                    <Image
                      source={{ uri: cp.thumbAvatarUrl }}
                      style={StyleSheet.absoluteFill}
                      cachePolicy="memory-disk"
                      contentFit="cover"
                      transition={120}
                    />
                  ) : (
                    <Text style={styles.avatarLetter}>{(cp.displayName?.[0] ?? '?').toUpperCase()}</Text>
                  )}
                </View>
                <View style={styles.body}>
                  <View style={styles.headerRow}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.i_am_creator && <Text style={styles.crown}>👑 </Text>}
                      {cp.displayName}
                    </Text>
                  </View>
                  <Text style={styles.challengeTitle} numberOfLines={1}>{icon} {item.challenge_title}</Text>
                  <Text style={styles.preview} numberOfLines={1}>{preview}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.muted2} />
              </TouchableOpacity>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}
    </SafeAreaView>
  );
}

function Header({ title, onBack, t }: { title: string; onBack: () => void; t: (k: string, opts?: { ns?: string }) => string }) {
  return (
    <View style={styles.nav}>
      <TouchableOpacity style={styles.backPill} onPress={onBack} activeOpacity={0.75}>
        <Ionicons name="chevron-back" size={18} color={Colors.text} />
        <Text style={styles.backPillText}>{t('back', { ns: 'common' })}</Text>
      </TouchableOpacity>
      <View style={styles.navCenter}>
        <Text style={styles.navTitle} numberOfLines={1}>{title}</Text>
      </View>
      <View style={{ width: 70 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },

  nav: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
  },
  backPillText: { color: Colors.text, fontSize: FontSizes.sm, fontWeight: '700' },
  navCenter:    { flex: 1, alignItems: 'center' },
  navTitle:     { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text, letterSpacing: -0.3 },

  list: { paddingVertical: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarLetter: { color: '#fff', fontWeight: '700', fontSize: 18 },
  body:    { flex: 1, gap: 2, minWidth: 0 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  name:    { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
  crown:   { color: '#FF7A3C', fontWeight: '800' },
  challengeTitle: { fontSize: FontSizes.sm, color: Colors.muted },
  preview: { fontSize: FontSizes.sm, color: Colors.muted2 },
  sep:     { height: 1, backgroundColor: Colors.border, marginLeft: Spacing.md + 48 + Spacing.md },

  emptyWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg, gap: 12 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: FontSizes.lg, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  emptyBody:  { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center' },
});
