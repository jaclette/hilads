import type { ComponentProps } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import type { DailySpecialStamp } from '@/types';

type IconName = ComponentProps<typeof Ionicons>['name'];
const ROTATION = [5, -4, 6, -6, 3, -5, 7];

/**
 * Passport "Special stamps" (SPEC 9.15): one limited-edition stamp per special
 * day with an approved proof (Halloween...), apart from the city pages and
 * never counted for the Local Pass. Gold ink, the day's icon, its name and date.
 */
export function SpecialStamps({ stamps }: { stamps: DailySpecialStamp[] }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('me');
  return (
    <View style={styles.page}>
      <Text style={styles.title} accessibilityRole="header">{t('passport.specialTitle')}</Text>
      <Text style={styles.sub}>{t('passport.specialSub')}</Text>
      <View style={styles.grid}>
        {stamps.map((s, i) => {
          const date = new Date(`${s.date}T12:00:00Z`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
          return (
            <View key={s.id} style={styles.cell} accessibilityLabel={`${s.name}, ${date}`}>
              <View style={[styles.stamp, { transform: [{ rotate: `${ROTATION[i % ROTATION.length]}deg` }] }]}>
                <View style={styles.inner}><Ionicons name={(s.icon || 'sparkles-outline') as IconName} size={22} color={colors.gold} /></View>
              </View>
              <Text style={styles.label} numberOfLines={2}>{s.name}</Text>
              <Text style={styles.date} numberOfLines={1}>{date}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const SIZE = 58;

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  page:  { padding: 16, gap: 8, borderRadius: 20, borderWidth: 1.5, borderColor: c.ticketLine, backgroundColor: c.bg2 },
  title: { fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  sub:   { fontSize: FontSizes.xs, color: c.muted, lineHeight: 18 },
  grid:  { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10, marginTop: 4 },
  cell:  { width: '25%', alignItems: 'center', gap: 4 },
  stamp: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 2, borderColor: c.gold, backgroundColor: c.goldTint,
           alignItems: 'center', justifyContent: 'center' },
  inner: { width: SIZE - 12, height: SIZE - 12, borderRadius: (SIZE - 12) / 2, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.gold,
           alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11, fontWeight: '700', color: c.text, textAlign: 'center', lineHeight: 14 },
  date:  { fontSize: 10, fontWeight: '600', color: c.muted, textAlign: 'center' },
});
