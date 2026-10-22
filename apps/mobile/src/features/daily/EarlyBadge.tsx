import { Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

/** "Early": a proof posted within 3 hours of its author's start time (speed bonus, V2-07). */
export function EarlyBadge({ onDark = false, small = false }: { onDark?: boolean; small?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  return (
    <View style={[styles.pill, onDark && styles.pillDark, small && styles.pillSmall]}>
      <Ionicons name="flash" size={small ? 9 : 11} color={onDark ? colors.white : colors.warning} />
      <Text style={[styles.text, onDark && styles.textDark, small && styles.textSmall]}>{t('early.badge')}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  pill:     { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: Radius.full, borderWidth: 1,
              borderColor: c.warning, paddingHorizontal: 7, paddingVertical: 1 },
  pillDark: { backgroundColor: c.photoControl, borderColor: c.photoControl },
  text:     { fontSize: FontSizes.tiny, fontWeight: '800', color: c.warning },
  textDark: { color: c.white },
  pillSmall: { paddingHorizontal: 5, paddingVertical: 0 },
  textSmall: { fontSize: 10, fontWeight: '800' },
});
