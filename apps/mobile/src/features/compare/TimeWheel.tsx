import { useEffect, useRef } from 'react';
import { ScrollView, Text, View, StyleSheet, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import { type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { formatTime, HALF_HOURS } from './format';

const ROW = 48;
const VISIBLE = 5;   // odd: the middle row is the value
// Inline, not in StyleSheet.create: scaling.ts shrinks padding on narrow phones,
// and the snapping math needs exactly 2 rows above and below.
const PAD = { paddingVertical: ROW * Math.floor(VISIBLE / 2) };

/**
 * A wheel of half-hours (00:00 to 23:30) that snaps on each row: the answer to
 * a time question (SPEC 10.2, rounded to 30 minutes). The same on iOS and
 * Android, 12 or 24 h by locale. Screen readers adjust it with swipe up / down.
 */
export function TimeWheel({ value, onChange }: { value: number; onChange: (minutes: number) => void }) {
  const styles = useThemedStyles(makeStyles);
  const { i18n } = useTranslation();
  const ref = useRef<ScrollView>(null);
  const index = Math.max(0, HALF_HOURS.indexOf(value));
  const last = useRef(index);
  const initialOffset = useRef({ x: 0, y: index * ROW }).current;
  // A scroll we started (step, outside value): its end must not count as a new pick.
  const programmatic = useRef(false);

  // Follow a value set from outside (an edit's saved answer).
  useEffect(() => {
    if (last.current !== index) {
      last.current = index;
      programmatic.current = true;
      ref.current?.scrollTo({ y: index * ROW, animated: false });
    }
  }, [index]);

  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (programmatic.current) { programmatic.current = false; return; }
    const i = Math.min(HALF_HOURS.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.y / ROW)));
    last.current = i;
    if (HALF_HOURS[i] !== value) onChange(HALF_HOURS[i]);
  };
  const step = (d: number) => {
    const i = Math.min(HALF_HOURS.length - 1, Math.max(0, index + d));
    last.current = i;
    programmatic.current = true;
    ref.current?.scrollTo({ y: i * ROW, animated: true });
    onChange(HALF_HOURS[i]);
  };

  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityRole="adjustable"
      accessibilityValue={{ text: formatTime(value, i18n.language) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={e => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
    >
      <View style={styles.band} pointerEvents="none" />
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW}
        decelerationRate="fast"
        contentOffset={initialOffset}
        contentContainerStyle={PAD}
        onScrollBeginDrag={() => { programmatic.current = false; }}
        onMomentumScrollEnd={settle}
        onScrollEndDrag={e => { if (!e.nativeEvent.velocity || Math.abs(e.nativeEvent.velocity.y) < 0.05) settle(e); }}
        nestedScrollEnabled
      >
        {HALF_HOURS.map(m => (
          <View key={m} style={styles.row}>
            <Text style={[styles.time, m === value && styles.timeOn]}>{formatTime(m, i18n.language)}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:    { height: ROW * VISIBLE, borderRadius: 18, backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line, overflow: 'hidden' },
  band:    { position: 'absolute', left: 10, right: 10, top: ROW * Math.floor(VISIBLE / 2), height: ROW, borderRadius: 12, backgroundColor: c.primaryTint },
  row:     { height: ROW, alignItems: 'center', justifyContent: 'center' },
  time:    { fontSize: 20, fontWeight: '600', color: c.muted, fontVariant: ['tabular-nums'] },
  timeOn:  { fontSize: 24, fontWeight: '800', color: c.primaryOnTint },
});
