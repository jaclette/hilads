import { Text, View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

/** "⚡ Early": a proof posted within 3 hours of its author's start time (speed bonus, V2-07). */
export function EarlyBadge({ onDark = false }: { onDark?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  return (
    <View style={[styles.pill, onDark && styles.pillDark]}>
      <Text style={[styles.text, onDark && styles.textDark]}>⚡ {t('early.badge')}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  pill:     { alignSelf: 'flex-start', borderRadius: Radius.full, backgroundColor: c.bg3, borderWidth: 1, borderColor: c.warning, paddingHorizontal: 7, paddingVertical: 1 },
  pillDark: { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.4)' },
  text:     { fontSize: FontSizes.tiny, fontWeight: '800', color: c.warning },
  textDark: { color: '#fff' },
});
