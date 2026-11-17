import type { ReactNode } from 'react';
import { Text, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Space, FontSizes, Radius, Type, IconSize, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Card } from './Card';
import { Tappable } from './Tappable';
import { tint } from './joy';

/**
 * A tappable row: an icon or a leading node (avatar), the title, an optional
 * count badge and value, then a chevron. Inside a RowGroup, every row but the
 * first takes `divider`. `tone` (a theme pair: { fill, ink }) puts the icon in a
 * soft disc of that color (design pass: the Passport's menu reads like the game's).
 */
export function ListRow({ title, value, icon, tone, leading, badge, chevron = true, divider = false, onPress, accessibilityLabel, style }: {
  title: string;
  value?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  tone?: { fill: string; ink: string };
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
    <Tappable style={[styles.row, divider && styles.divider, style]} onPress={onPress} accessibilityRole="button"
              accessibilityLabel={accessibilityLabel ?? (value ? `${title} ${value}` : title)}>
      {icon && (tone
        ? <View style={[styles.disc, { backgroundColor: tint(tone.fill, 0.22) }]}><Ionicons name={icon} size={IconSize.md} color={tone.ink} /></View>
        : <Ionicons name={icon} size={IconSize.md} color={colors.primaryText} />)}
      {leading}
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      {!!badge && badge > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text></View>}
      {!!value && <Text style={styles.value} numberOfLines={1}>{value}</Text>}
      {chevron && <Ionicons name="chevron-forward" size={IconSize.md} color={colors.muted} />}
    </Tappable>
  );
}

/** Rows grouped in one card, separated by thin lines. */
export function RowGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useThemedStyles(makeStyles);
  return <Card style={[styles.group, style]}>{children}</Card>;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 54, paddingHorizontal: Space.lg },
  divider:   { borderTopWidth: 1, borderTopColor: c.line },
  disc:      { width: 36, height: 36, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  title:     { flex: 1, ...Type.body, fontWeight: '700', color: c.text },
  value:     { flexShrink: 1, ...Type.caption, color: c.muted },
  badge:     { minWidth: 22, height: 22, borderRadius: Radius.full, paddingHorizontal: Space.sm, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: c.white, fontSize: FontSizes.tiny, fontWeight: '800' },
  group:     { overflow: 'hidden' },
});
