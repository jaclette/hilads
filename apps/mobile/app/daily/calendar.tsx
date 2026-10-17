import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Border, FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useDailyCalendar } from '@/hooks/useDaily';
import { ymd } from '@/features/daily/themes';
import { THEME_ICON } from '@/features/today/format';
import { Card, IconButton, Screen, ScreenHeader } from '@/ui';

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
    <Screen>
      <ScreenHeader title={t('calendar.title')} />

      <ScrollView contentContainerStyle={styles.body}>
        {cal.data?.streak && (
          <View style={styles.stats}>
            <Stat value={cal.data.streak.current} label={t('calendar.streak')} />
            <Stat value={cal.data.streak.best} label={t('calendar.best')} />
          </View>
        )}

        <View style={styles.monthRow}>
          <IconButton icon="chevron-back" onPress={() => shift(-1)} label={t('calendar.prev')} />
          <Text style={styles.month}>{title}</Text>
          <IconButton icon="chevron-forward" onPress={() => { if (month < thisMonth) shift(1); }} label={t('calendar.next')}
                      style={month >= thisMonth && styles.dimmed} />
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
                <View style={[styles.cellIcon, (future || !d.published) && styles.dimmed]}>
                  {d.theme && <Ionicons name={THEME_ICON[d.theme.key] ?? 'ellipse-outline'} size={12} color={colors.muted} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
        {cal.loading && !cal.data && <ActivityIndicator color={colors.primary} style={styles.loader} />}

        <View style={styles.legend}>
          <View style={[styles.legendDot, styles.dotDone]} /><Text style={styles.legendText}>{t('calendar.legendDone')}</Text>
          <View style={[styles.legendDot, styles.dotPending]} /><Text style={styles.legendText}>{t('calendar.legendPending')}</Text>
        </View>
        {cal.data?.streak && <Text style={styles.monthDone}>{t('calendar.monthDone', { n: monthDone })}</Text>}
      </ScrollView>
    </Screen>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <Card style={styles.stat}>
      <View style={styles.statRow}>
        <Ionicons name="flame" size={20} color={colors.primaryText} />
        <Text style={styles.statValue}>{value}</Text>
      </View>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  body:       { padding: Spacing.md, paddingTop: Spacing.sm, gap: 14, paddingBottom: 40 },
  stats:      { flexDirection: 'row', gap: 10 },
  stat:       { flex: 1, padding: 12, alignItems: 'center', gap: 2 },
  statRow:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statValue:  { fontSize: FontSizes.xl, fontWeight: '800', color: c.text },
  statLabel:  { fontSize: FontSizes.xs, fontWeight: '600', color: c.muted },
  monthRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  month:      { fontSize: FontSizes.md, fontWeight: '800', color: c.text, textTransform: 'capitalize' },
  grid:       { flexDirection: 'row', flexWrap: 'wrap' },
  weekday:    { width: `${100 / 7}%`, textAlign: 'center', fontSize: FontSizes.xs, fontWeight: '700', color: c.muted, marginBottom: 6 },
  cell:       { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 4, gap: 2 },
  dot:        { width: 38, height: 38, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', borderWidth: Border,
                borderColor: c.line, backgroundColor: c.bg2 },
  dotDone:    { backgroundColor: c.primary, borderColor: c.primary },
  dotPending: { borderColor: c.warning, borderWidth: 2 },
  dotToday:   { borderColor: c.primary, borderWidth: 2 },
  dotOff:     { opacity: 0.4 },
  dayNum:     { fontSize: FontSizes.xs, fontWeight: '700', color: c.text },
  dayNumDone: { color: c.white },
  cellIcon:   { height: 14, alignItems: 'center', justifyContent: 'center' },
  dimmed:     { opacity: 0.4 },
  loader:     { marginVertical: 20 },
  legend:     { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  legendDot:  { width: 14, height: 14, borderRadius: Radius.full, borderWidth: Border, borderColor: c.line, marginLeft: 6 },
  legendText: { fontSize: FontSizes.xs, fontWeight: '500', color: c.muted },
  monthDone:  { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
});
