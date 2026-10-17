import { Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

/**
 * The Local Pass mark next to an author's name (proofs, chat messages in that
 * city): a gold ticket, with "Local Pass" spelled out when `label` is set.
 */
export function LocalPassBadge({ label = false, onDark = false }: { label?: boolean; onDark?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  return (
    <View style={[styles.pill, onDark && styles.pillDark]} accessible accessibilityLabel={t('localPass.badgeA11y')}>
      <Ionicons name="ticket" size={11} color={onDark ? colors.white : colors.gold} />
      {label && <Text style={[styles.text, onDark && styles.textDark]}>{t('localPass.name')}</Text>}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  pill:     { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: Radius.full, borderWidth: 1,
              borderColor: c.gold, paddingHorizontal: 6, paddingVertical: 1 },
  pillDark: { backgroundColor: c.photoControl, borderColor: c.photoControl },
  text:     { fontSize: FontSizes.tiny, fontWeight: '800', color: c.gold },
  textDark: { color: c.white },
});
