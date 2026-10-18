import { Text, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { track } from '@/services/analytics';
import { addDays, defaultThemeFor, themeName } from '@/features/daily/themes';
import type { DailyToday } from '@/types';
import { Button, Card } from '@/ui';

/**
 * A city without spots (SPEC 9.5): "Be the first to put a spot here", with
 * today's challenge. On a place theme the button opens the proof flow, which
 * starts at the place step (a guest signs up first, then lands in the flow).
 * On a Language day there is no place to pin: a line names tomorrow's theme.
 */
export function EmptyCity({ today }: { today: DailyToday | null }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account } = useApp();
  const challenge = today?.challenge ?? null;
  const placeTheme = !!challenge?.theme && challenge.theme.key !== 'language';
  const tomorrowKey = today?.tomorrow?.theme?.key
    ?? (challenge ? defaultThemeFor(addDays(challenge.date, 1)) : null);
  const take = () => {
    track('map_first_spot_tapped', { signed_in: !!account, theme: challenge?.theme?.key ?? null });
    router.push((account ? '/daily/proof' : '/auth-gate?reason=first_spot&returnTo=%2Fdaily%2Fproof') as never);
  };
  return (
    <Card variant="ticket" style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="location-outline" size={22} color={colors.primaryText} />
        <Text style={styles.title}>{t('map.emptyTitle')}</Text>
      </View>
      {challenge && <Text style={styles.text} numberOfLines={3}>{challenge.text}</Text>}
      {challenge?.isActive && !today?.myProof && (placeTheme
        ? <Button label={t('cta')} onPress={take} />
        : tomorrowKey && <Text style={styles.tomorrow}>{t('map.spotsTomorrow', { theme: themeName(tomorrowKey) })}</Text>)}
    </Card>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:     { padding: 16, gap: 10 },
  head:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title:    { flex: 1, fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  text:     { fontSize: FontSizes.sm, color: c.muted },
  tomorrow: { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryText },
});
