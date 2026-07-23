/**
 * ComposerEndedNotice - read-only replacement for the ChatInput composer when a
 * conversation is closed (a past Hi plan / event, or a closed/validated
 * challenge). The message history above stays readable; only the input is
 * removed. Mirrors the composer container's styling (border, background,
 * elevation) so it sits above the tab bar in the same spot the composer did.
 */

import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

export function ComposerEndedNotice({ text }: { text: string }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <Ionicons name="lock-closed" size={14} color={colors.muted} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               7,
    paddingHorizontal: 14,
    paddingVertical:   16,
    borderTopWidth:    1,
    borderTopColor:    c.border,
    backgroundColor:   c.elevated,
    shadowColor:       '#000',
    shadowOffset:      { width: 0, height: -5 },
    shadowOpacity:     0.28,
    shadowRadius:      12,
    elevation:         30, // match ChatInput - render above the tab bar's shadow
  },
  text: { fontSize: FontSizes.sm, color: c.muted, fontWeight: '600' },
});
