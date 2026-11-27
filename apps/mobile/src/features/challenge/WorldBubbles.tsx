import { localizeCityName } from '@/i18n/cityName';
import { useEffect, useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { Space, FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { ACCENTS, FlagSticker, tint } from '@/ui/joy';
import type { AnswerChip } from './worldAnswers';

const MAX = 8;
const STAGGER_MS = 40;

/** A stable number from a string (rotation and tint never change between renders). */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Each city's tint: from the city and the day (the same all day, another the next), moved to the
 * next accent when it would match the city before it. A city's chips share its tint.
 */
function cityTints(cityIds: number[], seed: string): Map<number, string> {
  const n = ACCENTS.length;
  const out = new Map<number, string>();
  let prev = -1;
  for (const id of cityIds) {
    if (out.has(id)) continue;
    let k = hash(`${id}|${seed}`) % n;
    if (k === prev) k = (k + 1) % n;   // a city steps away from the one before
    prev = k;
    out.set(id, tint(ACCENTS[k], 0.22));
  }
  return out;
}

/**
 * "The world says" on the challenge screen: one speech bubble per answer (a city's flag and the
 * answer, identical answers of a city grouped "×3"), my city first with my answer marked "You", then
 * the cities with the most answers; a city's chips side by side in its tint. Each slightly rotated,
 * the tail corner alternating; 8 shown, then "+N more" opens the rest in place. They pop in one after
 * the other (none with "reduce motion"). Nobody yet: one dashed "Be the first to play".
 * `onOpen(ids)`: a chip's photos (most liked first).
 */
export function WorldBubbles({ chips, seed, onOpen, onFirst }: {
  chips: AnswerChip[];
  /** The challenge's date: the tints' day. */
  seed: string;
  onOpen: (ids: string[]) => void;
  /** The empty bubble's tap (play), when playing is possible. */
  onFirst?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const [open, setOpen] = useState(false);
  if (chips.length === 0) {
    return (
      <View style={styles.wrap}>
        <Bubble index={0} rotate={-1} tail="left" style={styles.empty} onPress={onFirst} label={t('worldSays.first')}>
          <Text style={styles.emptyText}>{t('worldSays.first')}</Text>
        </Bubble>
      </View>
    );
  }
  const shown = open ? chips : chips.slice(0, MAX);
  const more = chips.length - shown.length;
  const colors = cityTints(chips.map(c => c.city.id), seed);
  return (
    <View style={styles.wrap}>
      {shown.map((c, i) => {
        const h = hash(c.key);
        const city = localizeCityName(c.city.name);
        return (
          <Bubble key={c.key} index={open && i >= MAX ? i - MAX : i} rotate={(h % 41) / 10 - 2} tail={i % 2 === 0 ? 'left' : 'right'}
                  style={[{ backgroundColor: colors.get(c.city.id) }, c.mine && styles.mine]}
                  onPress={() => onOpen(c.ids)}
                  label={`${city}: ${c.text || '📷'}${c.ids.length > 1 ? `, ×${c.ids.length}` : ''}${c.mine ? `, ${t('worldSays.you')}` : ''}`} testID="world-bubble">
            <FlagSticker country={c.city.country} size={18} />
            <Text style={styles.text} numberOfLines={2}>{c.text || '📷'}</Text>
            {c.ids.length > 1 && <Text style={styles.count}>×{c.ids.length}</Text>}
            {c.mine && <Text style={styles.you}>{t('worldSays.you')}</Text>}
          </Bubble>
        );
      })}
      {more > 0 && (
        <Bubble index={shown.length} rotate={1} tail="right" style={styles.more} onPress={() => setOpen(true)} label={t('worldSays.more', { count: more })} testID="world-bubble-more">
          <Text style={styles.moreText}>{t('worldSays.more', { count: more })}</Text>
        </Bubble>
      )}
    </View>
  );
}

function Bubble({ index, rotate, tail, style, onPress, label, testID, children }: {
  index: number; rotate: number; tail: 'left' | 'right'; style?: object | (object | false)[]; onPress?: () => void; label: string; testID?: string; children: React.ReactNode;
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
  wrap:      { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md, paddingVertical: Space.xs },
  bubble:    { flexDirection: 'row', alignItems: 'center', gap: Space.sm, maxWidth: 260, paddingHorizontal: Space.md, paddingVertical: Space.sm, borderRadius: 18 },
  tailLeft:  { borderBottomLeftRadius: 4 },
  tailRight: { borderBottomRightRadius: 4 },
  pressed:   { opacity: 0.75 },
  text:      { flexShrink: 1, fontSize: FontSizes.sm, lineHeight: 19, fontWeight: '800', color: c.text },
  more:      { backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line },
  mine:      { borderWidth: 2, borderColor: c.text },
  count:     { fontSize: FontSizes.sm, fontWeight: '900', color: c.text },
  you:       { fontSize: 11, lineHeight: 14, fontWeight: '800', color: c.bg, backgroundColor: c.text, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  moreText:  { fontSize: FontSizes.sm, fontWeight: '800', color: c.primaryText },
  empty:     { borderWidth: 2, borderStyle: 'dashed', borderColor: c.primaryText, backgroundColor: c.primaryTint },
  emptyText: { fontSize: FontSizes.sm, fontWeight: '800', color: c.primaryOnTint },
});
