import { Text, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

/** "Hilads pick": an editorial spot (never a player's answer). */
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
  text:      { fontSize: 12, fontWeight: '800', color: c.text },
  note:      { gap: 4, padding: 12, borderRadius: 14, backgroundColor: c.goldTint },
  noteTitle: { fontSize: 13, fontWeight: '800', color: c.text },
  noteText:  { fontSize: 14, lineHeight: 20, color: c.text },
});
