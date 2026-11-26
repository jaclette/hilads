import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/ui';
import { useApp } from '@/context/AppContext';
import type { ContestMeJoined, ContestOverview } from './contest';
import { reloadContestOverview, useContestOverview } from './useContestTab';
import { LS } from './HalongArt';
import { PrizeCover } from './PrizePhotos';
import { countdownTarget, shortLeft, useNow } from './Countdown';
import { markBannerTapped, useTripOpens } from './tripOpens';
import { boardingState } from './Boarding';

/**
 * The campaign on Today, a postcard (docs/mockups/hilads_campaign_banner_mockup.html, variant A):
 * the prize photo full-bleed (Admin › Launch Season › Photos) under a left-to-right shade, the
 * campaign's name on a tilted yellow sticker, the countdown by phase ("Starts in 1d 10h", "Final week
 * in…", "Ends in…"), the prize big, then the latest players and "13 on board" (hidden under the
 * campaign's threshold) and a white pill: a guest "Grab my seat →", a member not in the race yet
 * "Enter the race →", in it "You're 12th · See the race →". The pill pulses gently until the first tap
 * (not with reduce motion). The whole card opens the Trip tab. Never dismissed while the campaign
 * runs; after the 3rd Trip tab open, Today shows it below the feed (`placement`).
 * Fixed colors: it sits on a photo in every theme.
 */
export type BannerPlacement = 'top' | 'bottom';

/** Where Today shows the banner: near the top until the Trip tab was opened 3 times, then below the feed. */
export function useLaunchBannerPlacement(): BannerPlacement {
  const data = useContestOverview();
  const { opens } = useTripOpens(data?.season?.id ?? null);
  return opens >= 3 ? 'bottom' : 'top';
}

export function LaunchSeasonCard({ placement }: { placement?: BannerPlacement }) {
  const router = useRouter();
  const { t } = useTranslation('me');
  const { account } = useApp();
  const data = useContestOverview();
  useFocusEffect(useCallback(() => { reloadContestOverview(); }, []));
  const now = useNow(60_000);
  const s = data?.season;
  const { tapped } = useTripOpens(s?.id ?? null);
  const mine = useLaunchBannerPlacement();
  if (!s || !['upcoming', 'season', 'final', 'over', 'ended'].includes(s.phase)) return null;
  if (placement && placement !== mine) return null;

  const prize = s.prize?.title || s.name;
  const target = countdownTarget(s);
  const left = target ? shortLeft(target.at - now, t) : null;
  const over = s.phase === 'over' || s.phase === 'ended';
  const when = over ? t('trip.chip.over')
    : s.phase === 'upcoming' ? (left ? t('trip.banner.starts', { time: left }) : null)
    : s.phase === 'season' ? (left ? t('trip.banner.finalIn', { time: left }) : null)
    : left ? t('trip.banner.endsIn', { time: left }) : null;
  const cta = ctaLabel(data!, !!account, t);
  const counter = data?.counter;
  const board = counter ? boardingState(counter) : null;
  const faces = board?.showCount ? (counter?.recent ?? []).slice(0, 3) : [];
  const open = () => { markBannerTapped(s.id); router.navigate('/(tabs)/trip' as never); };

  return (
    <Pressable onPress={open} style={({ pressed }) => [styles.shadow, pressed && { transform: [{ scale: 0.985 }] }]} testID="launch-season-card"
               accessibilityRole="button"
               accessibilityLabel={[s.name, prize, when, board?.showCount ? t('trip.banner.onBoard', { count: counter!.players }) : null, cta, s.isTest ? t('contest.test') : null]
                 .filter(Boolean).join('. ')}>
      <View style={styles.card}>
        <View style={StyleSheet.absoluteFill}><PrizeCover photos={s.photos} width="100%" height="100%" /></View>
        <LinearGradient pointerEvents="none" colors={['rgba(15,8,4,0.74)', 'rgba(15,8,4,0.15)']} locations={[0, 0.72]}
                        start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
        <View style={styles.top}>
          <View style={styles.tagRow}>
            <Text style={styles.tag} numberOfLines={1}>{s.name.toUpperCase()}</Text>
            {s.isTest && <Text style={styles.test}>{t('contest.test')}</Text>}
          </View>
          {when && <Text style={styles.when} numberOfLines={1}>⏳ {when}</Text>}
        </View>
        <Text style={styles.title} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.25}>{prize} ✈️</Text>
        <View style={styles.bottom}>
          {faces.length > 0 && (
            <View style={styles.faces}>
              {faces.map((f, i) => (
                <View key={f.userId} style={[styles.face, i > 0 && { marginLeft: -7 }]}><Avatar uri={f.photoUrl} name={f.name ?? ''} size={20} /></View>
              ))}
            </View>
          )}
          {board?.showCount && <Text style={styles.board} numberOfLines={1}>{t('trip.banner.onBoard', { count: counter!.players })}</Text>}
          <PulsePill label={cta} pulse={!tapped} />
        </View>
      </View>
    </Pressable>
  );
}

/** The pill's words: a guest, a member not in the race yet, in it (with my rank), the end. */
function ctaLabel(data: ContestOverview, signedIn: boolean, t: (k: string, o?: Record<string, unknown>) => string): string {
  const s = data.season!;
  if (s.phase === 'over' || s.phase === 'ended') return t('trip.banner.overCta');
  if (!signedIn) return t('trip.banner.grab');
  const joined = data.me?.joined ? (data.me as ContestMeJoined) : null;
  const race = joined?.race;
  if (race && race.rank && race.points > 0) return t('trip.banner.rankSee', { rank: race.rank });
  if (s.phase === 'upcoming' && joined) return t('trip.banner.see');
  return t('trip.banner.enter');
}

function PulsePill({ label, pulse }: { label: string; pulse: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;
  const [still, setStill] = useState(false);
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setStill).catch(() => {}); }, []);
  useEffect(() => {
    if (!pulse || still) { scale.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(scale, { toValue: 1.06, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse, still, scale]);
  return (
    <Animated.View style={[styles.pill, { transform: [{ scale }] }]}>
      <Text style={styles.pillText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.2}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shadow: { borderRadius: 22, backgroundColor: '#1D3B33', shadowColor: '#14402F', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  card:   { height: 124, borderRadius: 22, overflow: 'hidden', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 11, justifyContent: 'space-between' },
  top:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  tag:    { fontSize: 10, lineHeight: 13, fontWeight: '900', letterSpacing: 0.6, color: '#2B1A12', backgroundColor: '#FFC93C', borderRadius: 9,
            paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden', transform: [{ rotate: '-3deg' }], flexShrink: 1 },
  test:   { fontSize: 10, lineHeight: 13, fontWeight: '800', color: '#FFFFFF', backgroundColor: LS.lantern, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  when:   { fontSize: 11, lineHeight: 14, fontWeight: '900', color: '#FFFFFF', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 11, paddingHorizontal: 9, paddingVertical: 4,
            overflow: 'hidden', fontVariant: ['tabular-nums'], flexShrink: 0 },
  title:  { fontSize: 21, lineHeight: 24, fontWeight: '900', color: '#FFFFFF', letterSpacing: -0.3, maxWidth: '78%',
            textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 2 } },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  faces:  { flexDirection: 'row' },
  face:   { borderRadius: 12, borderWidth: 2, borderColor: '#FFFFFF', overflow: 'hidden' },
  board:  { fontSize: 12, lineHeight: 15, fontWeight: '800', color: '#FFFFFF', flexShrink: 1 },
  pill:   { marginLeft: 'auto', backgroundColor: '#FFFFFF', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7, maxWidth: '70%' },
  pillText: { fontSize: 13, lineHeight: 16, fontWeight: '900', color: '#C24E1C' },
});
