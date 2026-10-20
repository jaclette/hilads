import { Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

/**
 * Today's brand line (SPEC 9.3 / 9.9): "Hilads · Play local. Compare global."
 * in the header, under the logo row, so it stays on screen while the content
 * scrolls. For everyone, guests and signed in. Compact: 13 px, muted, one line
 * with an ellipsis on small screens.
 */
export function BrandLine() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('common');
  return (
    <Text style={styles.line} numberOfLines={1} accessibilityRole="header">
      <Text style={styles.brand}>Hilads</Text> · {t('firstLaunch')}
    </Text>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  line:  { fontSize: 13, lineHeight: 18, fontWeight: '500', color: c.muted, marginTop: 2, marginBottom: 6 },
  brand: { fontSize: 13, fontWeight: '800', color: c.muted },
});
