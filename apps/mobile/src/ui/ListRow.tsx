import type { ReactNode } from 'react';
import { Text, TouchableOpacity, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Card } from './Card';

/**
 * A tappable row: an icon or a leading node (avatar), the title, an optional
 * count badge and value, then a chevron. Inside a RowGroup, every row but the
 * first takes `divider`.
 */
export function ListRow({ title, value, icon, leading, badge, chevron = true, divider = false, onPress, accessibilityLabel, style }: {
  title: string;
  value?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  leading?: ReactNode;
  badge?: number;
  chevron?: boolean;
  divider?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <TouchableOpacity style={[styles.row, divider && styles.divider, style]} onPress={onPress} accessibilityRole="button"
                      accessibilityLabel={accessibilityLabel ?? (value ? `${title} ${value}` : title)}>
      {icon && <Ionicons name={icon} size={20} color={colors.primaryText} />}
      {leading}
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      {!!badge && badge > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text></View>}
      {!!value && <Text style={styles.value} numberOfLines={1}>{value}</Text>}
      {chevron && <Ionicons name="chevron-forward" size={18} color={colors.muted} />}
    </TouchableOpacity>
  );
}

/** Rows grouped in one card, separated by thin lines. */
export function RowGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useThemedStyles(makeStyles);
  return <Card style={[styles.group, style]}>{children}</Card>;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingHorizontal: 14 },
  divider:   { borderTopWidth: 1, borderTopColor: c.line },
  title:     { flex: 1, fontSize: 15, fontWeight: '700', color: c.text },
  value:     { flexShrink: 1, fontSize: FontSizes.sm, fontWeight: '600', color: c.muted },
  badge:     { minWidth: 22, height: 22, borderRadius: Radius.full, paddingHorizontal: 6, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: c.white, fontSize: 12, fontWeight: '800' },
  group:     { overflow: 'hidden' },
});
