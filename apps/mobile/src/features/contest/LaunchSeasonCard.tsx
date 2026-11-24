import { useCallback, useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Space, Radius, Type, IconSize, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { contestDate, fetchContest, type ContestMeJoined, type ContestOverview } from './contest';

/**
 * The Launch Season's entry (Today, Passport): shown only while a season is visible to me
 * (a test season: its testers only). Join, or my points and rank; opens /contest.
 */
export function LaunchSeasonCard() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { t, i18n } = useTranslation('me');
  const [data, setData] = useState<ContestOverview | null>(null);

  useFocusEffect(useCallback(() => { fetchContest().then(setData).catch(() => {}); }, []));

  const s = data?.season;
  if (!s) return null;
  const joined = data?.me?.joined ? (data.me as ContestMeJoined) : null;
  const final = s.phase === 'final' || s.phase === 'over';
  const rank = final ? joined?.finalRank : joined?.seasonRank;
  const points = final ? joined?.points?.final : joined?.points?.season;
  const line = joined?.points ? t('contest.cardJoined', { points: points ?? 0 }) : t('contest.cardText');
  const phase = t(`contest.phase.${s.phase}`, { date: contestDate(s.phase === 'upcoming' ? s.startDate : s.endDate, i18n.language) });
  const counter = data?.counter ? t('contest.counter', { count: data.counter.players, max: data.counter.threshold }) : '';

  return (
    <Pressable style={styles.card} onPress={() => router.push('/contest' as never)} accessibilityRole="button" testID="launch-season-card"
               accessibilityLabel={`${s.name}. ${phase}. ${line}. ${counter}`}>
      <Text style={styles.emoji} accessibilityElementsHidden importantForAccessibility="no">🚀</Text>
      <View style={styles.body}>
        <View style={styles.head}>
          <Text style={styles.title} numberOfLines={1}>{s.name}</Text>
          {s.isTest && <Text style={styles.test}>{t('contest.test')}</Text>}
        </View>
        <Text style={styles.text} numberOfLines={2}>{line}{rank ? ` · ${t('contest.cardRank', { rank })}` : ''}</Text>
        <Text style={styles.meta} numberOfLines={1}>{phase}{counter ? ` · ${counter}` : ''}</Text>
      </View>
      {joined ? <Ionicons name="chevron-forward" size={IconSize.md} color={colors.muted} />
        : <View style={styles.cta}><Text style={styles.ctaText}>{t('contest.cardJoin')}</Text></View>}
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:   { flexDirection: 'row', alignItems: 'center', gap: Space.md, padding: Space.md, borderRadius: Radius.card,
            backgroundColor: c.primaryTint, borderWidth: 1, borderColor: c.line, minHeight: 72 },
  emoji:  { fontSize: 30 },
  body:   { flex: 1, gap: 2 },
  head:   { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  title:  { ...Type.label, fontWeight: '900', color: c.primaryOnTint, flexShrink: 1 },
  test:   { ...Type.caption, fontWeight: '900', color: c.onCta, backgroundColor: c.red, borderRadius: Radius.control, paddingHorizontal: 6, overflow: 'hidden' },
  text:   { ...Type.caption, fontWeight: '700', color: c.text },
  meta:   { ...Type.caption, color: c.muted },
  cta:    { backgroundColor: c.cta, borderRadius: Radius.control, paddingHorizontal: Space.md, minHeight: 36, justifyContent: 'center' },
  ctaText:{ ...Type.caption, fontWeight: '900', color: c.onCta },
});
