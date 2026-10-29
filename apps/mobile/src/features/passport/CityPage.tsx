import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { THEME_KEYS, themeName } from '@/features/daily/themes';
import { ThemeIcon } from '@/ui/ThemeIcon';
import { themeColor, tint } from '@/ui/joy';
import type { DailyLocalPassProgress, DailyTheme, DailyThemeKey } from '@/types';
import { CityFlag } from '@/ui';

// Each stamp sits at its own slight angle, like a real passport (passport.html).
const ROTATION = [-6, 5, -3, 7, -5, 4, -7];

/**
 * One city page of the Passport (SPEC 9.7, V3 polish 6): the 7 theme stamps,
 * each in its theme's color like real ink (a dashed inner ring, its own
 * angle, the date it was earned in tiny type; a tap opens the photo that
 * earned it), the missing ones dashed grey with their icon, then the Local
 * Pass apart: a gold row, the reward of the 7. A hint links the next missing
 * stamp to today's theme. "N of 7" counts the 7 themes only.
 */
export function CityPage({ cityName, country, themes, stamps, total = 7, earned, todayTheme, tomorrowTheme, width, onStamp }: {
  cityName: string;
  country?: string | null;
  themes: DailyThemeKey[];
  stamps?: DailyLocalPassProgress['stamps'];
  total?: number;
  earned: boolean;
  todayTheme: DailyThemeKey | null;
  tomorrowTheme: DailyTheme | null;
  width?: number;
  /** A stamp tapped: the photo that earned it. */
  onStamp?: (s: { date: string; proofId: string }) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors, theme: mode } = useTheme();
  const { t, i18n } = useTranslation('me');
  const have = new Set(themes);
  const todayMissing = todayTheme !== null && !have.has(todayTheme);
  const hint = earned || have.size >= total ? t('passport.hintPass')
    : todayMissing ? t('passport.hintToday', { theme: themeName(todayTheme!, { city: cityName }) })
    : tomorrowTheme && tomorrowTheme.key !== 'special' ? t('passport.hintTomorrow', { theme: themeName(tomorrowTheme.key, { city: cityName }) })
    : null;
  const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', timeZone: 'UTC' });

  return (
    <View style={[styles.page, width ? { width } : null]} accessibilityLabel={t('passport.pageA11y', { city: cityName, count: have.size })}>
      <View style={styles.head}>
        <View style={styles.cityRow}>
          <CityFlag country={country} />
          <Text style={styles.city} numberOfLines={1}>{cityName}</Text>
        </View>
        <Text style={styles.count}>{t('passport.stampsOf', { count: have.size, total })}</Text>
      </View>
      {hint && <Text style={styles.hint}>{hint}</Text>}
      <View style={styles.grid}>
        {THEME_KEYS.map((k, i) => {
          const stamped = have.has(k);
          const next = !stamped && k === todayTheme;
          const tc = themeColor(k);
          const ink = mode === 'dark' ? tc.textDark : tc.textLight;
          const earnedBy = stamps?.[k] ?? null;
          const body = stamped ? (
            <View style={[styles.stamp, { borderColor: tc.line ?? tc.fill, backgroundColor: tint(tc.fill, 0.22), transform: [{ rotate: `${ROTATION[i]}deg` }] }]}>
              <View style={[styles.stampInner, { borderColor: tc.line ?? tc.fill }]}><ThemeIcon theme={k} size={22} color={ink} /></View>
            </View>
          ) : (
            <View style={[styles.empty, next && { borderColor: tc.line ?? tc.fill }]}>
              <ThemeIcon theme={k} size={22} color={next ? ink : colors.mutedDim} />
            </View>
          );
          return (
            <View key={k} style={styles.cell}>
              {earnedBy && onStamp ? (
                <TouchableOpacity onPress={() => onStamp(earnedBy)} accessibilityRole="button" testID="passport-stamp"
                                  accessibilityLabel={`${themeName(k, { city: cityName })}, ${day(earnedBy.date)}`}>{body}</TouchableOpacity>
              ) : body}
              <Text style={[styles.label, !stamped && !next && styles.labelOff]} numberOfLines={2}>{themeName(k, { city: cityName })}</Text>
              {earnedBy && <Text style={styles.date}>{day(earnedBy.date)}</Text>}
            </View>
          );
        })}
      </View>
      {/* The Local Pass: the reward of the 7 stamps, never an 8th one. */}
      <View style={[styles.pass, earned && styles.passOn]}>
        <View style={[styles.seal, earned && styles.sealOn]}>
          <Ionicons name={earned ? 'ribbon' : 'ribbon-outline'} size={26} color={colors.gold} />
        </View>
        <View style={styles.passBody}>
          <Text style={styles.passTitle}>{t('passport.localPass')}</Text>
          <Text style={styles.passSub}>{earned ? t('passport.passEarned', { city: cityName }) : t('passport.passToGo', { count: Math.max(0, total - have.size) })}</Text>
        </View>
      </View>
    </View>
  );
}

const SIZE = 58;

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  page:      { padding: 16, gap: 12, borderRadius: 20, borderWidth: 1.5, borderColor: c.ticketLine, backgroundColor: c.bg2 },
  head:      { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  cityRow:   { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  city:      { flexShrink: 1, fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  count:     { fontSize: FontSizes.xs, fontWeight: '600', color: c.muted },
  hint:      { fontSize: FontSizes.xs, color: c.text, lineHeight: 18 },
  grid:      { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 },
  cell:      { width: '25%', alignItems: 'center', gap: 4 },
  stamp:     { width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  // The ink's inner ring, dashed like a real rubber stamp.
  stampInner:{ width: SIZE - 12, height: SIZE - 12, borderRadius: (SIZE - 12) / 2, borderWidth: 1.5, borderStyle: 'dashed',
               alignItems: 'center', justifyContent: 'center' },
  empty:     { width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 2, borderStyle: 'dashed', borderColor: c.line,
               alignItems: 'center', justifyContent: 'center' },
  label:     { fontSize: 11, fontWeight: '700', color: c.text, textAlign: 'center', lineHeight: 14 },
  labelOff:  { fontWeight: '600', color: c.muted },
  date:      { fontSize: 9, fontWeight: '700', color: c.muted, letterSpacing: 0.3 },
  pass:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.gold },
  passOn:    { borderStyle: 'solid', borderWidth: 2.5, backgroundColor: tint('#D9AE52', 0.14) },
  seal:      { width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderStyle: 'dashed', borderColor: c.gold, alignItems: 'center', justifyContent: 'center' },
  sealOn:    { borderStyle: 'solid', borderWidth: 3 },
  passBody:  { flex: 1, gap: 2 },
  passTitle: { fontSize: FontSizes.md, fontWeight: '800', color: c.gold },
  passSub:   { fontSize: 13, fontWeight: '600', color: c.text },
});
