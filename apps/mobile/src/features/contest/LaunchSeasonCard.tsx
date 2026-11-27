import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/ui';
import { useApp } from '@/context/AppContext';
import type { ContestMeJoined, ContestOverview, ContestSeason } from './contest';
import { reloadContestOverview, useContestOverview } from './useContestTab';
import { LS } from './HalongArt';
import { PrizeCover } from './PrizePhotos';
import { countdownTarget, shortLeft, useNow } from './Countdown';
import { markBannerTapped, useTripOpens } from './tripOpens';
import { countTodayVisit, raceSignalsLoaded, useRaceSignals } from './raceSignals';
import { Ionicons } from '@expo/vector-icons';
import { boardingState } from './Boarding';

/**
 * The campaign on Today, always in the same slot (under the challenge card, above "Same challenge.
 * Different worlds."), in two sizes:
 * - the full postcard (docs/mockups/hilads_campaign_banner_mockup.html, variant A): the prize photo
 *   full-bleed under a left-to-right shade, the campaign's name on a tilted yellow sticker, the countdown
 *   by phase, the prize big, the latest players + "13 on board" (hidden under the campaign's threshold)
 *   and a white pill that pulses until the first tap: a guest "Grab my seat →", a member not in the race
 *   "Enter the race →", in it "You're 12th · See the race →";
 * - the slim strip (56 px, the same yellow): the prize thumbnail, one line ("You're 2nd · Final week in
 *   22h", a guest "Win a week in Vietnam · Grab my seat"), a chevron.
 * Full for the first N Today visits of the campaign and for H hours at each key moment (race start,
 * final week start, the last H hours, my rank changed), N and H from Admin › Launch Season › Prize;
 * slim otherwise. A change of size animates (height + fade; none with reduce motion). The whole banner
 * opens the Trip tab. Fixed colors: a photo / a printed strip in every theme.
 */
type Size = 'full' | 'slim';
const FULL_H = 124;
const SLIM_H = 56;

/** Full or slim for this visit: the visit's number, then the key moments (now within H hours). */
export function bannerSize(s: ContestSeason, visit: number, changeAt: number | null, now: number): Size {
  const cfg = s.tab?.banner ?? { fullVisits: 3, momentHours: 24 };
  if (visit > 0 && visit <= cfg.fullVisits) return 'full';
  const H = cfg.momentHours * 3_600_000;
  const at = (iso?: string | null) => (iso ? Date.parse(iso) : NaN);
  const after = (t: number) => Number.isFinite(t) && now >= t && now < t + H;
  const ends = at(s.endsAt);
  if (after(at(s.startsAt)) || after(at(s.finalAt))) return 'full';
  if (Number.isFinite(ends) && now >= ends - H && now < ends) return 'full';
  if (changeAt !== null && now - changeAt < H) return 'full';
  return 'slim';
}

export function LaunchSeasonCard() {
  const router = useRouter();
  const { t } = useTranslation('me');
  const { account } = useApp();
  const data = useContestOverview();
  const now = useNow(60_000);
  const s = data?.season;
  const { tapped } = useTripOpens(s?.id ?? null);
  const { change } = useRaceSignals(s?.id ?? null);

  // One Today visit per focus, counted once the campaign is known; the size is decided for the visit.
  const [focusKey, setFocusKey] = useState(0);
  const counted = useRef(-1);
  const [visit, setVisit] = useState(0);
  useFocusEffect(useCallback(() => { reloadContestOverview(); setFocusKey(k => k + 1); }, []));
  useEffect(() => {
    if (!s || counted.current === focusKey || !raceSignalsLoaded()) return;
    counted.current = focusKey;
    setVisit(countTodayVisit(s.id));
  }, [focusKey, s?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = !!s && ['upcoming', 'season', 'final', 'over', 'ended'].includes(s.phase);
  const size: Size = live && visit > 0 ? bannerSize(s!, visit, change?.at ?? null, now) : 'full';

  // The change of size: the slot's height and a fade (none with reduce motion).
  const [still, setStill] = useState(false);
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setStill).catch(() => {}); }, []);
  const height = useRef(new Animated.Value(size === 'full' ? FULL_H : SLIM_H)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const shown = useRef<Size>(size);
  useEffect(() => {
    if (shown.current === size) return;
    shown.current = size;
    const to = size === 'full' ? FULL_H : SLIM_H;
    if (still) { height.setValue(to); return; }
    fade.setValue(0);
    Animated.parallel([
      Animated.timing(height, { toValue: to, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.timing(fade, { toValue: 1, duration: 320, delay: 80, useNativeDriver: false }),
    ]).start();
  }, [size, still, height, fade]);

  if (!s || !live) return null;

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
  const joined = data?.me?.joined ? (data.me as ContestMeJoined) : null;
  const ranked = !!joined?.race?.rank && (joined.race.points ?? 0) > 0;
  const open = () => { markBannerTapped(s.id); router.navigate('/(tabs)/trip' as never); };
  // The strip's one line: my rank and the countdown, else the prize and what to do (the pill's words without the arrow).
  const slimLine = ranked ? `${t('trip.me.rank', { rank: joined!.race!.rank })}${when ? ` · ${when}` : ''}`
    : `${prize} · ${joined && s.phase === 'upcoming' && when ? when : cta.replace(/\s*[→←]\s*$/u, '')}`;
  const label = size === 'slim' ? [s.name, slimLine, s.isTest ? t('contest.test') : null].filter(Boolean).join('. ')
    : [s.name, prize, when, board?.showCount ? t('trip.banner.onBoard', { count: counter!.players }) : null, cta, s.isTest ? t('contest.test') : null]
      .filter(Boolean).join('. ');

  return (
    <Animated.View style={{ height }} testID="launch-season-slot">
      <Pressable onPress={open} style={({ pressed }) => [size === 'full' ? styles.shadow : styles.slimShadow, { flex: 1 }, pressed && { transform: [{ scale: 0.985 }] }]}
                 testID="launch-season-card" accessibilityRole="button" accessibilityLabel={label}>
        <Animated.View style={{ flex: 1, opacity: fade }}>
          {size === 'full' ? (
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
          ) : (
            <LinearGradient colors={['#FFE48A', '#FFC93C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.slim}>
              <View style={styles.slimThumb}><PrizeCover photos={s.photos} width={40} height={40} /></View>
              <Text style={styles.slimText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.2}>{slimLine}</Text>
              {s.isTest && <Text style={styles.test}>{t('contest.test')}</Text>}
              <Ionicons name="chevron-forward" size={18} color="#2B1A12" />
            </LinearGradient>
          )}
        </Animated.View>
      </Pressable>
    </Animated.View>
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
  slimShadow: { borderRadius: 18, backgroundColor: '#D9A10F', shadowColor: '#783C00', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  slim:   { flex: 1, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 8, paddingRight: 12, overflow: 'hidden' },
  slimThumb: { width: 40, height: 40, borderRadius: 12, overflow: 'hidden' },
  slimText: { flex: 1, fontSize: 14, lineHeight: 18, fontWeight: '900', color: '#2B1A12' },
  shadow: { borderRadius: 22, backgroundColor: '#1D3B33', shadowColor: '#14402F', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  card:   { flex: 1, borderRadius: 22, overflow: 'hidden', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 11, justifyContent: 'space-between' },
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
