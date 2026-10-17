import type { ReactNode } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

/** Empty state: a stroke icon, an optional title, the text and an optional action. Without an icon, a quiet line. */
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
      {icon && <Ionicons name={icon} size={30} color={colors.primaryText} />}
      {!!title && <Text style={styles.title}>{title}</Text>}
      <Text style={styles.body}>{body}</Text>
      {action}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:  { alignItems: 'center', gap: 10, paddingVertical: Spacing.xl },
  quiet: { padding: 14 },
  title: { fontSize: FontSizes.md, fontWeight: '800', color: c.text, textAlign: 'center' },
  body:  { fontSize: FontSizes.sm, color: c.muted, textAlign: 'center' },
});
