import { useState } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

/**
 * Daily Challenge content can be the founder's translation in the viewer's
 * language; the English original stays one tap away. useOriginal() holds the
 * toggle; <OriginalToggle> is the "See original" / "See translation" link,
 * rendered only when there is a translation.
 */
export function useOriginal(): [boolean, () => void] {
  const [showOriginal, setShowOriginal] = useState(false);
  return [showOriginal, () => setShowOriginal(v => !v)];
}

export function OriginalToggle({ translated, showingOriginal, onPress }: {
  translated: boolean; showingOriginal: boolean; onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  if (!translated) return null;
  return (
    <TouchableOpacity onPress={onPress} hitSlop={8} accessibilityRole="button" style={styles.wrap}>
      <Text style={styles.link}>{showingOriginal ? t('translation.seeTranslation') : t('translation.seeOriginal')}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap: { alignSelf: 'flex-start' },
  link: { fontSize: 12, fontWeight: '600', color: c.muted, textDecorationLine: 'underline' },
});
