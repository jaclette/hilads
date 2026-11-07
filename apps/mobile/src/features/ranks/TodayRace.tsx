import { useEffect, useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition, useReducedMotion } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useIsFocused } from 'expo-router/react-navigation';
import { Ionicons } from '@expo/vector-icons';
import { Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { FlagSticker, themeColor, tint } from '@/ui/joy';
import { shortCityName } from '@/i18n/cityName';
import { fetchRanks, type CitiesRanks } from '@/api/ranks';
import { fetchInbox, markNotificationTypesRead, type InboxItem } from '@/api/notifications';
import { useAwayShowsResults } from '@/features/notifications/awayResults';
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

/** The results line for my photo's daily_result ("🏆 Your photo finished #2 in the world yesterday"). */
export function resultsLine(d: Record<string, any> | null, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (!d) return t('ranks.results.generic');
  const city = shortCityName(d.cityName ?? '');
  return d.worldRank ? t('ranks.results.world', { rank: d.worldRank })
    : d.cityBest ? t('ranks.results.best', { city })
    : d.cityRank ? t('ranks.results.city', { rank: d.cityRank, city })
    : typeof d.votes === 'number' ? t('ranks.results.votes', { count: d.votes })
    : t('ranks.results.generic');
}

/**
 * Yesterday's results on Today (V6), above the hero in the "While you were away" card's place and
 * style, never over the hero: "🏆 Your photo finished #2 in the world yesterday · See results →".
 * Only one results block: hidden while the away card carries them. A tap opens Ranks › Photos ›
 * Yesterday on my photo (a little confetti); ✕ dismisses it. Both mark the results read (and clear
 * the Ranks tab's dot), so it never comes back for them.
 */
export function ResultsCard() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const reduced = useReducedMotion();
  const { account } = useApp();
  const { badges } = useNotifCounts();
  const inAway = useAwayShowsResults();
  const pending = !!account && badges.ranks > 0;
  const [result, setResult] = useState<InboxItem | null | undefined>(undefined);
  useEffect(() => {
    if (!pending) { setResult(undefined); return; }
    let alive = true;
    fetchInbox({ categories: ['game'], limit: 10 })
      .then(r => { if (alive) setResult(r.items.find(i => i.type === 'daily_result' && !i.read) ?? null); })
      .catch(() => { if (alive) setResult(null); });
    return () => { alive = false; };
  }, [pending]);
  if (!pending || inAway || result === undefined) return null;
  const done = () => {
    patchNotifCounts(c => ({ ...c, badges: { ...c.badges, ranks: 0 } }));
    markNotificationTypesRead(['daily_result', 'daily_rank']).then(refreshNotifCounts);
  };
  const line = resultsLine(result?.data ?? null, t);
  return (
    <Animated.View entering={reduced ? undefined : FadeIn.duration(400)} exiting={reduced ? undefined : FadeOut.duration(200)} style={styles.results}>
      <Pressable style={styles.resultsBody} accessibilityRole="button" testID="results-card" accessibilityLabel={`${line}. ${t('ranks.results.see')}`}
                 onPress={() => { done(); router.push('/ranks?tab=photos&period=yesterday&focus=me' as never); }}>
        <Text style={styles.resultsTitle} numberOfLines={2}>
          {line}<Text style={styles.resultsSee}>{'  '}{t('ranks.results.see')}</Text>
        </Text>
      </Pressable>
      <Pressable onPress={done} hitSlop={10} style={styles.resultsClose} accessibilityRole="button" accessibilityLabel={t('ranks.results.dismiss')}>
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
  results:      { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 14, paddingRight: 8, paddingVertical: 12,
                  borderRadius: Radius.card, backgroundColor: c.primaryTint, borderWidth: 1.5, borderColor: c.primary },
  resultsBody:  { flex: 1 },
  resultsClose: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  resultsTitle: { fontSize: 15, lineHeight: 20, fontWeight: '800', color: c.text },
  resultsSee:   { fontSize: 15, fontWeight: '800', color: c.primaryOnTint },
});
