import type { ReactNode } from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Border, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

/** Card: white on the ground with a line border (plain), or the warmer ticket border and radius (ticket). */
export function Card({ variant = 'plain', style, children }: { variant?: 'plain' | 'ticket'; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return <View style={[styles.card, variant === 'ticket' && styles.ticket, style]}>{children}</View>;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:   { backgroundColor: c.bg2, borderWidth: Border, borderColor: c.line, borderRadius: Radius.card },
  ticket: { borderColor: c.ticketLine, borderRadius: Radius.ticket },
});
