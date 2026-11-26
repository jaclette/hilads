import { useCallback } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Space, Radius, Type, IconSize, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import type { ContestMeJoined } from './contest';
import { reloadContestOverview, useContestOverview } from './useContestTab';
import { LS } from './HalongArt';
import { PrizeCover } from './PrizePhotos';
import { countdownTarget, shortLeft, useNow } from './Countdown';

/**
 * The campaign on Today: a compact banner (the prize photo, the prize, my rank or what to do, the
 * time left) that switches to the Trip tab. Shown only while the campaign's tab is (a test campaign:
 * its testers only).
 */
export function LaunchSeasonCard() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation('me');
  const data = useContestOverview();
  useFocusEffect(useCallback(() => { reloadContestOverview(); }, []));
  const now = useNow(60_000);
  const s = data?.season;
  if (!s || !['upcoming', 'season', 'final', 'over', 'ended'].includes(s.phase)) return null;

  const prize = s.prize?.title || s.name;
  const joined = data?.me?.joined ? (data.me as ContestMeJoined) : null;
  const race = joined?.race;
  const target = countdownTarget(s);
  const left = target ? shortLeft(target.at - now, t) : null;
  const line = s.phase === 'over' || s.phase === 'ended' ? t('trip.banner.over')
    : s.phase === 'upcoming' ? t('trip.banner.starts', { time: left ?? '' })
    : race && race.rank && race.points > 0 ? t('trip.banner.rank', { rank: race.rank, count: race.points })
    : joined ? t('trip.banner.play')
    : t('trip.banner.join');
  const when = s.phase === 'season' && left ? t('trip.banner.toFinal', { time: left }) : s.phase === 'final' && left ? t('trip.banner.ends', { time: left }) : null;

  return (
    <Pressable style={({ pressed }) => [styles.banner, pressed && { transform: [{ scale: 0.985 }] }]} testID="launch-season-card"
               onPress={() => router.navigate('/(tabs)/trip' as never)} accessibilityRole="button"
               accessibilityLabel={`${s.name}. ${prize}. ${line}${when ? `. ${when}` : ''}${s.isTest ? `. ${t('contest.test')}` : ''}`}>
      <View style={styles.thumb}><PrizeCover photos={s.photos} width={64} height={64} /></View>
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={styles.tag} numberOfLines={1}>{s.name.toUpperCase()}</Text>
          {s.isTest && <Text style={styles.test}>{t('contest.test')}</Text>}
        </View>
        <Text style={styles.title} numberOfLines={1}>{prize} ✈️</Text>
        <Text style={styles.line} numberOfLines={1}>{line}{when ? ` · ${when}` : ''}</Text>
      </View>
      <Ionicons name="chevron-forward" size={IconSize.md} color={colors.muted} />
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: Space.md, padding: Space.sm, paddingRight: Space.md, borderRadius: Radius.card,
            backgroundColor: c.bg2, borderWidth: 2, borderColor: c.medalGold, minHeight: 80 },
  thumb:  { width: 64, height: 64, borderRadius: Radius.inner, overflow: 'hidden' },
  body:   { flex: 1, gap: 2 },
  top:    { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  tag:    { ...Type.caption, fontSize: 10, lineHeight: 13, fontWeight: '900', letterSpacing: 0.5, color: c.onMedal, backgroundColor: c.medalGold,
            borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden', flexShrink: 1 },
  test:   { ...Type.caption, fontSize: 10, lineHeight: 13, fontWeight: '800', color: '#FFFFFF', backgroundColor: LS.lantern, borderRadius: Radius.control,
            paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  title:  { ...Type.label, color: c.text },
  line:   { ...Type.caption, color: c.primaryText },
});
