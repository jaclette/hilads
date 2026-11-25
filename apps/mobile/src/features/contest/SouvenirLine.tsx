import { Text, View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Space, Radius, Type, IconSize, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import type { ContestSeason } from './contest';

/**
 * The secondary prizes, when the season has them on (Admin › Launch Season › Souvenir prizes):
 * "Ranks 2 to 10 of the final week each win a Vietnam souvenir pack". The admin's line, else ours.
 */
export function SouvenirLine({ souvenir }: { souvenir?: ContestSeason['souvenir'] }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('me');
  if (!souvenir) return null;
  const text = souvenir.text || t('contest.souvenirLine', { to: souvenir.to });
  return (
    <View style={styles.row} accessible accessibilityLabel={text}>
      <Ionicons name="gift" size={IconSize.md} color={colors.text} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  row:  { flexDirection: 'row', alignItems: 'center', gap: Space.sm, padding: Space.sm, paddingHorizontal: Space.md, borderRadius: Radius.card, backgroundColor: c.goldTint },
  text: { ...Type.caption, fontWeight: '700', color: c.text, flex: 1 },
});
