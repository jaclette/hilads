import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useDailyCalendar } from '@/hooks/useDaily';
import { THEME_EMOJI, ymd } from '@/features/daily/themes';

/**
 * Month calendar of my Daily Challenges (from the week strip): completed days,
 * days waiting for review, my current and best streak. A published day opens
 * its sheet. Months before the current one are browsable.
 */
export default function DailyCalendarScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const router = useRouter();
  const thisMonth = ymd(new Date()).slice(0, 7);
  const [month, setMonth] = useState(thisMonth);   // YYYY-MM

  const { first, last } = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    return { first: `${month}-01`, last: ymd(new Date(Date.UTC(y, m, 0, 12))) };
  }, [month]);
  const cal = useDailyCalendar(first, last);

  const shift = (n: number) => {
    const [y, m] = month.split('-').map(Number);
    setMonth(ymd(new Date(Date.UTC(y, m - 1 + n, 1, 12))).slice(0, 7));
  };

  const title = new Date(`${first}T12:00:00Z`).toLocaleDateString(i18n.language, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  // Monday-first grid: blank cells before the 1st.
  const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(2026, 10, 2 + i, 12)).toLocaleDateString(i18n.language, { weekday: 'narrow', timeZone: 'UTC' }));
  const days = cal.data?.days ?? [];
  const today = cal.data?.today ?? null;
  const monthDone = days.filter(d => d.myStatus === 'approved').length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.nav}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('back')}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>📅 {t('calendar.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {cal.data?.streak && (
          <View style={styles.stats}>
            <Stat value={cal.data.streak.current} label={t('calendar.streak')} styles={styles} />
            <Stat value={cal.data.streak.best} label={t('calendar.best')} styles={styles} />
          </View>
        )}

        <View style={styles.monthRow}>
          <TouchableOpacity onPress={() => shift(-1)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('calendar.prev')}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.month}>{title}</Text>
          <TouchableOpacity onPress={() => shift(1)} disabled={month >= thisMonth} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('calendar.next')}>
            <Ionicons name="chevron-forward" size={22} color={month >= thisMonth ? colors.mutedDim : colors.text} />
          </TouchableOpacity>
        </View>

        <View style={styles.grid}>
          {weekdays.map((w, i) => <Text key={`w${i}`} style={styles.weekday}>{w}</Text>)}
          {Array.from({ length: lead }, (_, i) => <View key={`b${i}`} style={styles.cell} />)}
          {cal.loading && !cal.data ? null : days.map(d => {
            const done = d.myStatus === 'approved';
            const pending = d.myStatus === 'pending';
            const future = today !== null && d.date > today;
            return (
              <TouchableOpacity
                key={d.date}
                style={styles.cell}
                onPress={() => router.push(`/daily/${d.date}` as never)}
                disabled={!d.published}
                accessibilityRole="button"
                accessibilityLabel={`${d.date}${d.theme ? `, ${d.theme.name}` : ''}${done ? `, ${t('calendar.legendDone')}` : pending ? `, ${t('calendar.legendPending')}` : ''}`}
              >
                <View style={[styles.dot, done && styles.dotDone, pending && styles.dotPending, d.date === today && styles.dotToday, (future || !d.published) && styles.dotOff]}>
                  <Text style={[styles.dayNum, done && styles.dayNumDone]}>{Number(d.date.slice(8))}</Text>
                </View>
                <Text style={[styles.cellEmoji, (future || !d.published) && styles.dimmed]}>{d.theme ? THEME_EMOJI[d.theme.key] : ''}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {cal.loading && !cal.data && <ActivityIndicator color={colors.accent} style={styles.loader} />}

        <View style={styles.legend}>
          <View style={[styles.legendDot, styles.dotDone]} /><Text style={styles.legendText}>{t('calendar.legendDone')}</Text>
          <View style={[styles.legendDot, styles.dotPending]} /><Text style={styles.legendText}>{t('calendar.legendPending')}</Text>
        </View>
        {cal.data?.streak && <Text style={styles.monthDone}>{t('calendar.monthDone', { n: monthDone })}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ value, label, styles }: { value: number; label: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>🔥 {value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container:  { flex: 1, backgroundColor: c.bg },
  nav:        { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: Spacing.md, paddingVertical: 10 },
  back:       { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: c.bg2, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  navTitle:   { flex: 1, fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  body:       { padding: Spacing.md, gap: 14, paddingBottom: 40 },
  stats:      { flexDirection: 'row', gap: 10 },
  stat:       { flex: 1, backgroundColor: c.bg2, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.border, padding: 12, alignItems: 'center', gap: 2 },
  statValue:  { fontSize: FontSizes.lg, fontWeight: '900', color: c.text },
  statLabel:  { fontSize: FontSizes.xs, color: c.muted, fontWeight: '600' },
  monthRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  month:      { fontSize: FontSizes.md, fontWeight: '800', color: c.text, textTransform: 'capitalize' },
  grid:       { flexDirection: 'row', flexWrap: 'wrap' },
  weekday:    { width: `${100 / 7}%`, textAlign: 'center', fontSize: FontSizes.xs, fontWeight: '700', color: c.muted, marginBottom: 6 },
  cell:       { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 4, gap: 1 },
  dot:        { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border, backgroundColor: c.bg2 },
  dotDone:    { backgroundColor: c.accent, borderColor: c.accent },
  dotPending: { borderColor: c.warning, borderWidth: 2 },
  dotToday:   { borderColor: c.accent, borderWidth: 2 },
  dotOff:     { opacity: 0.4 },
  dayNum:     { fontSize: FontSizes.xs, fontWeight: '700', color: c.text },
  dayNumDone: { color: c.white },
  cellEmoji:  { fontSize: 12 },
  dimmed:     { opacity: 0.4 },
  loader:     { marginVertical: 20 },
  legend:     { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  legendDot:  { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: c.border, marginLeft: 6 },
  legendText: { fontSize: FontSizes.xs, color: c.muted },
  monthDone:  { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
});
