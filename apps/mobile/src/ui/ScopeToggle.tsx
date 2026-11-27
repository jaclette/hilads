import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, Text, View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Border, Radius, Space, Type, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { CityFlag } from './CityName';

/**
 * A compact two-way toggle with a sliding thumb ("🌍 World | 🇻🇳 Saigon"), sized to its labels
 * (not the full width), a selection haptic on change; no slide with reduce motion.
 */
export type ToggleOption<K extends string> = { key: K; label: string; emoji?: string; flag?: string | null };

export function ScopeToggle<K extends string>({ options, value, onChange, testID }: {
  options: [ToggleOption<K>, ToggleOption<K>]; value: K; onChange: (k: K) => void; testID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const [boxes, setBoxes] = useState<{ x: number; w: number }[]>([]);
  const x = useRef(new Animated.Value(0)).current;
  const w = useRef(new Animated.Value(0)).current;
  const [still, setStill] = useState(false);
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setStill).catch(() => {}); }, []);
  const index = options.findIndex(o => o.key === value);
  const placed = useRef(false);
  useEffect(() => {
    const b = boxes[index];
    if (!b) return;
    if (!placed.current || still) { x.setValue(b.x); w.setValue(b.w); placed.current = true; return; }
    Animated.parallel([
      Animated.timing(x, { toValue: b.x, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.timing(w, { toValue: b.w, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
    ]).start();
  }, [index, boxes, still, x, w]);
  const onLayout = (i: number) => (e: LayoutChangeEvent) => {
    const { x: bx, width } = e.nativeEvent.layout;
    setBoxes(prev => { const next = [...prev]; next[i] = { x: bx, w: width }; return next; });
  };
  return (
    <View style={styles.wrap} accessibilityRole="tablist" testID={testID}>
      {boxes.length === 2 && <Animated.View pointerEvents="none" style={[styles.thumb, { left: x, width: w }]} />}
      {options.map((o, i) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} onLayout={onLayout(i)} hitSlop={{ top: 6, bottom: 6 }}
                     onPress={() => { if (!on) { Haptics.selectionAsync().catch(() => {}); onChange(o.key); } }}
                     style={styles.seg} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={o.label} testID={`${testID}-${o.key}`}>
            {!!o.emoji && <Text style={styles.emoji}>{o.emoji}</Text>}
            {!!o.flag && <CityFlag country={o.flag} />}
            <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1} maxFontSizeMultiplier={1.3}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:    { flexDirection: 'row', alignSelf: 'flex-start', padding: 3, borderRadius: Radius.full, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  thumb:   { position: 'absolute', top: 3, bottom: 3, borderRadius: Radius.full, backgroundColor: c.selected },
  seg:     { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 34, paddingHorizontal: Space.md, borderRadius: Radius.full, maxWidth: 170 },
  emoji:   { fontSize: 14, lineHeight: 18 },
  label:   { ...Type.caption, fontSize: 14, lineHeight: 18, fontWeight: '600', color: c.muted, flexShrink: 1 },
  labelOn: { fontWeight: '800', color: c.onSelected },
});
