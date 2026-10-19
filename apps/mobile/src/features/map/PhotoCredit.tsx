import { Text, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

/**
 * "Photo by @username" for a spot's cover (SPEC 9.5: the most voted approved
 * proof), or a Hilads pick's credit ("Photo: Jane Doe / Unsplash"). overlay: a
 * small label on the photo; else a muted line.
 */
export function PhotoCredit({ by, credit, overlay = false, style }: {
  by: string | null | undefined; credit?: string | null; overlay?: boolean; style?: StyleProp<TextStyle>;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('common');
  if (!by && !credit) return null;
  return (
    <Text style={[overlay ? styles.overlay : styles.line, style]} numberOfLines={1}>
      {credit ? t('pick.credit', { credit }) : t('photoBy', { username: by })}
    </Text>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  overlay: { position: 'absolute', left: 6, bottom: 6, maxWidth: '90%', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 9,
             overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.58)', color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  line:    { fontSize: 12, fontWeight: '600', color: c.muted },
});
