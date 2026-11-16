import type { ComponentProps } from 'react';
import { Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Elevation, Gutter, IconSize, Radius, Space, Type, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Tappable } from './Tappable';

/**
 * A floating bar over the bottom of a screen (design pass): a prompt with its action ("Play today to
 * get on the board"). Inside the gutter, never edge to edge; the CTA colors (tangerine, ink) in both
 * themes, the floating elevation. Place it absolutely at the screen's bottom; leave room in the list.
 */
export function BottomBar({ label, icon, onPress, style, testID }: {
  label: string;
  icon?: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <Tappable style={[styles.bar, style]} onPress={onPress} accessibilityRole="button" testID={testID}>
      {!!icon && <Ionicons name={icon} size={IconSize.md} color={colors.onCta} />}
      <Text style={styles.label} numberOfLines={2}>{label}</Text>
      <Ionicons name="arrow-forward" size={IconSize.md} color={colors.onCta} />
    </Tappable>
  );
}

/** The height a list leaves free under its last row for the bar. */
export const BOTTOM_BAR_SPACE = 52 + Space.lg * 2;

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  bar:   { position: 'absolute', left: Gutter, right: Gutter, bottom: Space.lg, minHeight: 52, flexDirection: 'row', alignItems: 'center',
           gap: Space.md, paddingHorizontal: Space.xl, paddingVertical: Space.md, borderRadius: Radius.control, backgroundColor: c.cta,
           ...Elevation(c, 'float') },
  label: { flex: 1, ...Type.body, fontWeight: '800', color: c.onCta },
});
