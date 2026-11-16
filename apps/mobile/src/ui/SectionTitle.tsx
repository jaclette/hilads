import { Text, TouchableOpacity, View, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Space, Type, type ThemeColors } from '@/constants';
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
  row:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  titleLink: { flexDirection: 'row', alignItems: 'center', gap: Space.xxs, flexShrink: 1 },
  // Type roles: a section is `title`, a card's heading `label`; the link is a caption in primary.
  title: { flexShrink: 1, ...Type.title, color: c.text },
  small: { ...Type.label, letterSpacing: 0 },
  link:  { ...Type.caption, fontWeight: '800', color: c.primaryText },
});
