import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { BatBurst, PumpkinIcon } from './SeasonalArt';

/**
 * The event's limited-edition stamp (event mode: Halloween 2026 first): a
 * scalloped stamp in orange and purple ink, the pumpkin in the middle. Earned
 * by posting on the event's special day (the backend's special stamp); never
 * one of the 7 theme stamps.
 */

const ORANGE = '#E8740C';   // ink colors: art, readable on light and dark grounds
const PURPLE = '#7A4BC2';

/** A scalloped ring: n bumps around a circle (viewBox 100). */
function scallop(n = 18, r = 46, bump = 4): string {
  let d = '';
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const rr = i % 2 ? r - bump : r;
    d += `${i ? 'L' : 'M'}${(50 + Math.cos(a) * rr).toFixed(2)} ${(50 + Math.sin(a) * rr).toFixed(2)} `;
  }
  return d + 'Z';
}
const RING = scallop();

export function EventStamp({ size, rotation = -8 }: { size: number; rotation?: number }) {
  return (
    <View style={{ width: size, height: size, transform: [{ rotate: `${rotation}deg` }] }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Path d={RING} fill="#FFE3C4" stroke={ORANGE} strokeWidth={3} />
        <Circle cx={50} cy={50} r={33} fill="none" stroke={PURPLE} strokeWidth={2} strokeDasharray="4 3" />
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <PumpkinIcon size={size * 0.42} color={ORANGE} />
      </View>
    </View>
  );
}

/** Is this special day stamp the event's (Halloween 2026: id "halloween" or "halloween-2026")? */
export const isEventStampId = (id: string) => id.startsWith('halloween');

/**
 * The thunk after posting on the event's day: the stamp lands from above with
 * a heavy haptic and a little spooky burst, "Limited-edition stamp earned!",
 * then fades out (a tap closes it). A plain fade with Reduce motion.
 */
export function EventStampThunk({ name, onDone }: { name: string; onDone: () => void }) {
  const { t } = useTranslation('daily');
  const styles = useThemedStyles(makeStyles);
  const reduced = useReducedMotion();
  const s = useSharedValue(reduced ? 1 : 1.9);
  const r = useSharedValue(reduced ? -8 : -26);
  const o = useSharedValue(0);
  useEffect(() => {
    o.value = withTiming(1, { duration: 120 });
    if (!reduced) {
      s.value = withSpring(1, { damping: 9, stiffness: 220 });
      r.value = withSpring(-8, { damping: 10 });
    }
    const thunk = setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}), reduced ? 0 : 160);
    o.value = withDelay(2400, withTiming(0, { duration: 300, easing: Easing.in(Easing.quad) }));
    const close = setTimeout(onDone, 2750);
    return () => { clearTimeout(thunk); clearTimeout(close); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const wrap = useAnimatedStyle(() => ({ opacity: o.value }));
  const stamp = useAnimatedStyle(() => ({ transform: [{ scale: s.value }, { rotate: `${r.value}deg` }] }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, wrap]}>
      <Pressable style={styles.center} onPress={onDone} accessibilityRole="button" accessibilityLabel={t('event.stampEarned')}>
        <View style={styles.burst}><BatBurst size={72} /></View>
        <Animated.View style={stamp}><EventStamp size={168} rotation={0} /></Animated.View>
        <Text style={styles.title}>{t('event.stampEarned')}</Text>
        <Text style={styles.name}>{name}</Text>
        <View style={styles.pill}><Text style={styles.pillText}>{t('event.limited')}</Text></View>
      </Pressable>
    </Animated.View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  scrim:    { backgroundColor: c.scrim, zIndex: 20 },
  center:   { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  burst:    { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  title:    { fontSize: FontSizes.xl, fontWeight: '800', color: c.white, textAlign: 'center', marginTop: 12 },
  name:     { fontSize: FontSizes.md, fontWeight: '700', color: c.white, textAlign: 'center' },
  pill:     { backgroundColor: PURPLE, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 4 },
  pillText: { fontSize: FontSizes.xs, fontWeight: '800', color: c.white, letterSpacing: 0.5 },
});
