import { Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import type { DailyToday } from '@/types';

/**
 * Today's brand line (SPEC 9.3 / 9.9): "Hilads" in the wordmark weight, then
 * the tagline in muted text, one line that wraps on small screens. At the top
 * of the scrolling content, so it scrolls away. For guests, and for signed-in
 * users until their first proof; then hidden so the card sits higher.
 */
export function BrandLine({ today, guest }: { today: DailyToday | null; guest: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('common');
  // Signed in: wait for Today to know, so it never flashes for users who posted.
  if (!guest && (!today || today.hasProof)) return null;
  return (
    <Text style={styles.line} accessibilityRole="header">
      <Text style={styles.brand}>Hilads</Text>{'  '}{t('firstLaunch')}
    </Text>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  line:  { fontSize: FontSizes.md, lineHeight: 22, fontWeight: '600', color: c.muted },
  brand: { fontSize: FontSizes.lg, fontWeight: '800', color: c.text, letterSpacing: -0.5 },
});
