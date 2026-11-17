import type { ReactNode } from 'react';
import { View, StyleSheet, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { Border, Radius, Elevation, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

/**
 * Card: the surface with a hairline and the resting elevation (plain), the warmer ticket border and the
 * hero radius (ticket), or the soft primary tint, flat (tint: a notice inside a screen). Radius card (ticket: hero).
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
  card:   { backgroundColor: c.bg2, borderWidth: 1, borderColor: c.line, borderRadius: Radius.card, ...Elevation(c, 'rest') },
  ticket: { borderWidth: Border, borderColor: c.ticketLine, borderRadius: Radius.hero },
  tint:   { backgroundColor: c.primaryTint, borderWidth: 0, shadowOpacity: 0, elevation: 0 },
});
