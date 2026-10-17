import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import type { DailyToday } from '@/types';

/** A city without spots (SPEC 9.5): "Be the first to put a spot here", with today's challenge. */
export function EmptyCity({ today }: { today: DailyToday | null }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account } = useApp();
  const challenge = today?.challenge ?? null;
  const take = () => router.push((account ? '/daily/proof' : '/auth-gate?reason=daily_proof&returnTo=%2Fdaily%2Fproof') as never);
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="location-outline" size={22} color={colors.primaryText} />
        <Text style={styles.title}>{t('map.emptyTitle')}</Text>
      </View>
      {challenge && <Text style={styles.text} numberOfLines={3}>{challenge.text}</Text>}
      {challenge?.isActive && !today?.myProof && (
        <TouchableOpacity style={styles.cta} onPress={take} accessibilityRole="button">
          <Text style={styles.ctaText}>{t('cta')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:    { backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.ticketLine, borderRadius: 22, padding: 16, gap: 10 },
  head:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title:   { flex: 1, fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  text:    { fontSize: FontSizes.sm, color: c.muted },
  cta:     { minHeight: 48, borderRadius: 16, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: c.white, fontSize: FontSizes.md, fontWeight: '700' },
});
