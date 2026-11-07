import { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Modal, Pressable, Text, View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing, cancelAnimation, interpolate, type SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue,
  withDelay, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { thumbUrl } from '@/lib/imageThumb';
import { countryToFlag } from '@/lib/countryFlag';
import { shortCityName } from '@/i18n/cityName';
import { themeName } from '@/features/daily/themes';
import { ThemeIcon } from '@/ui/ThemeIcon';
import { themeColor } from '@/ui/joy';
import type { ScoreCelebration, ScoreWin, ScoreWinMedal } from '@/api/challenges';

/** Where a medal or the main button leads: the Ranks tab, segment, scope and period. */
export type RanksTarget = { tab: 'players' | 'cities'; scope: 'city' | 'world'; period: 'today' | 'week' | 'alltime' };

type Props = {
  data:     ScoreCelebration | null;
  visible:  boolean;
  onClose:  () => void;
  onOpenRanks: (target: RanksTarget) => void;
  /** Share my win (absent: no photo to share). */
  onShare?: (win: ScoreWin, medal: ScoreWinMedal | null) => void;
};

/**
 * The victory card's own colors (docs/mockups/hilads_reward_mockup.html): it sits on the day's
 * theme color, so it keeps the same look in the light, dark and seasonal palettes (like the joy
 * layer's theme colors).
 */
const W = {
  ink: '#2B1A12', muted: '#7A6558', orange: '#F2783A', terra: '#C24E1C', terraShadow: '#8A330F',
  green: '#1A9E6B', dim: 'rgba(30,15,5,0.55)', card3d: 'rgba(160,90,0,0.25)', track: '#F3E3C3',
  coin: '#F2B200', coinEdge: '#D08E00', coinText: '#8A5A00', coinLight: '#FFE680',
  glass: 'rgba(255,255,255,0.75)', closeBg: 'rgba(255,255,255,0.6)',
  medal: {
    city:   { bg: '#FFE6E0', fg: '#D7372B' },
    world:  { bg: '#DDEBFF', fg: '#2E6FD8' },
    cities: { bg: '#E3F6EC', fg: '#1A9E6B' },
  },
  confetti: ['#F2783A', '#FFC93C', '#2E6FD8', '#1A9E6B', '#F27AA8', '#7C5CE0', '#FFFFFF'],
} as const;

// The mockup's timeline (ms).
const T = {
  pop: 500, trophy: 250, trophyDur: 700, wobble: 1200, plus: 550, plusDur: 600,
  coins: 850, coinGap: 90, coinDur: 650, odo: 1150, odoDur: 1100, chip: 1600, medals: [2000, 2250, 2500], medalDur: 450,
  goal: 2900, bar: 3100, barDur: 1000, ctas: 3300, fade: 400, end: 4100,
};
const COINS = 5;
const OVERSHOOT = Easing.bezier(0.2, 1.8, 0.4, 1);

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** The victory screen data from the API, or built from an older API's fields. */
function winOf(d: ScoreCelebration): ScoreWin {
  if (d.win) return d.win;
  const medals: ScoreWinMedal[] = [];
  const city = d.city_name ? { id: 0, name: d.city_name, country: d.city_country ?? null } : null;
  const cityRank = d.rank_month?.city ?? d.rank_alltime?.city ?? null;
  const worldRank = d.rank_month?.global ?? d.rank_alltime?.global ?? null;
  const cities = d.city_rank_month ?? d.city_rank_alltime ?? null;
  if (cityRank) medals.push({ key: 'city', rank: cityRank, prevRank: cityRank, city });
  if (worldRank) medals.push({ key: 'world', rank: worldRank, prevRank: worldRank });
  if (cities && city) medals.push({ key: 'cities', rank: cities, prevRank: cities, city });
  return { period: 'alltime', theme: null, challenge: null, proof: null, sources: [{ source: 'other', points: d.points }], medals, goal: null };
}

/** A value that runs 0 → 1 at a time of the sequence (instantly 1 when skipped). */
function useStep() { return useSharedValue(0); }

/**
 * The points reward (2026-11-07), a victory moment as in docs/mockups/hilads_reward_mockup.html:
 * a card in the day's theme color with slowly turning light rays and doodles pops in, confetti
 * falls, the trophy drops in and keeps wobbling, "+10" bounces, coins fly into the total, which
 * rolls from the old to the new value (an odometer), then what earned it (my photo, the theme,
 * the challenge's short title, "+X" per source), three medals popping one by one (my city, the
 * World, my city among the cities; ▲ when the reward moved me up; a tap opens that ranking), the
 * next goal's bar filling, and the two buttons. Light haptics on each step, a success one at the
 * end. A tap anywhere jumps to the end; with Reduce Motion everything is simply there.
 */
export function ScoreCelebrationModal({ data, visible, onClose, onOpenRanks, onShare }: Props) {
  const { t } = useTranslation('challenge');
  const reduced = useReducedMotion();
  const win = useMemo(() => (data ? winOf(data) : null), [data]);
  const tc = themeColor(win?.theme);
  const light = tc.onFill === '#FFFFFF';     // a dark theme color (indigo): white text on it
  const bgTop = mix(tc.fill, '#FFFFFF', 0.45);
  const bgEnd = mix(tc.fill, '#F2783A', 0.18);
  const tagColor = light ? '#FFFFFF' : mix(tc.fill, '#000000', 0.62);

  const total = data ? ((data.total_month ?? 0) > 0 ? data.total_month! : data.total_alltime ?? 0) : 0;
  const delta = data?.points ?? 0;
  const from = Math.max(0, total - delta);

  // ── the sequence ──────────────────────────────────────────────────────────
  const [odoValue, setOdoValue] = useState(from);
  const [odoInstant, setOdoInstant] = useState(true);
  const [done, setDone] = useState(false);
  const [pill, setPill] = useState<{ x: number; y: number } | null>(null);
  const [cardW, setCardW] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pop = useStep(), trophy = useStep(), wobble = useSharedValue(0), plus = useStep(), chip = useStep();
  const medalA = useStep(), medalB = useStep(), medalC = useStep(), goal = useStep(), bar = useStep(), ctas = useStep(), rays = useSharedValue(0);
  const coins = [useStep(), useStep(), useStep(), useStep(), useStep()];
  const medalSteps = [medalA, medalB, medalC];
  const progress = Math.max(0, Math.min(1, win?.goal?.progress ?? 0));
  const all = [pop, trophy, plus, chip, medalA, medalB, medalC, goal, ctas];

  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const at = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };
  const haptic = (kind: 'light' | 'select' | 'success') => {
    (kind === 'light' ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      : kind === 'select' ? Haptics.selectionAsync()
      : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)).catch(() => {});
  };

  const finish = (withHaptic: boolean) => {
    clear();
    [...all, ...coins, bar].forEach(v => cancelAnimation(v));
    all.forEach(v => { v.value = 1; });
    coins.forEach(c => { c.value = 0; });
    bar.value = progress;
    setOdoInstant(true); setOdoValue(total); setDone(true);
    if (!reduced) startWobble();
    if (withHaptic) haptic('success');
  };
  const startWobble = () => {
    wobble.value = withRepeat(withSequence(
      withTiming(-6, { duration: 1300, easing: Easing.inOut(Easing.ease) }),
      withTiming(5, { duration: 650, easing: Easing.inOut(Easing.ease) }),
      withTiming(0, { duration: 650, easing: Easing.inOut(Easing.ease) }),
    ), -1);
  };

  useEffect(() => {
    if (!visible || !win) return;
    clear();
    setDone(false); setOdoInstant(true); setOdoValue(from);
    [...all, ...coins, bar, wobble].forEach(v => { cancelAnimation(v); v.value = 0; });
    if (reduced) { finish(true); return clear; }
    rays.value = 0;
    rays.value = withRepeat(withTiming(1, { duration: 18000, easing: Easing.linear }), -1);
    pop.value = withTiming(1, { duration: T.pop, easing: Easing.bezier(0.2, 1.6, 0.4, 1) });
    haptic('light');
    trophy.value = withDelay(T.trophy, withTiming(1, { duration: T.trophyDur, easing: OVERSHOOT }));
    at(T.wobble, startWobble);
    plus.value = withDelay(T.plus, withTiming(1, { duration: T.plusDur, easing: Easing.bezier(0.2, 1.9, 0.4, 1) }));
    at(T.plus + 120, () => haptic('light'));
    coins.forEach((c, i) => {
      c.value = withDelay(T.coins + i * T.coinGap, withTiming(1, { duration: T.coinDur, easing: Easing.inOut(Easing.ease) }));
      at(T.coins + i * T.coinGap + T.coinDur, () => haptic('light'));
    });
    at(T.odo, () => { setOdoInstant(false); setOdoValue(total); });
    at(T.odo + T.odoDur, () => haptic('success'));
    chip.value = withDelay(T.chip, withTiming(1, { duration: T.fade, easing: Easing.out(Easing.ease) }));
    medalSteps.forEach((m, i) => {
      m.value = withDelay(T.medals[i], withTiming(1, { duration: T.medalDur, easing: OVERSHOOT }));
      at(T.medals[i] + 40, () => haptic('select'));
    });
    goal.value = withDelay(T.goal, withTiming(1, { duration: T.fade, easing: Easing.out(Easing.ease) }));
    bar.value = withDelay(T.bar, withTiming(progress, { duration: T.barDur, easing: Easing.out(Easing.ease) }));
    ctas.value = withDelay(T.ctas, withTiming(1, { duration: T.fade, easing: Easing.out(Easing.ease) }));
    at(T.end, () => setDone(true));
    return () => { clear(); cancelAnimation(rays); cancelAnimation(wobble); };
  }, [visible, win]); // eslint-disable-line react-hooks/exhaustive-deps

  const popStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, pop.value * 1.6), transform: [{ scale: 0.6 + 0.4 * pop.value }] }));
  const raysStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rays.value * 360}deg` }] }));
  const trophyStyle = useAnimatedStyle(() => ({ transform: [{ scale: trophy.value }, { rotate: `${-20 * (1 - trophy.value) + wobble.value}deg` }] }));
  const plusStyle = useAnimatedStyle(() => ({ transform: [{ scale: plus.value }] }));
  const fadeUp = (v: SharedValue<number>) => () => {
    'worklet';
    return { opacity: v.value, transform: [{ translateY: 8 * (1 - v.value) }] };
  };
  const chipStyle = useAnimatedStyle(fadeUp(chip));
  const goalStyle = useAnimatedStyle(fadeUp(goal));
  const ctasStyle = useAnimatedStyle(fadeUp(ctas));
  const barStyle = useAnimatedStyle(() => ({ width: `${bar.value * 100}%` }));

  if (!data || !win || delta <= 0) return null;

  const skip = () => { if (!done) finish(true); };
  const close = () => { clear(); onClose(); };
  const medals = win.medals.slice(0, 3);
  const mainTarget: RanksTarget = { tab: 'players', scope: medals.some(m => m.key === 'city') ? 'city' : 'world', period: win.period };
  const targetOf = (m: ScoreWinMedal): RanksTarget => ({ tab: m.key === 'cities' ? 'cities' : 'players', scope: m.key === 'city' ? 'city' : 'world', period: win.period });
  const cityMedal = medals.find(m => m.city?.name)?.city ?? null;
  const city = cityMedal ? shortCityName(cityMedal.name) : null;
  const themeKey = win.challenge?.theme?.key ?? win.theme;
  const themeLabel = themeKey ? themeName(themeKey, { special: win.challenge?.special, city: win.proof?.city?.name }) : null;
  const sub = [win.proof ? t('scoreWin.yourPhoto') : null, win.challenge?.headline ?? null].filter(Boolean).join(' · ')
    || win.sources.map(s => t(`scoreWin.source.${s.source}`)).join(' · ');
  const best = [...medals].sort((a, b) => a.rank - b.rank)[0] ?? null;
  const goalLeft = win.goal ? goalText(win, t) : null;
  const goalRight = !win.goal ? null
    : win.goal.type === 'streak' ? `${win.goal.day - 1} / ${win.goal.milestone}`
    : win.goal.type === 'stamp' ? `${win.goal.done} / ${win.goal.total}` : null;

  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.dim} onPress={done ? close : skip} accessibilityLabel={t('scoreWin.close')}>
        <Animated.View style={[styles.card, popStyle]} onLayout={(e: LayoutChangeEvent) => setCardW(e.nativeEvent.layout.width)}>
          {/* The day's color, light rays turning slowly, doodles. */}
          <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
            <Defs>
              <RadialGradient id="winBg" cx="50%" cy="22%" r="85%" fx="50%" fy="22%">
                <Stop offset="0" stopColor={bgTop} />
                <Stop offset="0.38" stopColor={tc.fill} />
                <Stop offset="1" stopColor={bgEnd} />
              </RadialGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#winBg)" />
          </Svg>
          <Animated.View style={[styles.rays, raysStyle]} pointerEvents="none"><Rays /></Animated.View>
          <Text style={[styles.doodle, { left: 16, top: 120, color: tagColor }]}>✦</Text>
          <View style={[styles.doodle, { right: 20, top: 170 }]}><ThemeIcon theme={themeKey} size={22} color={tagColor} /></View>
          <Text style={[styles.doodle, { left: 24, top: 200, color: tagColor }]}>〰</Text>

          <Pressable onPress={close} hitSlop={10} style={styles.close} accessibilityRole="button" accessibilityLabel={t('scoreWin.close')} testID="win-close">
            <Text style={styles.closeText}>✕</Text>
          </Pressable>

          <Pressable onPress={skip} style={styles.column} accessible={false}>
            <Animated.Text style={[styles.trophy, trophyStyle]} accessibilityElementsHidden>🏆</Animated.Text>
            <Animated.View style={[styles.plusRow, plusStyle]} accessible accessibilityLabel={t('scoreWin.a11yPoints', { count: delta })}>
              <Outlined text={`+${delta}`} />
              <Text style={styles.plusUnit}>{t('scoreWin.pts')}</Text>
            </Animated.View>
            <View style={styles.total} onLayout={e => setPill({ x: e.nativeEvent.layout.x, y: e.nativeEvent.layout.y })}
                  accessible accessibilityLabel={t('scoreWin.a11yTotal', { total })}>
              <CoinFace size={22} />
              <Odometer from={from} value={odoValue} digits={String(total).length} instant={odoInstant} />
              <Text style={styles.totalUnit}>{t('scoreWin.pts')}</Text>
            </View>
            <Text style={[styles.tag, { color: tagColor }]}>
              {city ? `${t('scoreWin.proud', { city })} ${countryToFlag(cityMedal?.country ?? null)}`.trim() : t('scoreWin.proudNoCity')}
            </Text>

            {/* What earned it. */}
            <Animated.View style={[styles.chip, chipStyle]}>
              {win.proof ? (
                <Image source={{ uri: thumbUrl(win.proof.thumbUrl ?? win.proof.photoUrl) }} style={styles.thumb} contentFit="cover" />
              ) : null}
              <View style={styles.chipBody}>
                <View style={styles.chipTitleRow}>
                  {!!themeKey && <ThemeIcon theme={themeKey} size={14} color={W.ink} special={win.challenge?.special?.icon ?? null} />}
                  <Text style={styles.chipTitle} numberOfLines={1}>{themeLabel ?? t('scoreWin.source.other')}</Text>
                </View>
                {!!sub && <Text style={styles.chipSub} numberOfLines={2}>{sub}</Text>}
              </View>
              <View style={styles.pills}>
                {win.sources.map(s => (
                  <Text key={s.source} style={styles.pts}>
                    {win.sources.length > 1 ? `+${s.points} ${t(`scoreWin.source.${s.source}`)}` : `+${s.points}`}
                  </Text>
                ))}
              </View>
            </Animated.View>

            {/* The ranks as medals. */}
            {medals.length > 0 && (
              <View style={styles.medals}>
                {medals.map((m, i) => (
                  <Medal key={m.key} medal={m} step={medalSteps[i]} t={t} onPress={() => onOpenRanks(targetOf(m))} />
                ))}
              </View>
            )}

            {/* The next goal. */}
            {goalLeft && (
              <Animated.View style={[styles.goal, goalStyle]}>
                <View style={styles.goalRow}>
                  <Text style={styles.goalText} numberOfLines={2}>{goalLeft}</Text>
                  {!!goalRight && <Text style={styles.goalCount}>{goalRight}</Text>}
                </View>
                <View style={styles.bar}>
                  <Animated.View style={[styles.barFill, barStyle]}>
                    <LinearGradient colors={[W.orange, W.terra]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                  </Animated.View>
                </View>
              </Animated.View>
            )}

            <Animated.View style={[styles.ctas, ctasStyle]}>
              <View style={styles.primaryShadow}>
                <Pressable onPress={() => onOpenRanks(mainTarget)} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
                           accessibilityRole="button" testID="win-ranks">
                  <Text style={styles.primaryText}>{t('scoreWin.ranks')}</Text>
                </Pressable>
              </View>
              {onShare && win.proof && win.challenge && (
                <Pressable onPress={() => onShare(win, best)} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
                           accessibilityRole="button" testID="win-share">
                  <Text style={styles.secondaryText}>{t('scoreWin.share')}</Text>
                </Pressable>
              )}
            </Animated.View>
          </Pressable>

          {/* Coins flying from "+10" into the total. */}
          {!reduced && pill && cardW > 0 && coins.map((c, i) => (
            <FlyingCoin key={i} p={c} sx={cardW / 2 - 11 + (i - 2) * 26} sy={150} ex={pill.x + 10} ey={pill.y + 2} />
          ))}
        </Animated.View>
        {!reduced && visible && <ConfettiRain />}
      </Pressable>
    </Modal>
  );
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function goalText(win: ScoreWin, t: TFn): string {
  const g = win.goal!;
  if (g.type === 'pass') return t('scoreWin.goal.pass', { gap: g.gap, name: g.username ? `@${g.username}` : (g.displayName ?? '') });
  if (g.type === 'streak') return t('scoreWin.goal.streak', { day: g.day });
  return t('scoreWin.goal.stamp', { city: shortCityName(g.city?.name ?? '') });
}

/** "+10": white with a terra outline and a solid terra shadow (eight offset copies behind). */
function Outlined({ text }: { text: string }) {
  const offs = [[-3, 0], [3, 0], [0, -3], [0, 3], [-2, -2], [2, -2], [-2, 2], [2, 2]];
  return (
    <View>
      <Text style={[styles.plus, styles.plusShadow, { position: 'absolute', top: 5 }]}>{text}</Text>
      {offs.map(([x, y], i) => <Text key={i} style={[styles.plus, styles.plusStroke, { position: 'absolute', left: x, top: y }]}>{text}</Text>)}
      <Text style={styles.plus}>{text}</Text>
    </View>
  );
}

/** The Hilads coin ("H"). */
function CoinFace({ size }: { size: number }) {
  return (
    <View style={[styles.coin, { width: size, height: size, borderRadius: size / 2 }]}>
      <View style={[styles.coinLight, { width: size * 0.5, height: size * 0.5, borderRadius: size * 0.25 }]} />
      <Text style={styles.coinText}>H</Text>
    </View>
  );
}

function FlyingCoin({ p, sx, sy, ex, ey }: { p: SharedValue<number>; sx: number; sy: number; ex: number; ey: number }) {
  const st = useAnimatedStyle(() => {
    const v = p.value;
    if (v <= 0 || v >= 1) return { opacity: 0 };
    const dx = ex - sx, dy = ey - sy;
    const a = v < 0.5 ? v / 0.5 : 1;
    const b = v < 0.5 ? 0 : (v - 0.5) / 0.5;
    const x = v < 0.5 ? (dx / 2) * a : dx / 2 + (dx / 2) * b;
    const y = v < 0.5 ? -40 * a : -40 + (dy + 40) * b;
    const s = v < 0.5 ? 1 + 0.2 * a : 1.2 - 0.6 * b;
    return { opacity: v < 0.5 ? 1 : 1 - b, transform: [{ translateX: x }, { translateY: y }, { scale: s }] };
  });
  return <Animated.View style={[{ position: 'absolute', left: sx, top: sy }, st]} pointerEvents="none"><CoinFace size={22} /></Animated.View>;
}

/** Digits rolling from the old total to the new one (an odometer). */
const DIGIT_H = 22;
function Odometer({ from, value, digits, instant }: { from: number; value: number; digits: number; instant: boolean }) {
  const cols = String(value).padStart(digits, ' ').split('');
  const start = String(from).padStart(digits, ' ').split('');
  return (
    <View style={styles.odo}>
      {cols.map((ch, i) => <Digit key={i} d={ch === ' ' ? -1 : Number(ch)} from={start[i] === ' ' ? -1 : Number(start[i])} instant={instant} />)}
    </View>
  );
}
function Digit({ d, from, instant }: { d: number; from: number; instant: boolean }) {
  // Row 0 is blank (a digit the old total didn't have), rows 1-10 are 0-9.
  const y = useSharedValue(from + 1);
  useEffect(() => {
    y.value = instant ? d + 1 : withTiming(d + 1, { duration: T.odoDur, easing: Easing.bezier(0.2, 0.9, 0.3, 1) });
  }, [d, instant, y]);
  const st = useAnimatedStyle(() => ({ transform: [{ translateY: -y.value * DIGIT_H }] }));
  return (
    <View style={styles.digitCell}>
      <Animated.View style={st}>
        <Text style={styles.digit}> </Text>
        {Array.from({ length: 10 }, (_, n) => <Text key={n} style={styles.digit}>{n}</Text>)}
      </Animated.View>
    </View>
  );
}

/** A medal card: a colored disc with a dashed ring and the place's sticker, the rank, a two-line label, ▲ when it improved. */
function Medal({ medal, step, t, onPress }: { medal: ScoreWinMedal; step: SharedValue<number>; t: TFn; onPress: () => void }) {
  const st = useAnimatedStyle(() => ({ transform: [{ scale: step.value }, { rotate: `${-8 * (1 - step.value)}deg` }] }));
  const city = shortCityName(medal.city?.name ?? '');
  const tone = W.medal[medal.key];
  const icon = medal.key === 'world' ? '🌍' : medal.key === 'cities' ? '🏙️' : (countryToFlag(medal.city?.country ?? null) || '📍');
  const label = medal.key === 'world' ? t('scoreWin.medal.world')
    : medal.key === 'cities' ? (medal.rank === 1 ? t('scoreWin.medal.citiesTop', { city }) : t('scoreWin.medal.cities', { city }))
    : t('scoreWin.medal.city', { city });
  const up = medal.prevRank === null ? null : medal.prevRank - medal.rank;
  return (
    <Animated.View style={[styles.medalWrap, st]}>
      <Pressable onPress={onPress} style={({ pressed }) => [styles.medal3d, pressed && styles.pressed]} accessibilityRole="button"
                 accessibilityLabel={`#${medal.rank}, ${label}${up && up > 0 ? `, ${t('scoreWin.up', { count: up })}` : ''}`} testID={`win-medal-${medal.key}`}>
        <View style={styles.medal}>
          <View style={[styles.disc, { backgroundColor: tone.bg }]}>
            <View style={[styles.ring, { borderColor: tone.fg }]} />
            <Text style={styles.discIcon}>{icon}</Text>
          </View>
          <Text style={styles.rank} numberOfLines={1} adjustsFontSizeToFit>#{medal.rank}</Text>
          <Text style={styles.medalLabel} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Text>
          {up !== null && up > 0 ? <Text style={styles.up}>▲ {up}</Text>
            : medal.prevRank === null ? <Text style={styles.up}>{t('scoreWin.new')}</Text> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** Rays: 15 white wedges (10° every 24°), fading out from the middle. */
function Rays() {
  const R = 210;
  const wedges = Array.from({ length: 15 }, (_, i) => {
    const a = (i * 24 - 90) * (Math.PI / 180), b = (i * 24 + 10 - 90) * (Math.PI / 180);
    return `M${R} ${R} L${R + R * Math.cos(a)} ${R + R * Math.sin(a)} A${R} ${R} 0 0 1 ${R + R * Math.cos(b)} ${R + R * Math.sin(b)} Z`;
  });
  return (
    <Svg width={R * 2} height={R * 2}>
      <Defs>
        <RadialGradient id="rayFade" cx="50%" cy="50%" r="50%">
          <Stop offset="0.25" stopColor="#FFFFFF" stopOpacity={0.28} />
          <Stop offset="0.65" stopColor="#FFFFFF" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      {wedges.map((d, i) => <Path key={i} d={d} fill="url(#rayFade)" />)}
    </Svg>
  );
}

/** 70 confetti pieces over the whole screen, as in the mockup. */
function ConfettiRain() {
  const { width, height } = Dimensions.get('window');
  const pieces = useMemo(() => Array.from({ length: 70 }, (_, i) => ({
    x: Math.random() * width, color: W.confetti[i % W.confetti.length], dx: Math.random() * 120 - 60,
    r: Math.random() * 720 - 360, dur: 1600 + Math.random() * 1400, delay: 200 + Math.random() * 600,
  })), [width]);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((p, i) => <Piece key={i} {...p} fall={height} />)}
    </View>
  );
}
function Piece({ x, color, dx, r, dur, delay, fall }: { x: number; color: string; dx: number; r: number; dur: number; delay: number; fall: number }) {
  const v = useSharedValue(0);
  useEffect(() => { v.value = withDelay(delay, withTiming(1, { duration: dur, easing: Easing.in(Easing.ease) })); }, [v, delay, dur]);
  const st = useAnimatedStyle(() => ({
    opacity: v.value === 0 ? 0 : interpolate(v.value, [0, 1], [1, 0]),
    transform: [{ translateX: dx * v.value }, { translateY: -12 + fall * v.value }, { rotate: `${r * v.value}deg` }],
  }));
  return <Animated.View style={[styles.piece, { left: x, backgroundColor: color }, st]} />;
}

const styles = StyleSheet.create({
  dim:        { flex: 1, backgroundColor: W.dim, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 22 },
  card:       { alignSelf: 'center', width: '100%', maxWidth: 400, borderRadius: 30, overflow: 'hidden',
                shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 25, shadowOffset: { width: 0, height: 20 }, elevation: 18 },
  rays:       { position: 'absolute', top: -60, alignSelf: 'center', width: 420, height: 420 },
  doodle:     { position: 'absolute', opacity: 0.35, fontSize: 22 },
  close:      { position: 'absolute', top: 14, right: 14, width: 30, height: 30, borderRadius: 15, backgroundColor: W.closeBg,
                alignItems: 'center', justifyContent: 'center', zIndex: 3 },
  closeText:  { fontSize: 14, fontWeight: '900', color: W.ink },
  column:     { alignItems: 'center', paddingTop: 22, paddingHorizontal: 18, paddingBottom: 18 },
  trophy:     { fontSize: 60, lineHeight: 70, textShadowColor: 'rgba(160,90,0,0.35)', textShadowOffset: { width: 0, height: 6 }, textShadowRadius: 0 },
  plusRow:    { flexDirection: 'row', alignItems: 'flex-end', marginTop: 6 },
  plus:       { fontSize: 54, lineHeight: 60, fontWeight: '900', color: '#FFFFFF', letterSpacing: -2 },
  plusStroke: { color: W.terra },
  plusShadow: { color: W.terra },
  plusUnit:   { fontSize: 22, fontWeight: '900', color: W.terra, marginLeft: 4, marginBottom: 6 },
  total:      { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF', borderRadius: 16,
                paddingVertical: 5, paddingLeft: 8, paddingRight: 12,
                shadowColor: 'rgb(160,90,0)', shadowOpacity: 0.25, shadowRadius: 0, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  totalUnit:  { fontSize: 13, fontWeight: '900', color: W.muted },
  coin:       { backgroundColor: W.coin, borderWidth: 2, borderColor: W.coinEdge, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  coinLight:  { position: 'absolute', top: 2, left: 2, backgroundColor: W.coinLight, opacity: 0.8 },
  coinText:   { fontSize: 11, fontWeight: '900', color: W.coinText },
  odo:        { flexDirection: 'row', height: DIGIT_H, overflow: 'hidden' },
  digitCell:  { height: DIGIT_H, overflow: 'hidden' },
  digit:      { height: DIGIT_H, lineHeight: DIGIT_H, fontSize: 18, fontWeight: '900', color: W.ink, fontVariant: ['tabular-nums'] },
  tag:        { marginTop: 12, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  chip:       { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'stretch', backgroundColor: W.glass, borderRadius: 16,
                paddingVertical: 6, paddingLeft: 6, paddingRight: 10 },
  thumb:      { width: 34, height: 34, borderRadius: 8, borderWidth: 2, borderColor: '#FFFFFF', transform: [{ rotate: '-5deg' }] },
  chipBody:   { flex: 1, minWidth: 0 },
  chipTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chipTitle:  { flexShrink: 1, fontSize: 13, fontWeight: '800', color: W.ink },
  chipSub:    { fontSize: 11, color: W.muted, lineHeight: 14 },
  pills:      { alignItems: 'flex-end', gap: 3 },
  pts:        { overflow: 'hidden', backgroundColor: W.orange, color: '#FFFFFF', fontWeight: '900', fontSize: 12, borderRadius: 10,
                paddingHorizontal: 7, paddingVertical: 3 },
  medals:     { flexDirection: 'row', gap: 7, marginTop: 12, alignSelf: 'stretch' },
  medalWrap:  { flex: 1, minWidth: 0 },
  medal3d:    { borderRadius: 18, backgroundColor: W.card3d, paddingBottom: 4 },
  medal:      { borderRadius: 18, backgroundColor: '#FFFFFF', paddingTop: 9, paddingBottom: 8, paddingHorizontal: 4, alignItems: 'center' },
  disc:       { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  ring:       { position: 'absolute', top: -3, left: -3, right: -3, bottom: -3, borderRadius: 23, borderWidth: 3, borderStyle: 'dashed', opacity: 0.5 },
  discIcon:   { fontSize: 20 },
  rank:       { fontSize: 17, fontWeight: '900', color: W.ink },
  medalLabel: { fontSize: 10.5, fontWeight: '700', color: W.muted, lineHeight: 12, textAlign: 'center' },
  up:         { fontSize: 10, fontWeight: '900', color: W.green, marginTop: 1 },
  goal:       { alignSelf: 'stretch', marginTop: 12, backgroundColor: W.glass, borderRadius: 16, paddingVertical: 9, paddingHorizontal: 12 },
  goalRow:    { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  goalText:   { flex: 1, fontSize: 12, fontWeight: '800', color: W.ink },
  goalCount:  { fontSize: 12, fontWeight: '800', color: W.ink },
  bar:        { height: 10, borderRadius: 6, backgroundColor: W.track, marginTop: 6, overflow: 'hidden' },
  barFill:    { height: '100%', borderRadius: 6, overflow: 'hidden' },
  ctas:       { alignSelf: 'stretch', marginTop: 12, gap: 8 },
  primaryShadow: { borderRadius: 18, backgroundColor: W.terraShadow, paddingBottom: 4 },
  primary:    { borderRadius: 18, backgroundColor: W.terra, paddingVertical: 11, alignItems: 'center' },
  primaryText:{ fontSize: 15, fontWeight: '900', color: '#FFFFFF' },
  secondary:  { borderRadius: 18, backgroundColor: '#FFFFFF', paddingVertical: 11, alignItems: 'center' },
  secondaryText: { fontSize: 15, fontWeight: '900', color: W.terra },
  pressed:    { opacity: 0.9, transform: [{ scale: 0.98 }] },
  piece:      { position: 'absolute', top: 0, width: 8, height: 12, borderRadius: 2 },
});
