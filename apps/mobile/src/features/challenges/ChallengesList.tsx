import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  View, Text, FlatList, StyleSheet, ScrollView,
  ActivityIndicator, TouchableOpacity, RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  fetchCityChallenges, fetchValidatedChallenges, fetchChallengeInspiration,
  type InspirationExample,
} from '@/api/challenges';
import { ChallengeVersusCard } from '@/components/ChallengeVersusCard';
import { ExampleChallengeCard } from '@/components/ExampleChallengeCard';
import { EmptyCityChallenges } from '@/components/EmptyCityChallenges';
import { ScoringInfoButton } from '@/components/ScoringInfoButton';
import { useApp } from '@/context/AppContext';
import { localizeCityName } from '@/i18n/cityName';
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

// Progressive reveal: render PAGE rows, +PAGE each time the user scrolls to the
// end. The full (filtered) list already lives in memory, so this fires ZERO
// extra network calls - it just windows the FlatList so the screen isn't a
// 200-row dump and stays light.
const PAGE = 5;

/**
 * The full challenges browser - open/validated tabs, mode + type filters,
 * pagination-free list (server caps at 200/100), and a create CTA. Extracted
 * from app/challenge/all.tsx so it can back BOTH the pushed `/challenge/all`
 * route and the CHALLENGES bottom tab (which feeds `channelId` from the active
 * city instead of a route param).
 */
export function ChallengesList({ channelId, headerExtra }: { channelId: string | null; headerExtra?: ReactNode }) {
  const router = useRouter();
  const { t } = useTranslation('challenge');
  const { city } = useApp();
  const currentCityName = localizeCityName(city?.name ?? '') || (city?.name ?? '');

  const [tab,        setTab]        = useState<Tab>('open');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [openList,   setOpenList]   = useState<Challenge[]>([]);
  const [pastList,   setPastList]   = useState<Challenge[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Inspiration ("idea book") for the genuine zero-challenge empty state.
  // Fetched lazily - only once the open tab has loaded empty - so populated
  // cities never pay for it. Re-armed on city change.
  const [inspiration,     setInspiration]     = useState<InspirationExample[]>([]);
  const [inspirationCity, setInspirationCity] = useState<string | null>(null);
  const inspirationTriedRef = useRef(false);

  useEffect(() => {
    // New city → reset so the block re-evaluates for it.
    inspirationTriedRef.current = false;
    setInspiration([]);
    setInspirationCity(null);
  }, [channelId]);

  useEffect(() => {
    if (loading || tab !== 'open' || openList.length > 0 || !channelId) return;
    if (inspirationTriedRef.current) return;
    inspirationTriedRef.current = true;
    let alive = true;
    fetchChallengeInspiration(channelId).then(r => {
      if (!alive) return;
      setInspiration(r.examples);
      setInspirationCity(r.city);
    });
    return () => { alive = false; };
  }, [loading, tab, openList.length, channelId]);

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

  // How many of `data` to actually render. Resets to the first page whenever the
  // visible set changes (tab / filter / city) so we never reveal a stale window.
  const [visibleCount, setVisibleCount] = useState(PAGE);
  useEffect(() => { setVisibleCount(PAGE); }, [tab, typeFilter, modeFilter, channelId]);

  const visibleData = useMemo(() => data.slice(0, visibleCount), [data, visibleCount]);
  const hasMoreLocal = visibleCount < data.length;

  if (!channelId) {
    return <View style={styles.center}><ActivityIndicator color={Colors.accent} size="large" /></View>;
  }

  // Most Local (headerExtra) + filters scroll WITH the feed - only the screen
  // header + intro line above this component stay sticky.
  const listHeader = (
    <View>
      {headerExtra}

      {/* "How to earn points" helper - the challenges browser had no scoring
          affordance (only the channel + NOW did). Labeled pill so it reads
          clearly, not a stray (i). */}
      <View style={styles.scoringRow}>
        <ScoringInfoButton labeled />
      </View>

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
    </View>
  );

  return (
    <View style={styles.root}>
      <FlatList
        data={visibleData}
        keyExtractor={c => c.id}
        ListHeaderComponent={listHeader}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          // Reveal one more page. Math.min clamps so repeated end-reached fires
          // (FlatList emits a few) can't overshoot the real list length.
          if (hasMoreLocal) setVisibleCount(v => Math.min(v + PAGE, data.length));
        }}
        ListFooterComponent={hasMoreLocal ? (
          <View style={styles.footer}><ActivityIndicator size="small" color={Colors.muted} /></View>
        ) : null}
        renderItem={({ item }) => (
          <View style={styles.cardWrap}>
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
          </View>
        )}
        ListEmptyComponent={
          loading
            ? <View style={styles.center}><ActivityIndicator color={Colors.accent} size="large" /></View>
            : (
              <View style={styles.empty}>
                <Text style={styles.emptyEmoji}>{tab === 'open' ? '🔥' : '✓'}</Text>
                <Text style={styles.emptyTitle}>
                  {tab === 'open' ? t('noOpen', { defaultValue: 'No active challenges yet' }) : t('noValidated', { defaultValue: 'No validated challenges yet' })}
                </Text>

                {/* Shared lead-with-action hero - identical to the home
                    screen's zero-challenge state. */}
                {tab === 'open' && (
                  <EmptyCityChallenges
                    city={currentCityName}
                    onCreate={() => router.push('/challenge/create' as never)}
                  />
                )}

                {/* Inspiration "idea book" - inert example cards from the
                    most-active other city. Only in the open-tab zero state,
                    only when at least one example came back. */}
                {tab === 'open' && inspiration.length > 0 && (
                  <View style={styles.inspirationBlock}>
                    <Text style={styles.inspirationHeading}>{t('inspiration.heading')}</Text>
                    <Text style={styles.inspirationSub}>{t('inspiration.sub')}</Text>
                    {inspiration.map((ex, i) => (
                      <ExampleChallengeCard
                        key={`${ex.id}-${i}`}
                        example={ex}
                        sourceCity={inspirationCity ?? ''}
                        currentCity={currentCityName}
                        onOpen={() => {
                          track('challenge_inspiration_open', { source: 'empty_state' });
                          router.push(`/challenge/${ex.id}` as never);
                        }}
                        onCreate={() => {
                          track('challenge_inspiration_create', { source: 'empty_state' });
                          router.push('/challenge/create' as never);
                        }}
                      />
                    ))}
                  </View>
                )}
              </View>
            )
        }
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.accent} />
        }
      />

      {/* Create a challenge - fixed below the scroll. Guests gated in the route. */}
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

  scoringRow: {
    flexDirection:     'row',
    justifyContent:    'flex-end',
    paddingHorizontal: Spacing.md,
    paddingTop:        Spacing.sm,
  },

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

  listContent: { paddingBottom: Spacing.xl * 2 },
  footer:      { paddingVertical: Spacing.md },
  cardWrap:    { paddingHorizontal: Spacing.md, marginBottom: Spacing.sm },
  center: { justifyContent: 'center', alignItems: 'center', paddingVertical: Spacing.xl },
  empty:  { justifyContent: 'center', alignItems: 'center', padding: Spacing.xl, gap: Spacing.sm },
  emptyEmoji: { fontSize: 44 },
  emptyTitle: { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text, textAlign: 'center' },

  inspirationBlock: {
    width:     '100%',
    marginTop: Spacing.lg,
    gap:       Spacing.sm,
  },
  inspirationHeading: { fontSize: FontSizes.md, fontWeight: '800', color: Colors.text, textAlign: 'left' },
  inspirationSub:     { fontSize: 12, fontWeight: '600', color: Colors.muted, textAlign: 'left', marginBottom: 2 },

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
