import { useEffect, useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import Animated, { FadeIn, LinearTransition, useReducedMotion } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { FlagSticker, themeColor, tint } from '@/ui/joy';
import { shortCityName } from '@/i18n/cityName';
import { fetchRanks, type CitiesRanks } from '@/api/ranks';
import { markNotificationTypesRead } from '@/api/notifications';
import { patchNotifCounts, refreshNotifCounts, useNotifCounts } from '@/features/notifications/counts';
import { MEDAL_EMOJI } from './parts';

const GOLD = themeColor('sip');

/**
 * "🏁 Today's race" on Today (V6): the three leading cities with their photo
 * counts, my city's position, "See ranks". Refreshed every minute; a city
 * overtaking another slides into its place.
 */
export function TodayRace({ refreshKey }: { refreshKey: number }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { city } = useApp();
  const reduced = useReducedMotion();
  const [data, setData] = useState<CitiesRanks | null>(null);
  const cityId = city?.channelId ? Number(String(city.channelId).replace('city_', '')) || null : null;

  // The race refreshes every minute while Today is the tab shown (not from a tab you left).
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return undefined;
    let alive = true;
    const load = () => fetchRanks('cities', { period: 'today', cityId }).then(d => { if (alive) setData(d); }).catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [refreshKey, cityId, focused]);

  const top = data?.entries.slice(0, 3) ?? [];
  if (top.length < 2) return null;
  const mine = data?.mine ?? null;
  const myName = city?.name ? shortCityName(city.name) : null;
  const where = mine ? t('ranks.race.you', { city: shortCityName(mine.city.name), rank: mine.rank })
    : myName ? t('ranks.race.youNone', { city: myName }) : null;

  return (
    <Pressable style={styles.card} onPress={() => router.push('/ranks?tab=cities&period=today' as never)} accessibilityRole="button" testID="today-race">
      <View style={styles.head}>
        <Text style={styles.title}>{t('ranks.race.title')}</Text>
        <View style={styles.see}><Text style={styles.seeText}>{t('ranks.race.see')}</Text><Ionicons name="chevron-forward" size={14} color={GOLD.textLight} /></View>
      </View>
      <View style={styles.podium}>
        {top.map((e, i) => (
          <Animated.View key={e.city.id} layout={reduced ? undefined : LinearTransition.springify().damping(14)}
                         entering={reduced ? undefined : FadeIn} style={styles.slot}>
            <Text style={styles.medal}>{MEDAL_EMOJI[i]}</Text>
            <FlagSticker country={e.city.country} size={34} />
            <Text style={styles.city} numberOfLines={1}>{shortCityName(e.city.name)}</Text>
            <Text style={styles.count}>{t('today.proofs', { count: e.photos })}</Text>
          </Animated.View>
        ))}
      </View>
      {!!where && <Text style={styles.where}>{where}</Text>}
    </Pressable>
  );
}

/**
 * "🏆 Results are in!" on Today (V6), once: shown while yesterday's results
 * (or a rank change) are unread; a tap opens Ranks › Photos › Yesterday, ✕
 * dismisses it (both mark them read, so it never comes back for them).
 */
export function ResultsCard() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const reduced = useReducedMotion();
  const { badges } = useNotifCounts();
  if (!badges.ranks) return null;
  const done = () => {
    patchNotifCounts(c => ({ ...c, badges: { ...c.badges, ranks: 0 } }));
    markNotificationTypesRead(['daily_result', 'daily_rank']).then(refreshNotifCounts);
  };
  return (
    <Animated.View entering={reduced ? undefined : FadeIn.duration(400)} style={[styles.results, { backgroundColor: tint(GOLD.fill, 0.28) }]}>
      <Pressable style={styles.resultsBody} accessibilityRole="button" testID="results-card"
                 onPress={() => { done(); router.push('/ranks?tab=photos&period=yesterday' as never); }}>
        <Text style={styles.trophy}>🏆</Text>
        <View style={styles.flex}>
          <Text style={styles.resultsTitle}>{t('ranks.results.title')}</Text>
          <Text style={styles.resultsSub}>{t('ranks.results.sub')}</Text>
        </View>
      </Pressable>
      <Pressable onPress={done} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('ranks.results.dismiss')}>
        <Ionicons name="close" size={18} color={colors.muted} />
      </Pressable>
    </Animated.View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  flex:         { flex: 1 },
  card:         { borderRadius: Radius.card, padding: 14, gap: 10, backgroundColor: c.bg2, borderWidth: 1.5, borderColor: GOLD.fill },
  head:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title:        { fontSize: 17, lineHeight: 22, fontWeight: '800', color: c.text },
  see:          { flexDirection: 'row', alignItems: 'center', gap: 2 },
  seeText:      { fontSize: 14, fontWeight: '800', color: GOLD.textLight },
  podium:       { flexDirection: 'row', gap: 8 },
  slot:         { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 8, borderRadius: 14, backgroundColor: tint(GOLD.fill, 0.14) },
  medal:        { fontSize: 18, lineHeight: 22 },
  city:         { fontSize: 13, fontWeight: '800', color: c.text, maxWidth: '92%' },
  count:        { fontSize: 12, fontWeight: '700', color: c.muted },
  where:        { fontSize: 14, lineHeight: 19, fontWeight: '700', color: c.text, textAlign: 'center' },
  results:      { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: Radius.card, paddingVertical: 12, paddingLeft: 12, paddingRight: 12 },
  resultsBody:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  trophy:       { fontSize: 30, lineHeight: 36 },
  resultsTitle: { fontSize: 16, lineHeight: 21, fontWeight: '800', color: c.text },
  resultsSub:   { fontSize: 14, lineHeight: 19, color: c.text },
});
