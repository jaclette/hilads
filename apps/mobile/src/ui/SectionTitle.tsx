import { Text, TouchableOpacity, View, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { HighlightText, plain } from './joy';

/**
 * A section's title, with an optional link on the right ("See top 10", "Open the map").
 * `small` is the 17 px card title. `onPress` makes the title itself a link, with a chevron.
 * A key word marked "*word*" in the copy sits on a `highlight` color block (DESIGN.md).
 */
export function SectionTitle({ title, action, small = false, style, onPress, highlight }: {
  title: string;
  action?: { label: string; onPress: () => void };
  small?: boolean;
  style?: StyleProp<TextStyle>;
  onPress?: () => void;
  highlight?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const label = title.includes('*')
    ? <HighlightText text={title} color={highlight} style={[styles.title, small && styles.small, style]} accessibilityLabel={plain(title)} />
    : <Text style={[styles.title, small && styles.small, style]} accessibilityRole="header">{title}</Text>;
  const text = onPress ? (
    <TouchableOpacity style={styles.titleLink} onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={plain(title)}>
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
  // DESIGN.md type scale: section 19/24, card 17/22, tight tracking.
  title: { flexShrink: 1, fontSize: 19, lineHeight: 24, fontWeight: '800', color: c.text, letterSpacing: -0.3 },
  small: { fontSize: 17, lineHeight: 22, fontWeight: '800' },
  link:  { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryText },
});
