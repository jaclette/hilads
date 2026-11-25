import { useCallback, useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Space, Radius, Type, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { contestDate, notifyContest, type ContestMeJoined, type ContestMeNotJoined } from './contest';
import { reloadContestOverview, setContestOverview, useContestOverview } from './useContestTab';
import { LS } from './HalongArt';
import { PrizeCover } from './PrizePhotos';
import { CountdownBoard, countdownTarget, shortLeft, useNow } from './Countdown';

/**
 * The Launch Season on Today and Passport, a festive banner that says there is a real trip to win:
 * the season's first photo full-bleed (else the illustration), a gold "a real trip to win" ribbon,
 * a little confetti, the prize (Admin › Launch Season) and "be #1 in the final week", the deadline,
 * then my points and rank or Join. Before the start (the Upcoming phase) it is the teaser: "the
 * Launch Season is coming", the prize, a compact live countdown, the warm-up line (the normal game
 * runs, the contest starts at zero) and Notify me. Fixed event colors in every theme (on a photo).
 * Shown only while a season is visible to me (a test season: its testers only).
 */
const CONFETTI: { top: number; right: number; w: number; h: number; rot: string; color: string }[] = [
  { top: 14, right: 96, w: 6, h: 12, rot: '24deg', color: LS.mango },
  { top: 40, right: 70, w: 5, h: 10, rot: '-32deg', color: '#FFFFFF' },
  { top: 22, right: 48, w: 7, h: 7, rot: '45deg', color: LS.lantern },
  { top: 58, right: 26, w: 6, h: 12, rot: '12deg', color: LS.sun },
  { top: 76, right: 82, w: 5, h: 9, rot: '60deg', color: LS.jade },
  { top: 92, right: 40, w: 6, h: 6, rot: '20deg', color: LS.mango },
];

export function LaunchSeasonCard() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { t, i18n } = useTranslation('me');
  // Shared with the tab bar, kept per account + language (no late pop-in on a cold start).
  const data = useContestOverview();
  const setData = setContestOverview;

  useFocusEffect(useCallback(() => { reloadContestOverview(); }, []));

  const now = useNow(30_000);
  const [busy, setBusy] = useState(false);
  const s = data?.season;
  if (!s) return null;
  const upcoming = s.phase === 'upcoming';
  const notified = data?.me?.joined === true || !!(data?.me && (data.me as ContestMeNotJoined).notified);
  const onNotify = () => {
    if (!data?.me) { router.push('/auth-gate?reason=contest&returnTo=%2Fcontest-prize' as never); return; }
    if (notified || busy) return;
    setBusy(true);
    notifyContest(s.id, i18n.language).then(setData).catch(() => {}).finally(() => setBusy(false));
  };
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
    <Pressable style={({ pressed }) => [styles.banner, pressed && { transform: [{ scale: 0.985 }] }]} onPress={() => router.push((joined ? '/contest' : '/contest-prize') as never)}
               accessibilityRole="button" testID="launch-season-card"
               accessibilityLabel={upcoming
                 ? `${t('contest.teaserTitle')}. ${prize}. ${when}. ${t('contest.teaserWarm')}${s.isTest ? `. ${t('contest.test')}` : ''}`
                 : `${t('contest.todayKicker')}. ${prize}. ${t('contest.todayWin')}. ${when}. ${status ?? t('contest.todayJoin')}${s.isTest ? `. ${t('contest.test')}` : ''}`}>
      <View style={StyleSheet.absoluteFill}><PrizeCover photos={s.photos} width="100%" height="100%" /></View>
      <LinearGradient pointerEvents="none" colors={['rgba(12,8,5,0.30)', 'rgba(12,8,5,0.05)', 'rgba(12,8,5,0.55)', 'rgba(12,8,5,0.90)']}
                      locations={[0, 0.3, 0.6, 1]} style={StyleSheet.absoluteFill} />
      {CONFETTI.map((p, i) => (
        <View key={i} pointerEvents="none" style={{ position: 'absolute', top: p.top, right: p.right, width: p.w, height: p.h, borderRadius: 2,
                                                   backgroundColor: p.color, transform: [{ rotate: p.rot }] }} />
      ))}
      <View style={styles.top}>
        <View style={styles.ribbon}>
          <Ionicons name={upcoming ? 'rocket' : 'trophy'} size={14} color={LS.board} />
          <Text style={styles.ribbonText} numberOfLines={1}>{t(upcoming ? 'contest.teaserKicker' : 'contest.todayKicker')}</Text>
        </View>
        {s.isTest && <Text style={styles.test}>{t('contest.test')}</Text>}
      </View>
      {upcoming ? (
        <View style={styles.bottom}>
          <Text style={styles.title} numberOfLines={2}>{t('contest.teaserTitle')}</Text>
          <Text style={styles.win} numberOfLines={2}>{prize} ✈️</Text>
          {target && <View style={{ marginTop: Space.xs }}><CountdownBoard target={target} compact /></View>}
          <Text style={styles.warm} numberOfLines={3}>{t('contest.teaserWarm')}</Text>
          <Pressable onPress={onNotify} disabled={busy} accessibilityRole="button" testID="contest-notify"
                     style={({ pressed }) => [styles.cta, styles.notify, notified && styles.ctaIn, pressed && { opacity: 0.85 }]}>
            <Ionicons name={notified ? 'checkmark-circle' : 'notifications'} size={18} color={LS.board} />
            <Text style={[styles.ctaText, notified && styles.ctaTextIn]} numberOfLines={1}>{t(notified ? 'contest.notifyOn' : 'contest.notifyMe')}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.bottom}>
          <Text style={styles.title} numberOfLines={2}>{prize} ✈️</Text>
          <Text style={styles.win} numberOfLines={2}>{t('contest.todayWin')}</Text>
          <View style={styles.row}>
            <View style={styles.when}>
              <Ionicons name="time-outline" size={14} color="#FFFFFF" />
              <Text style={styles.whenText} numberOfLines={1}>{when}</Text>
            </View>
            <View style={[styles.cta, status && styles.ctaIn]}>
              <Text style={[styles.ctaText, status && styles.ctaTextIn]} numberOfLines={1}>{status ?? t('contest.todayJoin')}</Text>
              <Ionicons name="chevron-forward" size={16} color={LS.board} />
            </View>
          </View>
        </View>
      )}
    </Pressable>
  );
}

// Fixed event colors (on a photo): white text, the mango ribbon, the lantern-red TEST, the orange button.
const makeStyles = (_c: ThemeColors) => StyleSheet.create({
  banner: { minHeight: 236, borderRadius: Radius.card, overflow: 'hidden', backgroundColor: LS.deepJade, borderWidth: 2, borderColor: LS.mango,
            justifyContent: 'space-between' },
  top:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.xs, padding: Space.md },
  ribbon: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: LS.mango, borderRadius: Radius.control,
            paddingHorizontal: Space.sm, paddingVertical: 5, flexShrink: 1 },
  ribbonText: { ...Type.caption, fontWeight: '900', color: LS.board, flexShrink: 1 },
  test:   { ...Type.caption, fontSize: 11, lineHeight: 15, fontWeight: '800', color: '#FFFFFF', backgroundColor: LS.lantern,
            borderRadius: Radius.control, paddingHorizontal: 7, paddingVertical: 2, overflow: 'hidden' },
  bottom: { padding: Space.md, paddingTop: 0, gap: 4 },
  title:  { fontSize: 26, lineHeight: 31, fontWeight: '900', color: '#FFFFFF', textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 6 },
  win:    { ...Type.label, fontWeight: '800', color: LS.sun },
  row:    { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Space.xs, marginTop: Space.xs },
  when:   { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  whenText: { ...Type.caption, fontWeight: '700', color: '#FFFFFF', flexShrink: 1 },
  cta:    { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: LS.orange, borderRadius: Radius.control,
            paddingLeft: Space.md, paddingRight: Space.sm, minHeight: 40, maxWidth: '100%' },
  ctaIn:  { backgroundColor: '#FFFFFF' },
  notify: { alignSelf: 'flex-start', gap: 6, marginTop: Space.xs, paddingLeft: Space.sm, paddingRight: Space.md },
  warm:   { ...Type.caption, fontWeight: '600', color: '#FFFFFF', marginTop: Space.xs },
  ctaText: { ...Type.label, fontWeight: '900', color: LS.board, flexShrink: 1 },
  ctaTextIn: { color: LS.board },
});
