import type { ReactNode } from 'react';
import { View, StyleSheet, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { Border, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

/**
 * Card: white on the ground with a line border (plain), the warmer ticket border and radius (ticket),
 * or the soft primary tint without a border (tint: a notice inside a screen). Radius 18 (ticket 22).
 */
export function Card({ variant = 'plain', style, accessibilityRole, children }: {
  variant?: 'plain' | 'ticket' | 'tint';
  style?: StyleProp<ViewStyle>;
  accessibilityRole?: ViewProps['accessibilityRole'];
  children?: ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  return <View style={[styles.card, variant !== 'plain' && styles[variant], style]} accessibilityRole={accessibilityRole}>{children}</View>;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:   { backgroundColor: c.bg2, borderWidth: Border, borderColor: c.line, borderRadius: Radius.card },
  ticket: { borderColor: c.ticketLine, borderRadius: Radius.ticket },
  tint:   { backgroundColor: c.primaryTint, borderWidth: 0 },
});
