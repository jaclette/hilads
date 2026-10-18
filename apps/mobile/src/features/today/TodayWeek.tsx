import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { track } from '@/services/analytics';
import { useDailyCalendar } from '@/hooks/useDaily';
import { addDays, ymd, themeName } from '@/features/daily/themes';
import { THEME_ICON } from './format';
import type { DailyCalendar, DailyToday } from '@/types';

type Day = DailyCalendar['days'][number];
type State = 'done' | 'pending' | 'missed' | 'today' | 'tomorrow' | 'later' | 'none';

/**
 * Today's week strip (SPEC 9.3, today.html): the streak, tomorrow's theme as a
 * teaser, and Monday to Sunday with each day's status: done, missed, today,
 * tomorrow. A past day opens its sheet; the streak opens the calendar. Guests
 * see the week's themes without statuses.
 */
export function TodayWeek({ today }: { today: DailyToday | null }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const { account } = useApp();
  const router = useRouter();
  const now = ymd(new Date());
  const cal = useDailyCalendar(addDays(now, -8), addDays(now, 8));
  const current = cal.data?.today ?? today?.challenge?.date ?? null;
  if (!current) return null;

  const dow = (new Date(`${current}T12:00:00Z`).getUTCDay() + 6) % 7;   // Monday = 0
  const monday = addDays(current, -dow);
  const byDate = new Map((cal.data?.days ?? []).map(d => [d.date, d]));
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const streak = today?.streak ?? cal.data?.streak?.current ?? null;
  const tomorrowTheme = today?.tomorrow?.theme ?? byDate.get(addDays(current, 1))?.theme ?? null;

  const stateOf = (date: string, d: Day | undefined): State => {
    if (date === current) return 'today';
    if (date === addDays(current, 1)) return 'tomorrow';
    if (date > current) return 'later';
    if (d?.myStatus === 'approved') return 'done';
    if (d?.myStatus === 'pending') return 'pending';
    return d?.published && cal.data?.streak ? 'missed' : 'none';
  };

  const open = (date: string, state: State) => {
    if (state === 'tomorrow' || state === 'later') return;
    track('daily_week_strip_used', { action: 'day', date, status: state });
    router.push((state === 'today' ? '/daily/today?source=week' : `/daily/${date}`) as never);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <TouchableOpacity style={styles.streak} onPress={() => router.push('/daily/calendar' as never)} accessibilityRole="button" hitSlop={6}>
          <Ionicons name="flame-outline" size={18} color={colors.text} />
          <Text style={styles.streakText}>{streak ? t('streak', { count: streak }) : t('week.title')}</Text>
        </TouchableOpacity>
        {!!tomorrowTheme && <Text style={styles.tomorrowText}>{t('today.tomorrow', { theme: themeName(tomorrowTheme.key) })}</Text>}
      </View>
      <View style={styles.row}>
        {week.map(date => {
          const d = byDate.get(date);
          const state = stateOf(date, d);
          const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString(i18n.language, { weekday: 'short', timeZone: 'UTC' });
          const themeIcon = d?.theme ? THEME_ICON[d.theme.key] : null;
          const label = `${weekday}: ${themeName(d?.theme?.key)}, ${t(`today.day.${state}`)}`;
          return (
            <TouchableOpacity key={date} style={styles.day} onPress={() => open(date, state)}
                              disabled={state === 'tomorrow' || state === 'later'} accessibilityRole="button" accessibilityLabel={label}>
              <Text style={[styles.weekday, state === 'today' && styles.weekdayToday]} numberOfLines={1}>{weekday}</Text>
              <View style={[styles.dot, styles[state]]}>
                {state === 'done' && <Ionicons name="checkmark" size={20} color={colors.white} />}
                {state === 'pending' && <Ionicons name="time-outline" size={18} color={colors.primaryOnTint} />}
                {state === 'missed' && <Ionicons name="close" size={18} color={colors.mutedDim} />}
                {(state === 'today' || state === 'tomorrow' || state === 'none' || state === 'later') && themeIcon && (
                  <Ionicons name={themeIcon} size={18} color={state === 'today' ? colors.primaryText : colors.mutedDim} />
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
      {/* Propose a challenge (SPEC 8.6): guests get the sign-up sheet, then the form. */}
      <TouchableOpacity
        style={styles.propose}
        onPress={() => router.push((account ? '/daily/propose?source=week_strip'
          : '/auth-gate?reason=create_challenge&returnTo=%2Fdaily%2Fpropose%3Fsource%3Dweek_strip') as never)}
        accessibilityRole="button"
        hitSlop={6}
      >
        <Ionicons name="bulb-outline" size={16} color={colors.primaryText} />
        <Text style={styles.proposeText}>{t('propose.cta')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const DOT = 40;

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:         { gap: 8 },
  head:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  streak:       { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  streakText:   { fontSize: 15, fontWeight: '800', color: c.text },
  tomorrowText: { flexShrink: 1, fontSize: FontSizes.xs, fontWeight: '600', color: c.muted, textAlign: 'right' },
  propose:      { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  proposeText:  { fontSize: FontSizes.xs, fontWeight: '700', color: c.primaryText },
  row:          { flexDirection: 'row', justifyContent: 'space-between', gap: 4 },
  day:          { flex: 1, alignItems: 'center', gap: 6, minHeight: 44 },
  weekday:      { fontSize: 12, fontWeight: '600', color: c.muted },
  weekdayToday: { fontWeight: '800', color: c.text },
  dot:          { width: DOT, height: DOT, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  done:         { backgroundColor: c.primary },
  pending:      { backgroundColor: c.primaryTint },
  missed:       { backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line },
  today:        { backgroundColor: c.bg2, borderWidth: 2.5, borderColor: c.primary },
  tomorrow:     { borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.mutedDim },
  later:        { borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.line },
  none:         { backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line },
});
