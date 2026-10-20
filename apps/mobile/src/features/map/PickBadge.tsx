import { Text, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

/** "Hilads pick" (full label: detail page, sheet, Compare): an editorial spot, never a player's photo. */
export function PickBadge({ style }: { style?: StyleProp<ViewStyle> }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  return (
    <View style={[styles.badge, style]}>
      <Ionicons name="star" size={12} color={colors.gold} />
      <Text style={styles.text} numberOfLines={1}>{t('pick.badge')}</Text>
    </View>
  );
}

/**
 * The compact pick mark on a photo (Today strips): a small dark pill in the
 * top-left corner, a gold star and "Hilads" (a brand name: the same in every
 * locale), so it never truncates. Place it inside the photo's box.
 */
export function PickPill() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  return (
    <View style={styles.pill} accessibilityLabel={t('pick.badge')}>
      <Ionicons name="star" size={10} color={colors.gold} />
      <Text style={styles.pillText}>Hilads</Text>
    </View>
  );
}

/** A pick's "Good to know": context that stays when players' photos take the cover. */
export function GoodToKnow({ note }: { note: string | null | undefined }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('common');
  if (!note) return null;
  return (
    <View style={styles.note}>
      <Text style={styles.noteTitle}>{t('pick.goodToKnow')}</Text>
      <Text style={styles.noteText}>{note}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  badge:     { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3,
               borderRadius: 999, backgroundColor: c.goldTint },
  text:      { flexShrink: 1, fontSize: 12, fontWeight: '800', color: c.text },
  pill:      { position: 'absolute', top: 6, left: 6, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3,
               borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.6)' },
  pillText:  { fontSize: 11, fontWeight: '800', color: '#FFFFFF' },
  note:      { gap: 4, padding: 12, borderRadius: 14, backgroundColor: c.goldTint },
  noteTitle: { fontSize: 13, fontWeight: '800', color: c.text },
  noteText:  { fontSize: 14, lineHeight: 20, color: c.text },
});
