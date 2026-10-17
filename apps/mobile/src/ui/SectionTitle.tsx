import { Text, TouchableOpacity, View, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

/** A section's title, with an optional link on the right ("See top 10", "Open the map"). `small` is the 15 px card title. */
export function SectionTitle({ title, action, small = false, style }: {
  title: string;
  action?: { label: string; onPress: () => void };
  small?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const styles = useThemedStyles(makeStyles);
  const text = <Text style={[styles.title, small && styles.small, style]} accessibilityRole="header">{title}</Text>;
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
  title: { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  small: { fontSize: 15, fontWeight: '800' },
  link:  { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryText },
});
