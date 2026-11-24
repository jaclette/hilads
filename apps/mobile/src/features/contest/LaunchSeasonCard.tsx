import { useCallback, useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Space, Radius, Type, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { contestDate, fetchContest, type ContestMeJoined, type ContestOverview } from './contest';
import { LS } from './HalongArt';
import { PrizeCover } from './PrizePhotos';
import { countdownTarget, shortLeft, useNow } from './Countdown';

/**
 * The Launch Season on Today and Passport, a small boarding pass: the Ha Long art, a tear
 * line, the prize (Admin › Launch Season), the deadline, then my points and rank or Join.
 * Shown only while a season is visible to me (a test season: its testers only).
 */
export function LaunchSeasonCard() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { t, i18n } = useTranslation('me');
  const [data, setData] = useState<ContestOverview | null>(null);

  useFocusEffect(useCallback(() => { fetchContest(i18n.language).then(setData).catch(() => {}); }, [i18n.language]));

  const now = useNow(30_000);
  const s = data?.season;
  if (!s) return null;
  // The prize from Admin › Launch Season (an older API has none: the season's name).
  const prize = s.prize?.title || s.name;
  const joined = data?.me?.joined ? (data.me as ContestMeJoined) : null;
  const final = s.phase === 'final' || s.phase === 'over';
  const rank = final ? joined?.finalRank : joined?.seasonRank;
  const points = final ? joined?.points?.final : joined?.points?.season;
  // Before the start and in the final week, a live countdown; in the season, the end date.
  const target = countdownTarget(s);
  const when = target && target.label !== 'cdFinal'
    ? t(target.label === 'cdStarts' ? 'contest.startsIn' : 'contest.endsIn', { time: shortLeft(target.at - now, t) })
    : s.phase === 'upcoming'
      ? t('contest.phase.upcoming', { date: contestDate(s.startDate, i18n.language) })
      : t('contest.endsOn', { date: contestDate(s.endDate, i18n.language) });
  const status = joined?.points
    ? t('contest.cardJoined', { points: points ?? 0 }) + (rank ? ` · ${t('contest.cardRank', { rank })}` : '')
    : null;

  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]} onPress={() => router.push((joined ? '/contest' : '/contest-prize') as never)}
               accessibilityRole="button" testID="launch-season-card"
               accessibilityLabel={`${prize}. ${when}. ${status ?? t('contest.join')}${s.isTest ? `. ${t('contest.test')}` : ''}`}>
      <View style={styles.art}><View style={StyleSheet.absoluteFill}><PrizeCover photos={s.photos} width="100%" height="100%" /></View></View>
      <View style={styles.tear}>
        <View style={[styles.notch, styles.notchTop]} />
        <View style={[styles.notch, styles.notchBottom]} />
      </View>
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={styles.title} numberOfLines={3}>{prize} ✈️</Text>
          {s.isTest && <Text style={styles.test}>{t('contest.test')}</Text>}
        </View>
        <Text style={styles.when} numberOfLines={1}>{when}</Text>
        {status
          ? <Text style={styles.chip} numberOfLines={1}>{status}</Text>
          : <Text style={[styles.chip, styles.chipCta]} numberOfLines={1}>{t('contest.join')}</Text>}
      </View>
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:   { flexDirection: 'row', minHeight: 124, borderRadius: Radius.card, overflow: 'hidden', backgroundColor: c.bg2, borderWidth: 1, borderColor: c.line },
  art:    { width: 104, overflow: 'hidden' },
  tear:   { width: 0, borderLeftWidth: 2, borderStyle: 'dashed', borderColor: c.ticketLine, marginVertical: 10 },
  notch:  { position: 'absolute', left: -11, width: 20, height: 20, borderRadius: 10, backgroundColor: c.bg },
  notchTop:    { top: -21 },
  notchBottom: { bottom: -21 },
  body:   { flex: 1, paddingVertical: Space.md, paddingLeft: Space.md, paddingRight: Space.sm, gap: Space.xs, justifyContent: 'center' },
  top:    { flexDirection: 'row', alignItems: 'flex-start', gap: Space.xs },
  title:  { ...Type.label, fontSize: 18, lineHeight: 22, fontWeight: '800', color: c.text, flex: 1 },
  test:   { ...Type.caption, fontSize: 11, lineHeight: 15, fontWeight: '800', color: '#FFFFFF', backgroundColor: LS.lantern,
            borderRadius: Radius.control, paddingHorizontal: 7, paddingVertical: 2, overflow: 'hidden' },
  when:   { ...Type.caption, fontWeight: '700', color: c.primaryText },
  chip:   { ...Type.caption, fontWeight: '800', alignSelf: 'flex-start', marginTop: 2, color: c.primaryOnTint, backgroundColor: c.primaryTint,
            borderRadius: Radius.control, paddingHorizontal: Space.sm, paddingVertical: 5, overflow: 'hidden', maxWidth: '100%' },
  chipCta: { color: c.onCta, backgroundColor: c.cta },
});
