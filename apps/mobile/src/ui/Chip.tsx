import { Text, TouchableOpacity, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Border, FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { ThemeIcon } from './ThemeIcon';
import { themeColor } from './joy';

/**
 * Chip, always full radius.
 * - tint: a label on a tinted ground (theme, rank; `tone="local"` for "Validated by a local").
 * - filter: a tappable choice (map themes), as wide as its label, `selected` fills it (a theme's chip with
 *   the theme's own color, the Map's legend); `badge` adds a small tag ("Today").
 * - outline: a tag with a line border (dish tags).
 * `theme` shows a theme's icon (ThemeIcon) instead of `icon`.
 */
export function Chip({ label, variant = 'tint', tone = 'primary', icon, theme, special, selected = false, badge, onPress, style }: {
  label: string;
  variant?: 'tint' | 'filter' | 'outline';
  tone?: 'primary' | 'local';
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  theme?: string | null;
  /** A special day's icon (with theme "special"). */
  special?: string | null;
  selected?: boolean;
  badge?: string | null;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  if (variant === 'filter') {
    // A theme's chip, selected, wears the theme's color (the pins' color on the Map).
    const tc = selected && theme ? themeColor(theme) : null;
    const on = tc ? { backgroundColor: tc.fill, borderColor: tc.line ?? tc.fill } : null;
    return (
      <TouchableOpacity style={[styles.filter, selected && styles.filterOn, on, style]} onPress={onPress} accessibilityRole="button"
                        accessibilityState={{ selected }}>
        {!!theme && <ThemeIcon theme={theme} special={special} size={16} color={tc ? tc.onFill : selected ? colors.white : colors.primaryText} />}
        <Text style={[styles.filterText, selected && styles.filterTextOn, tc && { color: tc.onFill }]}>{label}</Text>
        {!!badge && <Text style={[styles.badge, selected && styles.badgeOn]}>{badge}</Text>}
      </TouchableOpacity>
    );
  }
  if (variant === 'outline') {
    return <View style={[styles.outline, style]}><Text style={styles.outlineText}>{label}</Text></View>;
  }
  const local = tone === 'local';
  const color = local ? colors.localText : colors.primaryOnTint;
  return (
    <View style={[styles.tint, local && styles.tintLocal, style]}>
      {theme ? <ThemeIcon theme={theme} special={special} size={14} color={color} /> : icon && <Ionicons name={icon} size={14} color={color} />}
      <Text style={[styles.tintText, { color }]}>{label}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  tint:         { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 28, paddingHorizontal: 10, borderRadius: Radius.full, backgroundColor: c.primaryTint },
  tintLocal:    { backgroundColor: c.localBg },
  tintText:     { fontSize: FontSizes.xs, fontWeight: '700' },
  filter:       { height: 38, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: Radius.full,
                  borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  filterOn:     { backgroundColor: c.primary, borderColor: c.primary },
  filterText:   { fontSize: FontSizes.sm, fontWeight: '600', color: c.text },
  filterTextOn: { fontWeight: '700', color: c.white },
  // iOS draws no Text at all with a radius over half its height and overflow hidden: a fixed radius.
  badge:        { fontSize: 11, fontWeight: '700', color: c.primaryOnTint, backgroundColor: c.primaryTint, borderRadius: 9,
                  paddingHorizontal: 7, paddingVertical: 2, overflow: 'hidden' },
  badgeOn:      { color: c.primary, backgroundColor: c.white },
  outline:      { borderWidth: Border, borderColor: c.line, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  outlineText:  { fontSize: FontSizes.xs, fontWeight: '600', color: c.text },
});
