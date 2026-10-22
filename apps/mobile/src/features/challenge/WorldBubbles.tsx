import { useEffect } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { answerText } from '@/features/compare/format';
import { ACCENTS, FlagSticker, tint } from '@/ui/joy';
import type { DailyCountryGroup } from '@/types';

const MAX = 6;
const STAGGER_MS = 40;

/** A stable number from a country code (rotation and tint never change between renders). */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Each bubble's tint: from its country and the day (the same all day, another
 * the next), moved to the next accent when it would match the bubble before
 * it, so two neighbours never share a color.
 */
function tints(countries: string[], seed: string): string[] {
  const n = ACCENTS.length;
  const base = countries.map(c => hash(`${c}|${seed}`) % n);
  const out: number[] = [];
  base.forEach((b, i) => {
    let k = b;
    while (i > 0 && k === out[i - 1]) k = (k + 1) % n;   // each bubble steps away from the one before
    out.push(k);
  });
  return out.map(i => tint(ACCENTS[i], 0.22));
}

/** A photo's line in its bubble: its answer, else its caption, else its place. */
function bubbleText(g: DailyCountryGroup, locale: string): string {
  const p = g.top;
  if (p.answer && !p.backHome) return answerText(p.answer, locale);
  return p.caption ?? p.spot?.name ?? p.place?.name ?? '';
}

/**
 * "The world says" on the challenge screen: one speech bubble per country
 * that played (its flag and its top photo's answer), wrapping, each slightly
 * rotated (-2° to +2°, fixed per country) on a tint of the joyful accents
 * (never the same as its neighbour), the tail corner alternating; up to 6, then "+N more". They pop in one
 * after the other (none with "reduce motion"). Nobody yet: one dashed "Be
 * the first to answer". `onOpen(country)`: a bubble; `onOpen(null)`: "+N".
 */
export function WorldBubbles({ items, seed, onOpen, onFirst }: {
  /** In the shared country order (compareCountryGroups). */
  items: DailyCountryGroup[];
  /** The challenge's date: the tints' day. */
  seed: string;
  onOpen: (country: string | null) => void;
  /** The empty bubble's tap (play), when playing is possible. */
  onFirst?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t, i18n } = useTranslation('daily');
  if (items.length === 0) {
    return (
      <View style={styles.wrap}>
        <Bubble index={0} rotate={-1} tail="left" style={styles.empty} onPress={onFirst} label={t('worldSays.first')}>
          <Text style={styles.emptyText}>{t('worldSays.first')}</Text>
        </Bubble>
      </View>
    );
  }
  const shown = items.slice(0, MAX);
  const more = items.length - shown.length;
  const colors = tints(shown.map(g => g.country), seed);
  return (
    <View style={styles.wrap}>
      {shown.map((g, i) => {
        const h = hash(g.country);
        const text = bubbleText(g, i18n.language);
        return (
          <Bubble key={g.country} index={i} rotate={(h % 41) / 10 - 2} tail={i % 2 === 0 ? 'left' : 'right'}
                  style={{ backgroundColor: colors[i] }}
                  onPress={() => onOpen(g.country)} label={`${g.city.name}: ${text}`} testID="world-bubble">
            <FlagSticker country={g.country} size={18} />
            <Text style={styles.text} numberOfLines={2}>{text}</Text>
          </Bubble>
        );
      })}
      {more > 0 && (
        <Bubble index={shown.length} rotate={1} tail="right" style={styles.more} onPress={() => onOpen(null)} label={t('worldSays.more', { count: more })}>
          <Text style={styles.moreText}>{t('worldSays.more', { count: more })}</Text>
        </Bubble>
      )}
    </View>
  );
}

function Bubble({ index, rotate, tail, style, onPress, label, testID, children }: {
  index: number; rotate: number; tail: 'left' | 'right'; style?: object; onPress?: () => void; label: string; testID?: string; children: React.ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  const reduced = useReducedMotion();
  const pop = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    pop.value = withDelay(index * STAGGER_MS, withSpring(1, { damping: 12, stiffness: 180 }));
  }, [reduced, index, pop]);
  const anim = useAnimatedStyle(() => ({ opacity: pop.value, transform: [{ rotate: `${rotate}deg` }, { scale: 0.8 + pop.value * 0.2 }] }));
  return (
    <Animated.View style={anim}>
      <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityLabel={label} testID={testID}
                 style={({ pressed }) => [styles.bubble, tail === 'left' ? styles.tailLeft : styles.tailRight, style, pressed && styles.pressed]}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:      { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingVertical: 4 },
  bubble:    { flexDirection: 'row', alignItems: 'center', gap: 7, maxWidth: 260, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 18 },
  tailLeft:  { borderBottomLeftRadius: 4 },
  tailRight: { borderBottomRightRadius: 4 },
  pressed:   { opacity: 0.75 },
  text:      { flexShrink: 1, fontSize: FontSizes.sm, lineHeight: 19, fontWeight: '800', color: c.text },
  more:      { backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line },
  moreText:  { fontSize: FontSizes.sm, fontWeight: '800', color: c.primaryText },
  empty:     { borderWidth: 2, borderStyle: 'dashed', borderColor: c.primaryText, backgroundColor: c.primaryTint },
  emptyText: { fontSize: FontSizes.sm, fontWeight: '800', color: c.primaryOnTint },
});
