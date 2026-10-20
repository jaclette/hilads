import { Text, View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { Wordmark } from '@/ui/joy';

/**
 * Today's brand line (SPEC 9.3 / 9.9, DESIGN.md): the official "hilads"
 * wordmark (the logo's own orange, never UI text; the mark is the header's
 * logo just above) and "Play local. Compare global." in muted Medium, in the
 * header under the logo row, so it stays on screen while the content scrolls.
 * For everyone, guests and signed in. One line, the tagline cut with an
 * ellipsis on small screens.
 */
export function BrandLine() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('common');
  return (
    <View style={styles.row} accessible accessibilityRole="header" accessibilityLabel={`Hilads. ${t('firstLaunch')}`}>
      <Wordmark height={16} mark={false} />
      <Text style={styles.tagline} numberOfLines={1}>{t('firstLaunch')}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  row:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 0, marginBottom: 8 },
  tagline: { flexShrink: 1, fontSize: 13, lineHeight: 18, fontWeight: '500', color: c.muted },
});
