import type { ReactNode } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { BrandMark } from './BrandMark';

/**
 * Empty state: the icon in a soft bubble with the "Hi" mascot peeking at its
 * corner (V3 polish 7), an optional title, the text and an optional action.
 * Without an icon, a quiet line.
 */
export function EmptyState({ icon, title, body, action }: {
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  title?: string;
  body: string;
  action?: ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <View style={icon ? styles.wrap : styles.quiet}>
      {icon && (
        <View style={styles.bubble}>
          <Ionicons name={icon} size={30} color={colors.primaryText} />
          <View style={styles.mascot}><BrandMark size="sm" /></View>
        </View>
      )}
      {!!title && <Text style={styles.title}>{title}</Text>}
      <Text style={styles.body}>{body}</Text>
      {action}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:  { alignItems: 'center', gap: 10, paddingVertical: Spacing.xl },
  bubble: { width: 64, height: 64, borderRadius: 32, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  mascot: { position: 'absolute', right: -6, bottom: -4, transform: [{ rotate: '-10deg' }] },
  quiet: { padding: 14 },
  title: { fontSize: FontSizes.md, fontWeight: '800', color: c.text, textAlign: 'center' },
  body:  { fontSize: FontSizes.sm, color: c.muted, textAlign: 'center' },
});
