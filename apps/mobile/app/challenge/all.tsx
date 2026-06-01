import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  ActivityIndicator, TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { fetchCityChallenges, fetchValidatedChallenges } from '@/api/challenges';
import { ChallengeCard } from '@/components/ChallengeCard';
import { track } from '@/services/analytics';
import type { Challenge } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

type Tab = 'open' | 'validated';

export default function AllChallengesScreen() {
  const router = useRouter();
  const { t } = useTranslation('challenge');
  const params = useLocalSearchParams<{ channelId?: string }>();
  const channelId = typeof params.channelId === 'string' ? params.channelId : null;

  const [tab,        setTab]        = useState<Tab>('open');
  const [openList,   setOpenList]   = useState<Challenge[]>([]);
  const [pastList,   setPastList]   = useState<Challenge[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!channelId) return;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      // Always fetch BOTH so swapping tabs is instant. Each list is capped at
      // ~50/30 server-side already; no risk of unbounded read.
      const [openData, pastData] = await Promise.all([
        fetchCityChallenges(channelId, 200),
        fetchValidatedChallenges(channelId, { limit: 100 }),
      ]);
      setOpenList(openData);
      setPastList(pastData);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [channelId]);

  useEffect(() => { load(); }, [load]);

  const data = tab === 'open' ? openList : pastList;

  if (!channelId) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><Text style={styles.errorText}>Missing channelId</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('createTitle')}</Text>
        </View>
      </View>

      {/* Tab pills — Open (default, active strip) vs Validated (archive) */}
      <View style={styles.tabBar}>
        {(['open', 'validated'] as const).map(v => (
          <TouchableOpacity
            key={v}
            style={[styles.tabPill, tab === v && styles.tabPillActive]}
            onPress={() => setTab(v)}
            activeOpacity={0.75}
          >
            <Text style={[styles.tabPillText, tab === v && styles.tabPillTextActive]}>
              {v === 'open' ? t('openBadge') : t('validatedBadge')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && !refreshing ? (
        <View style={styles.center}><ActivityIndicator color={Colors.accent} size="large" /></View>
      ) : data.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>{tab === 'open' ? '🔥' : '✓'}</Text>
          <Text style={styles.emptyTitle}>
            {tab === 'open' ? t('noOpen', { defaultValue: 'No active challenges yet' }) : t('noValidated', { defaultValue: 'No validated challenges yet' })}
          </Text>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={c => c.id}
          renderItem={({ item }) => (
            <ChallengeCard
              challenge={item}
              onPress={() => {
                track('challenge_opened', { challengeId: item.id, source: 'see_all' });
                router.push(`/challenge/${item.id}` as never);
              }}
            />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.accent} />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    minHeight:         56,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  headerCenter: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  headerTitle:  { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text, letterSpacing: -0.3 },

  tabBar: {
    flexDirection:     'row',
    paddingHorizontal: Spacing.md,
    paddingTop:        Spacing.sm,
    paddingBottom:     Spacing.sm,
    gap:               Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tabPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm - 2,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       Colors.border,
    backgroundColor:   Colors.bg2,
  },
  tabPillActive: {
    borderColor:     '#FF7A3C',
    backgroundColor: 'rgba(255,122,60,0.10)',
  },
  tabPillText: { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.muted },
  tabPillTextActive: { color: '#FF7A3C' },

  list:   { padding: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.xl * 2 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty:  { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl, gap: Spacing.sm },
  emptyEmoji: { fontSize: 44 },
  emptyTitle: { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  errorText:  { fontSize: FontSizes.md, color: Colors.red },
});
