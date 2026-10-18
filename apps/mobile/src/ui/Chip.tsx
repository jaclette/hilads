import { Text, TouchableOpacity, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Border, FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { ThemeIcon } from './ThemeIcon';

/**
 * Chip, always full radius.
 * - tint: a label on a tinted ground (theme, rank; `tone="local"` for "Validated by a local").
 * - filter: a tappable choice (map themes), `selected` fills it; `badge` adds a small tag ("Today").
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
    return (
      <TouchableOpacity style={[styles.filter, selected && styles.filterOn, style]} onPress={onPress} accessibilityRole="button"
                        accessibilityState={{ selected }}>
        <Text style={[styles.filterText, selected && styles.filterTextOn]}>{label}</Text>
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
  badge:        { fontSize: 11, fontWeight: '700', color: c.primaryOnTint, backgroundColor: c.primaryTint, borderRadius: Radius.full,
                  paddingHorizontal: 7, paddingVertical: 2, overflow: 'hidden' },
  badgeOn:      { color: c.primary, backgroundColor: c.white },
  outline:      { borderWidth: Border, borderColor: c.line, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4 },
  outlineText:  { fontSize: FontSizes.xs, fontWeight: '600', color: c.text },
});
