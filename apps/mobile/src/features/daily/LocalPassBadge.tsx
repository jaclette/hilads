import { Text, View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

/**
 * The Local Pass mark next to an author's name (proofs, chat messages in that
 * city): 🎫, with "Local Pass" spelled out when `label` is set.
 */
export function LocalPassBadge({ label = false, onDark = false }: { label?: boolean; onDark?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  return (
    <View style={[styles.pill, onDark && styles.pillDark]} accessible accessibilityLabel={t('localPass.badgeA11y')}>
      <Text style={[styles.text, onDark && styles.textDark]}>🎫{label ? ` ${t('localPass.name')}` : ''}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  pill:     { alignSelf: 'center', borderRadius: Radius.full, backgroundColor: c.accentDim, paddingHorizontal: 6, paddingVertical: 1 },
  pillDark: { backgroundColor: 'rgba(255,255,255,0.15)' },
  text:     { fontSize: FontSizes.tiny, fontWeight: '800', color: c.accentText },
  textDark: { color: '#fff' },
});
