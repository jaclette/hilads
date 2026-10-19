import type { ComponentProps } from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Border, FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { CityFlag } from './CityName';

type Option<K extends string> = { key: K; label: string; badge?: number; flag?: string | null; icon?: ComponentProps<typeof Ionicons>['name'];
  /** A ▾ after the label while chosen: tapping it again opens a picker (Chat's city). */
  picker?: boolean };

/**
 * Two or more segments in a pill (the Chat City / World switch): the chosen one
 * is filled with primary; a segment can carry an unread badge and a city flag or an icon. onChange fires
 * on every tap, the chosen segment included (Chat uses it to change city).
 */
export function Segmented<K extends string>({ options, value, onChange }: { options: Option<K>[]; value: K; onChange: (key: K) => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <View style={styles.wrap} accessibilityRole="tablist">
      {options.map(o => {
        const on = o.key === value;
        return (
          <TouchableOpacity key={o.key} style={[styles.segment, on && styles.segmentOn]} onPress={() => onChange(o.key)} activeOpacity={0.8}
                            accessibilityRole="tab" accessibilityState={{ selected: on }}>
            {!!o.flag && <CityFlag country={o.flag} />}
            {!!o.icon && <Ionicons name={o.icon} size={17} color={on ? colors.white : colors.text} />}
            <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1}>{o.label}</Text>
            {on && o.picker && <Ionicons name="chevron-down" size={16} color={colors.white} />}
            {!on && !!o.badge && o.badge > 0 && <Text style={styles.badge}>{o.badge > 99 ? '99+' : o.badge}</Text>}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:      { flexDirection: 'row', gap: 4, padding: 3, borderRadius: Radius.full, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  segment:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 38, paddingHorizontal: 10, borderRadius: Radius.full },
  segmentOn: { backgroundColor: c.primary },
  label:     { fontSize: FontSizes.sm, fontWeight: '600', color: c.text },
  labelOn:   { fontWeight: '700', color: c.white },
  badge:     { minWidth: 18, paddingHorizontal: 5, borderRadius: 9, overflow: 'hidden', backgroundColor: c.primary,
               color: c.white, fontSize: 11, fontWeight: '800', textAlign: 'center' },
});
