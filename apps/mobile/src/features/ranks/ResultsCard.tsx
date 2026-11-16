import { useEffect, useState } from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { shortCityName } from '@/i18n/cityName';
import { fetchInbox, markNotificationTypesRead, type InboxItem } from '@/api/notifications';
import { useAwayCardShowing } from '@/features/notifications/awayResults';
import { patchNotifCounts, refreshNotifCounts, useNotifCounts } from '@/features/notifications/counts';



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
 * One card at a time: it waits while the away card shows (that one often carries them). A tap opens Ranks › Photos ›
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
  const inAway = useAwayCardShowing();
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
                 onPress={() => { done(); router.navigate('/ranks?tab=photos&period=yesterday&focus=me' as never); }}>
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
  results:      { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 14, paddingRight: 8, paddingVertical: 12,
                  borderRadius: Radius.card, backgroundColor: c.primaryTint, borderWidth: 1.5, borderColor: c.primary },
  resultsBody:  { flex: 1 },
  resultsClose: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  resultsTitle: { fontSize: 15, lineHeight: 20, fontWeight: '800', color: c.text },
  resultsSee:   { fontSize: 15, fontWeight: '800', color: c.primaryOnTint },
});
