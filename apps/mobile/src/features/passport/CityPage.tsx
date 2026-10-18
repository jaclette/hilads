import { Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { THEME_KEYS, themeName } from '@/features/daily/themes';
import { THEME_ICON } from '@/features/today/format';
import type { DailyTheme, DailyThemeKey } from '@/types';

// Each stamp sits at its own slight angle, like a real passport (passport.html).
const ROTATION = [-6, 5, -3, 7, -5, 4, -7];

/**
 * One city page of the Passport (SPEC 9.7): the 7 theme stamps (round ink
 * stamps, slightly rotated) and the Local Pass seal, with a hint linking the
 * next missing stamp to today's theme.
 */
export function CityPage({ cityName, themes, earned, todayTheme, tomorrowTheme, width }: {
  cityName: string;
  themes: DailyThemeKey[];
  earned: boolean;
  todayTheme: DailyThemeKey | null;
  tomorrowTheme: DailyTheme | null;
  width?: number;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('me');
  const have = new Set(themes);
  const todayMissing = todayTheme !== null && !have.has(todayTheme);
  const hint = earned || have.size >= 7 ? t('passport.hintPass')
    : todayMissing ? t('passport.hintToday', { theme: themeName(todayTheme!) })
    : tomorrowTheme ? t('passport.hintTomorrow', { theme: themeName(tomorrowTheme.key) })
    : null;

  return (
    <View style={[styles.page, width ? { width } : null]} accessibilityLabel={t('passport.pageA11y', { city: cityName, count: have.size })}>
      <View style={styles.head}>
        <Text style={styles.city} numberOfLines={1}>{cityName}</Text>
        <Text style={styles.count}>{t('passport.stamps', { count: have.size })}</Text>
      </View>
      {hint && <Text style={styles.hint}>{hint}</Text>}
      <View style={styles.grid}>
        {THEME_KEYS.map((k, i) => {
          const stamped = have.has(k);
          const next = !stamped && k === todayTheme;
          return (
            <View key={k} style={styles.cell}>
              {stamped ? (
                <View style={[styles.stamp, { transform: [{ rotate: `${ROTATION[i]}deg` }] }]}>
                  <View style={styles.stampInner}><Ionicons name={THEME_ICON[k]} size={22} color={colors.primary} /></View>
                </View>
              ) : (
                <View style={[styles.empty, next && styles.next]}>
                  <Ionicons name={THEME_ICON[k]} size={22} color={next ? colors.primary : colors.mutedDim} />
                </View>
              )}
              <Text style={[styles.label, !stamped && !next && styles.labelOff, next && styles.labelNext]} numberOfLines={2}>{themeName(k)}</Text>
            </View>
          );
        })}
        <View style={styles.cell}>
          <View style={[styles.seal, earned && styles.sealOn]}>
            <Ionicons name={earned ? 'ribbon' : 'ribbon-outline'} size={24} color={colors.gold} />
          </View>
          <Text style={[styles.label, styles.sealLabel]} numberOfLines={2}>{t('passport.localPass')}</Text>
        </View>
      </View>
    </View>
  );
}

const SIZE = 58;

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  page:      { padding: 16, gap: 12, borderRadius: 20, borderWidth: 1.5, borderColor: c.ticketLine, backgroundColor: c.bg2 },
  head:      { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  city:      { flex: 1, fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  count:     { fontSize: FontSizes.xs, fontWeight: '600', color: c.muted },
  hint:      { fontSize: FontSizes.xs, color: c.text, lineHeight: 18 },
  grid:      { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 },
  cell:      { width: '25%', alignItems: 'center', gap: 5 },
  stamp:     { width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 2, borderColor: c.primary, backgroundColor: c.primaryTint,
               alignItems: 'center', justifyContent: 'center' },
  stampInner:{ width: SIZE - 12, height: SIZE - 12, borderRadius: (SIZE - 12) / 2, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.primary,
               alignItems: 'center', justifyContent: 'center' },
  empty:     { width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 2, borderStyle: 'dashed', borderColor: c.line,
               alignItems: 'center', justifyContent: 'center' },
  next:      { borderColor: c.primary, backgroundColor: c.bg2 },
  seal:      { width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 2, borderStyle: 'dashed', borderColor: c.gold,
               alignItems: 'center', justifyContent: 'center' },
  sealOn:    { borderStyle: 'solid', borderWidth: 3 },
  label:     { fontSize: 11, fontWeight: '700', color: c.text, textAlign: 'center', lineHeight: 14 },
  labelOff:  { fontWeight: '600', color: c.muted },
  labelNext: { color: c.primaryOnTint },
  sealLabel: { color: c.gold },
});
