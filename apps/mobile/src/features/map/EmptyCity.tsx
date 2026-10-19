import { useState } from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { track } from '@/services/analytics';
import { addDays, defaultThemeFor, isPlaceTheme, themeName } from '@/features/daily/themes';
import { shortCityName } from '@/i18n/cityName';
import { ShareSheet } from '@/features/share/ShareSheet';
import { representShare, type ShareContent } from '@/features/share/content';
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
  const cityShort = today?.city?.name ? shortCityName(today.city.name) : null;
  const [invite, setInvite] = useState<ShareContent | null>(null);
  const placeTheme = isPlaceTheme(challenge?.theme?.key);
  const tomorrowKey = today?.tomorrow?.theme?.key
    ?? (challenge ? defaultThemeFor(addDays(challenge.date, 1)) : null);
  const canTake = !!challenge?.isActive && !today?.myProof && placeTheme;
  const take = () => {
    track('map_first_spot_tapped', { signed_in: !!account, theme: challenge?.theme?.key ?? null });
    router.push((account ? '/daily/proof' : '/auth-gate?reason=first_spot&returnTo=%2Fdaily%2Fproof') as never);
  };
  // The whole card is the tap target: the proof flow on a place theme, else today's challenge.
  const open = () => {
    if (canTake) take();
    else if (challenge) router.push(`/daily/${challenge.date}` as never);
  };
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={open} disabled={!challenge} accessibilityRole="button">
    <Card variant="ticket" style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="location-outline" size={22} color={colors.primaryText} />
        {/* Represent your city (SPEC 9.16): "Saigon isn't on the world map yet. Put it there." */}
        <Text style={styles.title}>{cityShort ? t('represent.mapEmpty', { city: cityShort }) : t('map.emptyTitle')}</Text>
      </View>
      {challenge && <Text style={styles.text} numberOfLines={3}>{challenge.text}</Text>}
      {canTake && <Button label={cityShort ? t('ctaAnswer', { city: cityShort }) : t('ctaAnswerNoCity')} onPress={take} />}
      {!!challenge?.isActive && !placeTheme && !!tomorrowKey && (
        <Text style={styles.tomorrow}>{t('map.spotsTomorrow', { theme: themeName(tomorrowKey) })}</Text>
      )}
      {!!challenge?.isActive && !!today?.city && (
        <Button variant="link" icon="paper-plane-outline" label={t('represent.invite')} onPress={() => setInvite(representShare(challenge, today.city!))} />
      )}
      <ShareSheet content={invite} source="represent_map" onClose={() => setInvite(null)} />
    </Card>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:     { padding: 16, gap: 10 },
  head:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title:    { flex: 1, fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  text:     { fontSize: FontSizes.sm, color: c.muted },
  tomorrow: { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryText },
});
