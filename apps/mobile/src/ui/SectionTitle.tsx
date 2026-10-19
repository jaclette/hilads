import { Text, TouchableOpacity, View, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

/**
 * A section's title, with an optional link on the right ("See top 10", "Open the map").
 * `small` is the 15 px card title. `onPress` makes the title itself a link, with a chevron.
 */
export function SectionTitle({ title, action, small = false, style, onPress }: {
  title: string;
  action?: { label: string; onPress: () => void };
  small?: boolean;
  style?: StyleProp<TextStyle>;
  onPress?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const label = <Text style={[styles.title, small && styles.small, style]} accessibilityRole="header">{title}</Text>;
  const text = onPress ? (
    <TouchableOpacity style={styles.titleLink} onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={title}>
      {label}
      <Ionicons name="chevron-forward" size={small ? 16 : 18} color={colors.text} />
    </TouchableOpacity>
  ) : label;
  if (!action) return text;
  return (
    <View style={styles.row}>
      {text}
      <TouchableOpacity onPress={action.onPress} hitSlop={12} accessibilityRole="button">
        <Text style={styles.link}>{action.label}</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  titleLink: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 1 },
  title: { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  small: { fontSize: 15, fontWeight: '800' },
  link:  { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryText },
});
