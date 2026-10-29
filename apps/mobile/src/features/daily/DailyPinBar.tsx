import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { track } from '@/services/analytics';
import { ThemeIcon } from '@/ui/ThemeIcon';
import { DailyStatusChip } from './DailyStatusChip';
import type { DailyToday } from '@/types';

/**
 * Today's Daily Challenge pinned at the top of Chat, in the city and in World
 * (SPEC 9.6, V3 polish 5): theme icon, "Daily Challenge", the challenge on one
 * line, and "Take it" (or my proof's status). The bar opens the challenge.
 * `compact` (the feed scrolled into history): a slim pill. Once my photo is
 * in, a slim "You played · See the world" pill instead (the world's photos).
 */
export function DailyPinBar({ data, source = 'pin', compact = false }: {
  data: DailyToday | null; secondsLeft?: number | null; source?: string; compact?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account } = useApp();
  const challenge = data?.challenge;
  if (!challenge) return null;
  const myProof = data?.myProof ?? null;
  const open = () => {
    track('daily_challenge_viewed', { source, challenge_date: challenge.date, city: data?.city?.name ?? 'World' });
    router.push(`/daily/${challenge.date}` as never);
  };
  const take = () => router.push((account ? '/daily/proof' : '/auth-gate?reason=daily_proof&returnTo=%2Fdaily%2Fproof') as never);
  if (myProof?.status === 'approved') {
    return (
      <TouchableOpacity style={styles.pill} onPress={() => router.push(`/daily/countries?source=${source}` as never)} accessibilityRole="button" testID="chat-pin-played">
        <Ionicons name="checkmark-circle" size={16} color={colors.primaryText} />
        <Text style={styles.pillText} numberOfLines={1}>{t('hero.played')}</Text>
        <Ionicons name="chevron-forward" size={15} color={colors.primaryText} />
      </TouchableOpacity>
    );
  }
  if (compact) {
    return (
      <TouchableOpacity style={styles.pill} onPress={challenge.isActive && !myProof ? take : open} accessibilityRole="button"
                        accessibilityLabel={`${t('kicker')}: ${challenge.text}`}>
        {challenge.theme
          ? <ThemeIcon theme={challenge.theme.key} special={challenge.special?.icon} size={15} color={colors.primaryText} />
          : <Ionicons name="flame-outline" size={15} color={colors.primaryText} />}
        <Text style={styles.pillText} numberOfLines={1}>{challenge.headline || challenge.text}</Text>
        {challenge.isActive && !myProof && <Text style={styles.pillTake}>{t('takeIt')}</Text>}
      </TouchableOpacity>
    );
  }
  return (
    <TouchableOpacity style={styles.bar} onPress={open} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={`${t('kicker')}: ${challenge.text}`}>
      <View style={styles.icon}>
        {challenge.theme
          ? <ThemeIcon theme={challenge.theme.key} special={challenge.special?.icon} size={20} color={colors.primary} />
          : <Ionicons name="flame-outline" size={20} color={colors.primary} />}
      </View>
      <View style={styles.body}>
        <Text style={styles.kicker}>{t('kicker')}</Text>
        <Text style={styles.text} numberOfLines={1}>{challenge.text}</Text>
      </View>
      {myProof ? <DailyStatusChip status={myProof.status} />
        : challenge.isActive ? (
          <TouchableOpacity style={styles.take} onPress={take} accessibilityRole="button">
            <Text style={styles.takeText}>{t('takeIt')}</Text>
          </TouchableOpacity>
        ) : null}
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  pill:     { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', maxWidth: '92%', marginTop: 6, marginBottom: 8, minHeight: 36,
              paddingHorizontal: 14, borderRadius: 18, borderWidth: 1.5, borderColor: c.ticketLine, backgroundColor: c.bg2 },
  pillText: { flexShrink: 1, fontSize: 13, fontWeight: '700', color: c.text },
  pillTake: { fontSize: 13, fontWeight: '800', color: c.primaryText },
  // marginBottom: the list's top fade sits in this gap, never over the first card.
  bar:      { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 6, marginBottom: 8, paddingVertical: 10, paddingLeft: 14, paddingRight: 10,
              borderRadius: 18, borderWidth: 1.5, borderColor: c.ticketLine, backgroundColor: c.bg2 },
  icon:     { width: 36, height: 36, borderRadius: 12, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  body:     { flex: 1, minWidth: 0 },
  kicker:   { fontSize: 12, fontWeight: '700', color: c.primaryText },
  text:     { fontSize: FontSizes.sm, fontWeight: '600', color: c.text },
  take:     { minHeight: 44, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  takeText: { color: c.white, fontSize: FontSizes.sm, fontWeight: '700' },
});
