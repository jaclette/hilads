import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';

/**
 * The bottom of Today (V3 polish 3.3): a friendly text link, "Got a challenge
 * idea? Propose it" (SPEC 8.6: guests get the sign-up sheet, then the form).
 * The full entry lives in Passport, next to My proposals.
 */
export function ProposeLink() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account } = useApp();
  const open = () => router.push((account ? '/daily/propose?source=today_link'
    : '/auth-gate?reason=create_challenge&returnTo=%2Fdaily%2Fpropose%3Fsource%3Dtoday_link') as never);
  return (
    <TouchableOpacity style={styles.link} onPress={open} accessibilityRole="button" hitSlop={8} testID="today-propose">
      <Ionicons name="bulb-outline" size={16} color={colors.muted} />
      <Text style={styles.text}>
        {t('propose.linkAsk')} <Text style={styles.cta}>{t('propose.linkCta')}</Text>
      </Text>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12 },
  text: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: c.muted, textAlign: 'center' },
  cta:  { fontWeight: '800', color: c.primaryText, textDecorationLine: 'underline' },
});
