import { Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { shortCityName } from '@/i18n/cityName';
import type { DailyUserStats } from '@/types';
import { CityFlag } from '@/ui';

type Pioneer = NonNullable<DailyUserStats['pioneerOf']>[number];

/**
 * Passport pioneer badges (SPEC 9.16): "Pioneer of Saigon" for each city whose
 * first approved proof ever is mine. Permanent, badge only (no points).
 */
export function PioneerBadges({ pioneers }: { pioneers: Pioneer[] }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  return (
    <View style={styles.page}>
      <Text style={styles.title} accessibilityRole="header">{t('represent.pioneerTitle')}</Text>
      <Text style={styles.sub}>{t('represent.pioneerSub')}</Text>
      <View style={styles.list}>
        {pioneers.map(p => (
          <View key={p.city.id} style={styles.badge}>
            <Ionicons name="flag" size={16} color={colors.gold} />
            <CityFlag country={p.city.country} />
            <Text style={styles.badgeText} numberOfLines={1}>{t('represent.pioneer', { city: shortCityName(p.city.name ?? '') })}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  page:      { padding: 16, gap: 8, borderRadius: 20, borderWidth: 1.5, borderColor: c.ticketLine, backgroundColor: c.bg2 },
  title:     { fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  sub:       { fontSize: FontSizes.xs, color: c.muted, lineHeight: 18 },
  list:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  badge:     { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 12, borderRadius: 999,
               borderWidth: 1.5, borderColor: c.gold, backgroundColor: c.goldTint },
  badgeText: { fontSize: FontSizes.xs, fontWeight: '800', color: c.text, flexShrink: 1 },
});
