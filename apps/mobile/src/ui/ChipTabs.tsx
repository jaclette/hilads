import { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Border, FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { CityFlag } from './CityName';

type Option<K extends string> = { key: K; label: string; flag?: string | null };

const FADE = 28;

/**
 * Tabs as content-sized chips in a horizontal scroll (the challenge sheet):
 * a label is never cut, whatever the locale; a soft fade at an edge tells
 * that more tabs follow on that side. The chosen chip is filled with primary.
 */
export function ChipTabs<K extends string>({ options, value, onChange }: { options: Option<K>[]; value: K; onChange: (key: K) => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const [box, setBox] = useState(0);
  const [content, setContent] = useState(0);
  const [x, setX] = useState(0);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setX(e.nativeEvent.contentOffset.x);
  const moreRight = content - box - x > 4;
  const moreLeft = x > 4;
  return (
    <View onLayout={e => setBox(e.nativeEvent.layout.width)}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityRole="tablist"
                  onContentSizeChange={w => setContent(w)} onScroll={onScroll} scrollEventThrottle={32}>
        {options.map(o => {
          const on = o.key === value;
          return (
            <TouchableOpacity key={o.key} style={[styles.chip, on && styles.chipOn]} onPress={() => onChange(o.key)} activeOpacity={0.8}
                              accessibilityRole="tab" accessibilityState={{ selected: on }} testID={`chip-${o.key}`}>
              {!!o.flag && <CityFlag country={o.flag} />}
              <Text style={[styles.label, on && styles.labelOn]}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      {moreLeft && <LinearGradient pointerEvents="none" colors={[colors.bg, `${colors.bg}00`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.fade, styles.left]} />}
      {moreRight && <LinearGradient pointerEvents="none" colors={[`${colors.bg}00`, colors.bg]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.fade, styles.right]} />}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  row:     { gap: 8, paddingVertical: 2 },
  chip:    { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 16, borderRadius: Radius.full,
             borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  chipOn:  { backgroundColor: c.primary, borderColor: c.primary },
  label:   { fontSize: FontSizes.sm, fontWeight: '600', color: c.text },
  labelOn: { fontWeight: '700', color: c.white },
  fade:    { position: 'absolute', top: 0, bottom: 0, width: FADE },
  left:    { left: 0 },
  right:   { right: 0 },
});
