import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { track } from '@/services/analytics';
import { useDailyCalendar } from '@/hooks/useDaily';
import { THEME_EMOJI, addDays, ymd } from './themes';
import type { DailyCalendar } from '@/types';

type Day = DailyCalendar['days'][number];

/**
 * The week strip of the CHALLENGES screen (SPEC 8.4): 5 past days (done or
 * not), today highlighted, tomorrow with only its theme. A past day opens its
 * sheet; "Calendar" opens the month calendar.
 */
export function DailyWeekStrip() {
  const styles = useThemedStyles(makeStyles);
  const { t, i18n } = useTranslation('daily');
  const router = useRouter();
  // Fetch a little around the phone's date; the server's `today` picks the window.
  const now = ymd(new Date());
  const cal = useDailyCalendar(addDays(now, -7), addDays(now, 2));
  const today = cal.data?.today ?? null;
  if (!cal.data || !today) return null;

  const inWeek = new Set([-5, -4, -3, -2, -1, 0, 1].map(n => addDays(today, n)));
  const days = cal.data.days.filter(d => inWeek.has(d.date));

  const openDay = (d: Day) => {
    track('daily_week_strip_used', { action: 'day', date: d.date, status: d.myStatus ?? null });
    router.push(`/daily/${d.date}` as never);
  };
  const openCalendar = () => {
    track('daily_week_strip_used', { action: 'calendar', date: today });
    router.push('/daily/calendar' as never);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.title}>{t('week.title')}</Text>
        <TouchableOpacity onPress={openCalendar} hitSlop={8} accessibilityRole="button">
          <Text style={styles.link}>📅 {t('week.calendar')} ›</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.row}>
        {days.map(d => {
          const isToday = d.date === today;
          const isTomorrow = d.date > today;
          const status = d.myStatus === 'approved' ? 'done' : d.myStatus === 'pending' ? 'pending' : d.published ? 'missed' : 'none';
          const weekday = new Date(`${d.date}T12:00:00Z`).toLocaleDateString(i18n.language, { weekday: 'short', timeZone: 'UTC' });
          const label = isTomorrow ? `${t('week.tomorrow')}: ${d.theme?.name ?? ''}`
            : `${weekday} ${d.date}: ${d.theme?.name ?? ''}, ${t(`week.${status}`)}`;
          return (
            <TouchableOpacity
              key={d.date}
              style={[styles.cell, isToday && styles.cellToday, isTomorrow && styles.cellTomorrow, status === 'none' && !isTomorrow && styles.cellNone]}
              onPress={() => openDay(d)}
              disabled={isTomorrow || !d.published}
              accessibilityRole="button"
              accessibilityLabel={label}
            >
              <Text style={[styles.weekday, isToday && styles.weekdayToday]} numberOfLines={1} adjustsFontSizeToFit>
                {isToday ? t('week.today') : isTomorrow ? t('week.tomorrow') : weekday}
              </Text>
              <Text style={styles.emoji}>{d.theme ? THEME_EMOJI[d.theme.key] : '·'}</Text>
              {isTomorrow ? (
                <Text style={styles.themeName} numberOfLines={2}>{d.theme?.name ?? ''}</Text>
              ) : (
                <Text style={[styles.mark, status === 'done' && styles.markDone, status === 'pending' && styles.markPending]}>
                  {status === 'done' ? '✓' : status === 'pending' ? '•' : status === 'missed' ? '–' : ' '}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
        {/* V2-06: the "Propose a challenge" slot goes here, at the end of the strip. */}
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:         { gap: 8 },
  head:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title:        { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  link:         { fontSize: FontSizes.xs, fontWeight: '800', color: c.accentText },
  row:          { flexDirection: 'row', gap: 6 },
  cell:         { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 8, paddingHorizontal: 2, borderRadius: Radius.md, backgroundColor: c.bg2, borderWidth: 1, borderColor: c.border, minHeight: 74 },
  cellToday:    { borderColor: c.accent, borderWidth: 2, backgroundColor: c.accentDim },
  cellTomorrow: { borderStyle: 'dashed' },
  cellNone:     { opacity: 0.45 },
  weekday:      { fontSize: 12, fontWeight: '700', color: c.muted, textTransform: 'capitalize' },
  weekdayToday: { color: c.accentText, fontWeight: '800' },
  emoji:        { fontSize: 18 },
  themeName:    { fontSize: 11, fontWeight: '700', color: c.muted, textAlign: 'center' },
  mark:         { fontSize: FontSizes.sm, fontWeight: '900', color: c.muted },
  markDone:     { color: c.green },
  markPending:  { color: c.warning },
});
