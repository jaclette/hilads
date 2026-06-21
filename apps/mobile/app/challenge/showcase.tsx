import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, ActivityIndicator, TouchableOpacity, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { canAccessProfile } from '@/lib/profileAccess';
import { fetchChallengeShowcase, type ShowcaseItem } from '@/api/challenges';
import { ShowcaseCard } from '@/features/challenges/ShowcaseCard';
import { ShowcasePreviewSheet } from '@/features/challenges/ShowcasePreviewSheet';
import { LeaderboardCityPickerSheet } from '@/features/challenge/LeaderboardCityPickerSheet';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

const PAGE = 5;

/**
 * Public "Success challenges" showcase - completed, well-rated challenges for
 * discovery. Global by default, with an optional city filter. Open to guests.
 */
export default function ShowcaseScreen() {
  const router = useRouter();
  const { t } = useTranslation('challenge');
  const { account } = useApp();

  const [items,      setItems]      = useState<ShowcaseItem[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore,setLoadingMore]= useState(false);
  const [hasMore,    setHasMore]    = useState(false);
  const [cityId,     setCityId]     = useState<number | null>(null);
  const [cityName,   setCityName]   = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [preview,    setPreview]    = useState<ShowcaseItem | null>(null);

  // Synchronous re-entrancy guard. FlatList can fire onEndReached several times
  // before the loadingMore state flips, so a state-only check would let 2-3
  // duplicate page fetches slip through. The ref blocks them on the same tick.
  const loadingMoreRef = useRef(false);

  const load = useCallback(async () => {
    const res = await fetchChallengeShowcase({ cityId, limit: PAGE });
    setItems(res.items);
    setHasMore(res.hasMore);
    setLoading(false);
    setRefreshing(false);
  }, [cityId]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || items.length === 0) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const before = items[items.length - 1]?.completed_at;
      const res = await fetchChallengeShowcase({ cityId, limit: PAGE, before });
      // Dedup by id: the sort (photo-first, then completed_at) can overlap the
      // completed_at cursor, so a page may re-return an already-shown card.
      setItems(prev => {
        const seen = new Set(prev.map(i => i.id));
        return [...prev, ...res.items.filter(i => !seen.has(i.id))];
      });
      setHasMore(res.hasMore);
    } finally {
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [cityId, hasMore, items]);

  const openProfile = (userId: string) => {
    if (userId === account?.id) { router.push('/(tabs)/me'); return; }
    if (!canAccessProfile(account)) { router.push('/auth-gate'); return; }
    router.push({ pathname: '/user/[id]', params: { id: userId } });
  };

  // "Try this challenge" - seed a fresh challenge from this success story's
  // title + type. Creation is registered-only, so guests hit the auth gate.
  const tryChallenge = (it: ShowcaseItem) => {
    setPreview(null);
    if (!account) { router.push('/auth-gate'); return; }
    router.push({ pathname: '/challenge/create', params: { title: it.title, type: it.challenge_type } } as never);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.nav}>
        <TouchableOpacity style={styles.backPill} onPress={() => router.back()} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={18} color={Colors.text} />
          <Text style={styles.backPillText}>{t('back', { ns: 'common' })}</Text>
        </TouchableOpacity>
        <View style={styles.navCenter}>
          <Text style={styles.navTitle} numberOfLines={1}>{t('showcase.title')}</Text>
        </View>
        <View style={{ width: 70 }} />
      </View>

      {/* City filter */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.cityPill, cityId !== null && styles.cityPillActive]}
          onPress={() => setPickerOpen(true)}
          activeOpacity={0.8}
        >
          <Text style={[styles.cityPillText, cityId !== null && styles.cityPillTextActive]} numberOfLines={1}>
            🌍 {cityName ?? t('showcase.allCities')}
          </Text>
          <Ionicons name="chevron-down" size={14} color={cityId !== null ? '#FF7A3C' : Colors.muted} />
        </TouchableOpacity>
        {cityId !== null && (
          <TouchableOpacity onPress={() => { setCityId(null); setCityName(null); }} activeOpacity={0.7}>
            <Text style={styles.clearText}>{t('showcase.clearCity', { defaultValue: 'Clear' })}</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Colors.accent} /></View>
      ) : items.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyEmoji}>✨</Text>
          <Text style={styles.emptyTitle}>{t('showcase.empty.title')}</Text>
          <Text style={styles.emptyBody}>{t('showcase.empty.body')}</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
          renderItem={({ item }) => (
            <ShowcaseCard
              item={item}
              onOpen={() => setPreview(item)}
              onAvatar={openProfile}
            />
          )}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={loadingMore ? (
            <View style={styles.footer}><ActivityIndicator size="small" color={Colors.muted} /></View>
          ) : null}
        />
      )}

      <ShowcasePreviewSheet
        item={preview}
        onClose={() => setPreview(null)}
        onTry={tryChallenge}
        onAvatar={openProfile}
      />

      <LeaderboardCityPickerSheet
        visible={pickerOpen}
        selectedChannelId={cityId !== null ? `city_${cityId}` : null}
        onClose={() => setPickerOpen(false)}
        onSelect={(channelId, city) => {
          const m = /^city_(\d+)$/.exec(channelId);
          setCityId(m ? Number(m[1]) : null);
          setCityName(city?.name ?? null);
          setPickerOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },

  nav: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backPill:     { flexDirection: 'row', alignItems: 'center', width: 70 },
  backPillText: { fontSize: FontSizes.sm, color: Colors.text, fontWeight: '600' },
  navCenter:    { flex: 1, alignItems: 'center' },
  navTitle:     { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text, letterSpacing: -0.3 },

  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  cityPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border, maxWidth: '70%',
  },
  cityPillActive:     { backgroundColor: 'rgba(255,122,60,0.12)', borderColor: 'rgba(255,122,60,0.5)' },
  cityPillText:       { fontSize: 13, fontWeight: '700', color: Colors.muted, flexShrink: 1 },
  cityPillTextActive: { color: '#FF7A3C' },
  clearText:          { fontSize: 13, fontWeight: '600', color: Colors.muted },

  list:   { paddingVertical: Spacing.sm },
  footer: { paddingVertical: Spacing.md },

  emptyWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg, gap: 12 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: FontSizes.lg, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  emptyBody:  { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center' },
});
