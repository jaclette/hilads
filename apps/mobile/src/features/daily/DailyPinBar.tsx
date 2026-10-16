import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { track } from '@/services/analytics';
import { formatCountdown, isFinalHours } from '@/hooks/useDaily';
import type { DailyToday } from '@/types';

/**
 * Today's Daily Challenge pinned at the top of the World channel, above the
 * message list. (In a city channel the Daily hero card plays this role.)
 */
export function DailyPinBar({ data, secondsLeft }: { data: DailyToday | null; secondsLeft: number | null }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const router = useRouter();
  const challenge = data?.challenge;
  if (!challenge) return null;
  const open = () => {
    track('daily_challenge_viewed', { source: 'pin', challenge_date: challenge.date, city: 'World' });
    router.push(`/daily/${challenge.date}` as never);
  };
  return (
    <TouchableOpacity style={styles.bar} onPress={open} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={`${t('kicker')}: ${challenge.text}`}>
      <Text style={styles.pin}>📌</Text>
      <Text style={styles.text} numberOfLines={1}>
        <Text style={styles.kicker}>{t('kicker')} · </Text>{challenge.text}
      </Text>
      {secondsLeft !== null && <Text style={[styles.time, isFinalHours(secondsLeft) && styles.timeWarn]}>{formatCountdown(secondsLeft)}</Text>}
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  bar:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginTop: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: Radius.md, backgroundColor: c.bg2, borderWidth: 1, borderColor: 'rgba(255,122,60,0.45)' },
  pin:    { fontSize: FontSizes.xs },
  text:   { flex: 1, fontSize: FontSizes.xs, color: c.text, fontWeight: '600' },
  kicker: { color: c.accentText, fontWeight: '800' },
  time:   { fontSize: 11, color: c.muted, fontWeight: '700' },
  timeWarn: { color: c.warning },
});
