import { useEffect, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
import { useIsFocused } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing } from '@/constants';
import { ThemeOverride } from '@/context/ThemeContext';
import { useSeasonal, useSeasonalLive } from './seasonal';

/**
 * A seasonal event's art (Halloween first): drawn, cute, never gory. Every
 * piece is decorative (hidden from screen readers) and still with the OS
 * "Reduce motion" setting. Fixed colors: they sit on photos or on the
 * event's own palette.
 */

const NIGHT  = '#1A1030';
const CARD   = '#251842';
const INK    = '#F6F0FF';
const ORANGE = '#FF8A1F';
const HIDDEN = { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' } as const;

/**
 * The live phase's palette on a subtree (the whole tab bar and its tabs, the
 * Daily screens: the challenge sheet, See all, the viewer, the camera): its
 * themed styles read the event's colors; the status bar turns light while the
 * screen is focused.
 */
export function SeasonalScope({ children }: { children: ReactNode }) {
  const live = useSeasonalLive();
  const focused = useIsFocused();
  return (
    <ThemeOverride colors={live?.theme.colors ?? null} theme={live?.theme.mode ?? 'dark'}>
      {live && focused && <StatusBar style="light" backgroundColor={live.theme.colors.bg} />}
      {children}
    </ThemeOverride>
  );
}

/** Pumpkin, drawn on Ionicons' 24-unit grid with their stroke (the week strip's day icon). */
export function PumpkinIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6}
         strokeLinecap="round" strokeLinejoin="round" {...HIDDEN}>
      <Path d="M12 7c-1.2-.9-3-1.2-4.6-.6C4.6 7.5 3 10 3 13.1 3 17.2 5.9 20.5 9.3 20.5c1 0 1.9-.3 2.7-.8.8.5 1.7.8 2.7.8 3.4 0 6.3-3.3 6.3-7.4 0-3.1-1.6-5.6-4.4-6.7-1.6-.6-3.4-.3-4.6.6z" />
      <Path d="M12 7c-1.5 1.6-2.3 3.9-2.3 6.3s.8 4.8 2.3 6.4" />
      <Path d="M12 7c1.5 1.6 2.3 3.9 2.3 6.3s-.8 4.8-2.3 6.4" />
      <Path d="M12 7c0-1.7.7-3 2.2-3.6" />
    </Svg>
  );
}

/** An event day's icon in the week strip (Halloween: the pumpkin), else null. */
export function SeasonalDayIcon({ themeKey, size, color }: { themeKey: string; size: number; color: string }) {
  return themeKey === 'halloween' ? <PumpkinIcon size={size} color={color} /> : null;
}

// A corner cobweb: 5 threads from the corner, 3 sagging rings.
const WEB = (() => {
  const angles = [0, 22.5, 45, 67.5, 90].map(a => (a * Math.PI) / 180);
  const pt = (r: number, a: number) => [r * Math.cos(a), r * Math.sin(a)];
  const threads = angles.map(a => { const [x, y] = pt(64, a); return `M0 0L${x.toFixed(1)} ${y.toFixed(1)}`; });
  const rings = [18, 34, 50].map(r => angles.slice(1).reduce((d, a, i) => {
    const [x0, y0] = pt(r, angles[i]);
    const [x1, y1] = pt(r, a);
    const [cx, cy] = pt(r * 0.82, (angles[i] + a) / 2);   // sags toward the corner
    return `${d}${i === 0 ? `M${x0.toFixed(1)} ${y0.toFixed(1)}` : ''}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }, ''));
  return [...threads, ...rings];
})();

function Cobweb({ flip, size = 64 }: { flip?: boolean; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="rgba(255,255,255,0.72)" strokeWidth={1.3}
         style={flip ? { transform: [{ scaleX: -1 }] } : undefined} {...HIDDEN}>
      {WEB.map(d => <Path key={d} d={d} />)}
    </Svg>
  );
}

/** A small round ghost with a smile. */
function Ghost({ size }: { size: number }) {
  return (
    <Svg width={size} height={size * 1.15} viewBox="0 0 24 27.6" {...HIDDEN}>
      <Path d="M12 1.5C6.8 1.5 3.5 5.4 3.5 10.4V26l2.8-2.1 2.9 2.1 2.8-2.1 2.8 2.1 2.9-2.1 2.8 2.1V10.4c0-5-3.3-8.9-8.5-8.9z"
            fill="#FFFFFF" fillOpacity={0.92} />
      <Ellipse cx={9.2} cy={11} rx={1.4} ry={1.9} fill={NIGHT} />
      <Ellipse cx={14.8} cy={11} rx={1.4} ry={1.9} fill={NIGHT} />
      <Path d="M10.4 15.2c.9.9 2.3.9 3.2 0" stroke={NIGHT} strokeWidth={1.2} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/** Motion runs only on screen, focused, in the foreground, without Reduce motion. */
function useMotion(visible: boolean): boolean {
  const reduced = useReducedMotion();
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return visible && focused && active && !reduced;
}

function FloatingGhost({ size, left, top, period, delay, run }: {
  size: number; left: `${number}%`; top: `${number}%`; period: number; delay: number; run: boolean;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (!run) { cancelAnimation(t); t.value = 0; return; }
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration: period, easing: Easing.inOut(Easing.sin) }), -1, true));
    return () => cancelAnimation(t);
  }, [run, t, period, delay]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -8 * t.value }, { translateX: 5 * t.value - 2.5 }, { rotate: `${6 * t.value - 3}deg` }],
    opacity: 0.75 + 0.2 * t.value,
  }));
  return <Animated.View style={[{ position: 'absolute', left, top }, style]} pointerEvents="none"><Ghost size={size} /></Animated.View>;
}

/** The live hero's decorations: cobwebs in the top corners, 3 ghosts floating slowly over the photo. */
export function SeasonalHeroDecor({ visible = true }: { visible?: boolean }) {
  const live = useSeasonalLive();
  const run = useMotion(visible);
  if (live?.key !== 'halloween') return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" {...HIDDEN}>
      <View style={styles.webLeft}><Cobweb /></View>
      <View style={styles.webRight}><Cobweb flip /></View>
      <FloatingGhost size={26} left="14%" top="30%" period={3400} delay={0} run={run} />
      <FloatingGhost size={20} left="72%" top="22%" period={4100} delay={700} run={run} />
      <FloatingGhost size={16} left="48%" top="12%" period={3800} delay={1400} run={run} />
    </View>
  );
}

/** A witch hat on the "Hi" logo (40 pt) while the event is live. */
export function LogoHat({ logoSize }: { logoSize: number }) {
  const live = useSeasonalLive();
  if (live?.key !== 'halloween') return null;
  const s = Math.round(logoSize * 0.62);
  return (
    <View style={{ position: 'absolute', left: -s * 0.3, top: -s * 0.4, transform: [{ rotate: '-18deg' }] }} pointerEvents="none" {...HIDDEN}>
      <Svg width={s} height={s} viewBox="0 0 24 24">
        <Path d="M7.2 18.2 12.6 3.4c.4-1 1.7-1.3 2.4-.4l.4.6-1.6 1 2.2 13.6z" fill="#3B2266" />
        <Rect x={8.3} y={14.6} width={8.6} height={2.4} rx={0.6} fill={ORANGE} />
        <Ellipse cx={12} cy={18.6} rx={10.5} ry={2.6} fill="#2A1850" />
      </Svg>
    </View>
  );
}

const BAT_COUNT = 8;

function Bat({ index, run }: { index: number; run: boolean }) {
  const t = useSharedValue(0);
  const angle = (index / BAT_COUNT) * Math.PI * 2 + (index % 2 ? 0.25 : -0.1);
  const dist = 70 + (index % 3) * 18;
  useEffect(() => {
    if (!run) return;
    t.value = withDelay(index * 35, withSequence(withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) })));
    return () => cancelAnimation(t);
  }, [run, t, index]);
  const style = useAnimatedStyle(() => ({
    opacity: t.value < 0.7 ? 1 : 1 - (t.value - 0.7) / 0.3,
    transform: [
      { translateX: Math.cos(angle) * dist * t.value },
      { translateY: Math.sin(angle) * dist * t.value - 20 * t.value },
      { scale: 0.4 + 0.8 * t.value },
    ],
  }));
  return <Animated.Text style={[styles.bat, style]}>🦇</Animated.Text>;
}

/**
 * After posting a photo while live: a burst of bats out of the success
 * badge (instead of the checkmark); a single still bat with Reduce motion.
 */
export function BatBurst({ size = 64 }: { size?: number }) {
  const reduced = useReducedMotion();
  return (
    <View style={[styles.burst, { width: size, height: size, borderRadius: size / 2 }]} {...HIDDEN}>
      {!reduced && Array.from({ length: BAT_COUNT }, (_, i) => <Bat key={i} index={i} run />)}
      <Text style={styles.burstCenter}>🦇</Text>
    </View>
  );
}

/** Teaser days shown before the start: closer, the countdown waits (on the day, the hero is the event). */
const TEASER_DAYS = 3;

/** Teaser: a compact one-line countdown under Today's hero ("Halloween hunt in 2 days"), the last 3 days. */
export function SeasonalTeaser() {
  const s = useSeasonal();
  const { t } = useTranslation('daily');
  if (!s || s.event.phase !== 'teaser') return null;
  const days = s.event.startsInDays ?? 1;
  if (days > TEASER_DAYS) return null;
  return (
    <View style={styles.teaser} accessibilityRole="text">
      {s.key === 'halloween' && <View style={styles.teaserGhost}><Ghost size={20} /></View>}
      <Text style={styles.teaserText} numberOfLines={1}>{t(s.theme.copy.teaser, { count: days })}</Text>
    </View>
  );
}

/**
 * A tab header's live touch (Hi, Passport... every ScreenHeader "tab"): a
 * cobweb in the top corner and a ghost floating over the line drawing.
 */
export function SeasonalHeaderDecor() {
  const live = useSeasonalLive();
  const run = useMotion(true);
  if (live?.key !== 'halloween') return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" {...HIDDEN}>
      <View style={styles.headerWeb}><Cobweb flip size={58} /></View>
      <FloatingGhost size={24} left="22%" top="18%" period={3600} delay={0} run={run} />
      <FloatingGhost size={15} left="62%" top="52%" period={4200} delay={900} run={run} />
    </View>
  );
}

/**
 * The tab bar's live touch: a little ghost peeking over the active tab. It
 * hops in when the tab changes (it remounts with the tab), then bobs.
 */
export function TabGhost() {
  const live = useSeasonalLive();
  const run = useMotion(true);
  const hop = useSharedValue(run ? 1 : 0);
  const bob = useSharedValue(0);
  useEffect(() => {
    if (!run) { hop.value = 0; bob.value = 0; return; }
    hop.value = withSequence(withTiming(1, { duration: 0 }), withTiming(0, { duration: 420, easing: Easing.out(Easing.back(3)) }));
    bob.value = withDelay(420, withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.sin) }), -1, true));
    return () => { cancelAnimation(hop); cancelAnimation(bob); };
  }, [run, hop, bob]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: 14 * hop.value - 3 * bob.value }, { rotate: `${8 * bob.value - 4}deg` }],
    opacity: 1 - hop.value * 0.6,
  }));
  if (live?.key !== 'halloween') return null;
  return <Animated.View style={[styles.tabGhost, style]} pointerEvents="none" {...HIDDEN}><Ghost size={20} /></Animated.View>;
}

/** A bat silhouette, wings spread (24-unit box). */
function BatShape({ size, color = '#2A1850' }: { size: number; color?: string }) {
  return (
    <Svg width={size} height={size * 0.6} viewBox="0 0 24 14.4">
      <Path d="M12 4.2c-.5-1.3-1.3-2-2-2.2.3.7.3 1.4 0 1.9C8.4 2.6 5.6 1.6 1 3.4c1.9.6 3 1.9 3.2 3.6 1.6-.9 3.3-.6 4.4.5.9.9 1.7 2.3 3.4 4.3 1.7-2 2.5-3.4 3.4-4.3 1.1-1.1 2.8-1.4 4.4-.5.2-1.7 1.3-3 3.2-3.6-4.6-1.8-7.4-.8-9 .5-.3-.5-.3-1.2 0-1.9-.7.2-1.5.9-2 2.2z"
            fill={color} stroke="#C3B5DE" strokeWidth={0.6} strokeLinejoin="round" />
      <Circle cx={11.1} cy={4.9} r={0.45} fill="#FF8A1F" />
      <Circle cx={12.9} cy={4.9} r={0.45} fill="#FF8A1F" />
    </Svg>
  );
}

/** A bat crossing the screen from left to right, wings flapping, then again. */
function FlyingBat({ size, top, period, delay, run, width }: {
  size: number; top: number; period: number; delay: number; run: boolean; width: number;
}) {
  const x = useSharedValue(0);
  const flap = useSharedValue(0);
  useEffect(() => {
    if (!run) { cancelAnimation(x); cancelAnimation(flap); x.value = 0.3; flap.value = 0; return; }
    x.value = 0;
    x.value = withDelay(delay, withRepeat(withTiming(1, { duration: period, easing: Easing.linear }), -1, false));
    flap.value = withRepeat(withTiming(1, { duration: 180, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => { cancelAnimation(x); cancelAnimation(flap); };
  }, [run, x, flap, period, delay]);
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: -size + (width + size * 2) * x.value },
      { translateY: Math.sin(x.value * Math.PI * 4) * 10 },
      { scaleY: 1 - 0.55 * flap.value },
    ],
  }));
  return <Animated.View style={[{ position: 'absolute', left: 0, top }, style]} pointerEvents="none"><BatShape size={size} /></Animated.View>;
}

/**
 * The map's live sky (over the night map style): a crescent moon and bats
 * crossing under the search bar. `top`: where the map's top overlay ends.
 */
export function SeasonalMapSky({ top }: { top: number }) {
  const live = useSeasonalLive();
  const run = useMotion(true);
  const { width } = useWindowDimensions();
  if (live?.key !== 'halloween') return null;
  return (
    <View style={[StyleSheet.absoluteFill, { top }]} pointerEvents="none" {...HIDDEN}>
      <View style={styles.moon}>
        <Svg width={54} height={54} viewBox="0 0 54 54">
          <Circle cx={27} cy={27} r={24} fill="#FFE7B0" opacity={0.18} />
          <Path d="M33 8a19 19 0 1 0 13 30A16 16 0 0 1 33 8z" fill="#FFD27A" />
        </Svg>
      </View>
      <FlyingBat size={44} top={24} period={9000} delay={0} run={run} width={width} />
      <FlyingBat size={32} top={78} period={12500} delay={3200} run={run} width={width} />
      <FlyingBat size={24} top={48} period={15000} delay={6800} run={run} width={width} />
    </View>
  );
}

const styles = StyleSheet.create({
  webLeft:  { position: 'absolute', left: 0, top: 0 },
  headerWeb: { position: 'absolute', right: 0, top: 0 },
  tabGhost: { position: 'absolute', top: -16, alignSelf: 'center' },
  moon:     { position: 'absolute', right: 18, top: 6 },
  webRight: { position: 'absolute', right: 0, top: 0 },
  bat:      { position: 'absolute', fontSize: 22 },
  burst:    { alignItems: 'center', justifyContent: 'center', backgroundColor: CARD, borderWidth: 1.5, borderColor: ORANGE },
  burstCenter: { fontSize: 30 },
  teaser: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: Radius.card, backgroundColor: NIGHT,
    borderWidth: 1.5, borderColor: '#3D2A64',
  },
  teaserGhost: { width: 26, alignItems: 'center' },
  // 16.2:1 on the night ground.
  teaserText: { flex: 1, color: INK, fontSize: FontSizes.sm, fontWeight: '700', lineHeight: 20 },
});
