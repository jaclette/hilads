import { Linking, Text, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

/**
 * "Photo by @username" for a spot's cover (SPEC 9.5: the most voted approved
 * proof), or a Hilads pick's credit ("Photo: Jane Doe, CC BY-SA 4.0,
 * Wikimedia Commons"). overlay: a small label on the photo; else a muted
 * line with the full credit and, given `url`, a "Source" link to the photo's
 * page (what CC BY / BY-SA attribution asks for).
 */
export function PhotoCredit({ by, credit, url, overlay = false, style }: {
  by: string | null | undefined; credit?: string | null; url?: string | null; overlay?: boolean; style?: StyleProp<TextStyle>;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('common');
  if (!by && !credit) return null;
  return (
    <Text style={[overlay ? styles.overlay : styles.line, style]} numberOfLines={overlay ? 1 : 3}>
      {credit ? t('pick.credit', { credit }) : t('photoBy', { username: by })}
      {!overlay && !!url && (
        <Text style={styles.link} onPress={() => Linking.openURL(url).catch(() => {})} accessibilityRole="link">{` · ${t('pick.source')}`}</Text>
      )}
    </Text>
  );
}

/** The author alone from a credit ("Chivista, CC0, Wikimedia Commons" → "Chivista"; "Jane Doe / Unsplash" → "Jane Doe"). */
export function creditAuthor(credit: string): string {
  return credit.split(',')[0].split(' / ')[0].trim() || credit;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  overlay: { position: 'absolute', left: 6, bottom: 6, maxWidth: '90%', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 9,
             overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.58)', color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  line:    { fontSize: 12, lineHeight: 17, fontWeight: '600', color: c.muted },
  link:    { color: c.text, textDecorationLine: 'underline' },
});
