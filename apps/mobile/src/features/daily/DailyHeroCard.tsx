import { useEffect, useRef } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { localizeCityName } from '@/i18n/cityName';
import { track } from '@/services/analytics';
import { formatCountdown, useDailyToday } from '@/hooks/useDaily';
import { DailyStatusChip } from './DailyStatusChip';
import { DailyPushBanner } from './DailyPushBanner';
import { dailyTrackProps } from './track';

/**
 * MY CITY hero: today's Daily Challenge. Challenge text (English, as written),
 * the city's Local Twist when the city is live, a countdown to the next drop,
 * the proof count and the CTA - or my proof's status once I posted.
 */
export function DailyHeroCard({ cityId }: { cityId: string }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account } = useApp();
  const { data, loading, secondsLeft } = useDailyToday(cityId);
  const tracked = useRef<string | null>(null);

  const challenge = data?.challenge ?? null;
  useEffect(() => {
    if (!challenge || tracked.current === challenge.id) return;
    tracked.current = challenge.id;
    track('daily_challenge_viewed', { source: 'hero', ...dailyTrackProps(data, account?.mode) });
  }, [challenge, data, account?.mode]);

  if (loading && !data) {
    return <View style={[styles.card, styles.placeholder]}><ActivityIndicator color={colors.accent} /></View>;
  }

  if (!challenge) {
    return (
      <View style={styles.card}>
        <Text style={styles.kicker}>🔥 {t('kicker')}</Text>
        <Text style={styles.text}>{t('nothingLive')}</Text>
        {secondsLeft !== null && <Text style={styles.meta}>{t('nextIn', { time: formatCountdown(secondsLeft) })}</Text>}
      </View>
    );
  }

  const openSheet = () => router.push('/daily/today' as never);
  const city = data?.city;
  const count = data?.counts.world ?? 0;
  const cityCount = data?.counts.city ?? 0;
  const myProof = data?.myProof ?? null;

  const onCta = () => {
    if (myProof) { openSheet(); return; }
    if (!account) { router.push('/auth-gate?reason=daily_proof&returnTo=%2Fdaily%2Fproof' as never); return; }
    router.push('/daily/proof' as never);
  };

  return (
    <TouchableOpacity style={styles.card} onPress={openSheet} activeOpacity={0.9} accessibilityRole="button" accessibilityLabel={`${t('kicker')}: ${challenge.text}`}>
      <View style={styles.topRow}>
        <Text style={styles.kicker}>🔥 {t('kicker')}</Text>
        {secondsLeft !== null && <Text style={styles.countdown}>⏱ {t('timeLeft', { time: formatCountdown(secondsLeft) })}</Text>}
      </View>

      <Text style={styles.text} numberOfLines={3}>{challenge.text}</Text>

      {data?.twist && city?.isLive && (
        <View style={styles.twist}>
          <Text style={styles.twistLabel}>📍 {t('twistIn', { city: localizeCityName(city.name ?? '') })}</Text>
          <Text style={styles.twistText} numberOfLines={2}>{data.twist.text}</Text>
        </View>
      )}

      <View style={styles.bottomRow}>
        <Text style={styles.meta} numberOfLines={2}>
          {count === 0 ? t('countZero') : t('count', { count })}
          {city?.isLive && cityCount > 0 ? ` · ${t('countCity', { count: cityCount, city: localizeCityName(city.name ?? '') })}` : ''}
        </Text>
        {myProof ? (
          <DailyStatusChip status={myProof.status} />
        ) : (
          <TouchableOpacity style={styles.cta} onPress={onCta} activeOpacity={0.85} accessibilityRole="button">
            <Text style={styles.ctaText}>{t('cta')}</Text>
          </TouchableOpacity>
        )}
      </View>

      <DailyPushBanner />
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card: {
    paddingVertical:   14,
    paddingHorizontal: 16,
    borderRadius:      Radius.lg,
    backgroundColor:   c.bg2,
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.45)',
    gap:               8,
    shadowColor:       c.accent,
    shadowOpacity:     0.22,
    shadowRadius:      14,
    shadowOffset:      { width: 0, height: 4 },
    elevation:         3,
  },
  placeholder: { minHeight: 120, alignItems: 'center', justifyContent: 'center' },
  topRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  kicker:     { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', color: c.accentText },
  countdown:  { fontSize: 12, fontWeight: '700', color: c.muted },
  text:       { fontSize: FontSizes.md, fontWeight: '800', color: c.text, lineHeight: 22 },
  twist:      { backgroundColor: c.bg3, borderRadius: Radius.md, paddingVertical: 8, paddingHorizontal: 10, gap: 2 },
  twistLabel: { fontSize: 11, fontWeight: '800', color: c.accentText, textTransform: 'uppercase', letterSpacing: 0.4 },
  twistText:  { fontSize: FontSizes.sm, color: c.text },
  bottomRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  meta:       { flex: 1, fontSize: FontSizes.xs, color: c.muted, fontWeight: '600' },
  cta:        { backgroundColor: c.accent, borderRadius: Radius.full, paddingHorizontal: 16, paddingVertical: 10 },
  ctaText:    { color: c.white, fontSize: FontSizes.sm, fontWeight: '800' },
});
