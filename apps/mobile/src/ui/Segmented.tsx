import type { ComponentProps } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Space, Border, FontSizes, Radius, Type, IconSize, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { CityFlag } from './CityName';
import { Tappable } from './Tappable';

type Option<K extends string> = { key: K; label: string; badge?: number; flag?: string | null; icon?: ComponentProps<typeof Ionicons>['name'];
  /** A ▾ after the label while chosen: tapping it again opens a picker (Chat's city). */
  picker?: boolean };

/**
 * Two or more segments in a pill (World's Photos / Players / Cities): the chosen one
 * wears the shared selected state (peach); a segment can carry an unread badge and a city flag or an icon. onChange fires
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
          <Tappable key={o.key} style={[styles.segment, on && styles.segmentOn]} onPress={() => onChange(o.key)}
                    accessibilityRole="tab" accessibilityState={{ selected: on }}>
            {!!o.flag && <CityFlag country={o.flag} />}
            {!!o.icon && <Ionicons name={o.icon} size={IconSize.sm} color={on ? colors.onSelected : colors.muted} />}
            <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={1.3}>{o.label}</Text>
            {on && o.picker && <Ionicons name="chevron-down" size={IconSize.sm} color={colors.onSelected} />}
            {!on && !!o.badge && o.badge > 0 && <Text style={styles.badge}>{o.badge > 99 ? '99+' : o.badge}</Text>}
          </Tappable>
        );
      })}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:      { flexDirection: 'row', gap: Space.xs, padding: Space.xs, borderRadius: Radius.control, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  segment:   { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.sm, minHeight: 38, paddingHorizontal: Space.md, borderRadius: Radius.full },
  segmentOn: { backgroundColor: c.selected },
  label:     { ...Type.body, fontWeight: '600', color: c.muted },
  labelOn:   { fontWeight: '800', color: c.onSelected },
  badge:     { minWidth: 18, paddingHorizontal: Space.xs, borderRadius: 9, overflow: 'hidden', backgroundColor: c.primary,
               color: c.white, fontSize: FontSizes.tiny, fontWeight: '800', textAlign: 'center' },
});
