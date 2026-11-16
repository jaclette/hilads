import { Text, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Space, Border, FontSizes, Radius, Type, IconSize, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { ThemeIcon } from './ThemeIcon';
import { themeColor } from './joy';
import { Tappable } from './Tappable';

/**
 * Chip, always full radius.
 * - tint: a label on a tinted ground (theme, rank; `tone="local"` for "Validated by a local").
 * - filter: a tappable choice (map themes), as wide as its label, `selected` fills it (a theme's chip with
 *   the theme's own color, the Map's legend; any other chip the shared peach `selected`); `badge` adds a small tag ("Today").
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
      <Tappable style={[styles.filter, selected && styles.filterOn, on, style]} onPress={onPress} accessibilityRole="button"
                accessibilityState={{ selected }}>
        {!!theme && <ThemeIcon theme={theme} special={special} size={IconSize.sm} color={tc ? tc.onFill : selected ? colors.onSelected : colors.primaryText} />}
        <Text style={[styles.filterText, selected && styles.filterTextOn, tc && { color: tc.onFill }]}>{label}</Text>
        {!!badge && <Text style={[styles.badge, selected && styles.badgeOn]}>{badge}</Text>}
      </Tappable>
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
  tint:         { flexDirection: 'row', alignItems: 'center', gap: Space.xs, minHeight: 28, paddingHorizontal: Space.md, borderRadius: Radius.full, backgroundColor: c.primaryTint },
  tintLocal:    { backgroundColor: c.localBg },
  tintText:     { ...Type.caption, fontWeight: '700' },
  filter:       { height: 38, flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingHorizontal: Space.lg, borderRadius: Radius.control,
                  borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  filterOn:     { backgroundColor: c.selected, borderColor: c.selected },
  filterText:   { ...Type.body, fontWeight: '600', color: c.text },
  filterTextOn: { fontWeight: '800', color: c.onSelected },
  // iOS draws no Text at all with a radius over half its height and overflow hidden: a fixed radius.
  badge:        { fontSize: FontSizes.tiny, fontWeight: '700', color: c.primaryOnTint, backgroundColor: c.primaryTint, borderRadius: 9,
                  paddingHorizontal: Space.sm, paddingVertical: Space.xxs, overflow: 'hidden' },
  badgeOn:      { color: c.onSelected, backgroundColor: c.bg2 },
  outline:      { borderWidth: Border, borderColor: c.line, borderRadius: Radius.full, paddingHorizontal: Space.md, paddingVertical: Space.xs },
  outlineText:  { ...Type.caption, color: c.text },
});
