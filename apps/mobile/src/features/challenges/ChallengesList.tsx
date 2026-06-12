import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, ScrollView,
  ActivityIndicator, TouchableOpacity, RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { fetchCityChallenges, fetchValidatedChallenges } from '@/api/challenges';
import { ChallengeVersusCard } from '@/components/ChallengeVersusCard';
import { track } from '@/services/analytics';
import type { Challenge, ChallengeType } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

type Tab = 'open' | 'validated';
type TypeFilter = 'all' | ChallengeType;
const TYPE_FILTERS: { key: TypeFilter; emoji: string }[] = [
  { key: 'all',     emoji: '✨' },
  { key: 'food',    emoji: '🍜' },
  { key: 'place',   emoji: '📍' },
  { key: 'culture', emoji: '🎭' },
  { key: 'help',    emoji: '🤝' },
];

type ModeFilter = 'all' | 'local' | 'international';
const MODE_FILTERS: { key: ModeFilter; emoji: string }[] = [
  { key: 'all',           emoji: '✨' },
  { key: 'local',         emoji: '🏙️' },
  { key: 'international', emoji: '🌐' },
];

/**
 * The full challenges browser - open/validated tabs, mode + type filters,
 * pagination-free list (server caps at 200/100), and a create CTA. Extracted
 * from app/challenge/all.tsx so it can back BOTH the pushed `/challenge/all`
 * route and the CHALLENGES bottom tab (which feeds `channelId` from the active
 * city instead of a route param).
 */
export function ChallengesList({ channelId }: { channelId: string | null }) {
  const router = useRouter();
  const { t } = useTranslation('challenge');

  const [tab,        setTab]        = useState<Tab>('open');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [openList,   setOpenList]   = useState<Challenge[]>([]);
  const [pastList,   setPastList]   = useState<Challenge[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!channelId) return;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
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

  const dataRaw = tab === 'open' ? openList : pastList;
  const data = useMemo(
    () => {
      let pool = dataRaw;
      if (modeFilter !== 'all') pool = pool.filter(c => (c.mode ?? 'local') === modeFilter);
      if (typeFilter !== 'all') pool = pool.filter(c => c.challenge_type === typeFilter);
      return pool;
    },
    [dataRaw, typeFilter, modeFilter],
  );

  if (!channelId) {
    return <View style={styles.center}><ActivityIndicator color={Colors.accent} size="large" /></View>;
  }

  return (
    <View style={styles.root}>
      {/* Tab pills - Open (default) vs Validated (archive) */}
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

      {/* Mode sub-filter - All / Local / International */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typeChipsRow}>
        {MODE_FILTERS.map(({ key, emoji }) => {
          const active = modeFilter === key;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.typeChip, active && styles.typeChipActive]}
              onPress={() => setModeFilter(key)}
              activeOpacity={0.75}
            >
              <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>
                {emoji} {key === 'all' ? t('modeFilter.all') : t(`mode.${key}`)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Type sub-filter chips - all / food / place / culture / help */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typeChipsRow}>
        {TYPE_FILTERS.map(({ key, emoji }) => {
          const active = typeFilter === key;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.typeChip, active && styles.typeChipActive]}
              onPress={() => setTypeFilter(key)}
              activeOpacity={0.75}
            >
              <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>
                {emoji} {key === 'all' ? t('typeFilter.all') : t(`tp.${key}`)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

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
            <ChallengeVersusCard
              challenge={item}
              animated
              onPress={() => {
                track('challenge_opened', { challengeId: item.id, source: 'challenges_tab' });
                router.push(`/challenge/${item.id}` as never);
              }}
              onAcceptPress={() => {
                track('challenge_opened', { challengeId: item.id, source: 'challenges_tab_open_slot' });
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

      {/* Create a challenge - the only create entry now that the CreateSheet
          chooser is gone. Guests are gated to /auth-gate inside the route. */}
      <TouchableOpacity
        style={styles.createCta}
        activeOpacity={0.85}
        onPress={() => router.push('/challenge/create' as never)}
        accessibilityRole="button"
      >
        <Text style={styles.createCtaText}>{t('createCta')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

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
  tabPillText:       { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.muted },
  tabPillTextActive: { color: '#FF7A3C' },

  typeChipsRow: {
    paddingHorizontal: Spacing.md,
    paddingTop:        Spacing.sm,
    paddingBottom:     Spacing.sm,
    gap:               6,
    alignItems:        'center',
  },
  typeChip: {
    paddingHorizontal: 12,
    paddingVertical:   7,
    minHeight:         32,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.10)',
    backgroundColor:   'rgba(255,255,255,0.04)',
    alignItems:        'center',
    justifyContent:    'center',
  },
  typeChipActive: {
    borderColor:     'rgba(255,122,60,0.45)',
    backgroundColor: 'rgba(255,122,60,0.14)',
  },
  typeChipText:       { fontSize: 12, lineHeight: 16, fontWeight: '700', color: Colors.muted, letterSpacing: -0.2 },
  typeChipTextActive: { color: '#FF7A3C' },

  list:   { padding: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.xl * 2 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty:  { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl, gap: Spacing.sm },
  emptyEmoji: { fontSize: 44 },
  emptyTitle: { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text, textAlign: 'center' },

  createCta: {
    marginHorizontal: Spacing.md,
    marginBottom:     Spacing.md,
    paddingVertical:  14,
    borderRadius:     14,
    alignItems:       'center',
    justifyContent:   'center',
    backgroundColor:  'rgba(255,122,60,0.16)',
    borderWidth:      1,
    borderColor:      'rgba(255,122,60,0.35)',
  },
  createCtaText: { color: Colors.accent, fontSize: 15, fontWeight: '800' },
});
