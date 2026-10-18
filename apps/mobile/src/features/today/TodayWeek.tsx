import { useState, type ComponentProps } from 'react';
import { Pressable, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
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
import { RowGroup } from '@/ui';

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
  const [peek, setPeek] = useState(false);
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
    if (!account) return 'none';   // statuses only signed in; the themes show for everyone
    if (d?.myStatus === 'approved') return 'done';
    if (d?.myStatus === 'pending') return 'pending';
    return d?.published && cal.data?.streak ? 'missed' : 'none';
  };

  // A past day opens its sheet (read-only once closed); tomorrow only shows its theme.
  const open = (date: string, state: State) => {
    if (state === 'tomorrow') { setPeek(p => !p); return; }
    if (state === 'later' || (date < current && !byDate.get(date)?.published)) return;
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
                              disabled={state === 'later'} accessibilityRole="button" accessibilityLabel={label}
                              accessibilityState={state === 'tomorrow' ? { expanded: peek } : undefined}>
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
      {peek && !!tomorrowTheme && (
        <View style={styles.peek} accessibilityLiveRegion="polite">
          <Ionicons name={THEME_ICON[tomorrowTheme.key] ?? 'pricetag-outline'} size={16} color={colors.text} />
          <Text style={styles.peekText}>{t('today.tomorrow', { theme: themeName(tomorrowTheme.key) })}</Text>
        </View>
      )}
      {/* Secondary links (SPEC 9.3): list rows in one card, no orange (it stays the Daily Challenge button's). */}
      <RowGroup style={styles.links}>
        <LinkRow icon="calendar-outline" title={t('today.allPast')} sub={t('today.links.pastSub')}
                 onPress={() => router.push('/daily/archive' as never)} />
        {/* Propose a challenge (SPEC 8.6): guests get the sign-up sheet, then the form. */}
        <LinkRow divider icon="bulb-outline" title={t('propose.cta')} sub={t('today.links.proposeSub')}
                 onPress={() => router.push((account ? '/daily/propose?source=week_strip'
                   : '/auth-gate?reason=create_challenge&returnTo=%2Fdaily%2Fpropose%3Fsource%3Dweek_strip') as never)} />
        {/* Locals of a live city only: tomorrow's Local Twist, until its deadline in their local time. */}
        {today?.twistProposal && (today.twistProposal.open || today.twistProposal.status) && (
          <LinkRow divider icon="leaf-outline" title={t('today.links.twistTitle')}
                   sub={today.twistProposal.status
                     ? t('twist.heroStatus', { status: t(`twist.status.${today.twistProposal.status}`) })
                     : t('today.links.twistSub', { time: new Date(today.twistProposal.closesAt * 1000).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) })}
                   onPress={() => {
                     track('daily_proposal_started', { entry: 'twist_week', type: 'twist', city: today.city?.name ?? null });
                     router.push('/daily/twist' as never);
                   }} />
        )}
      </RowGroup>
    </View>
  );
}

/** A Today link row: a ground-colour circle with the icon in ink, a bold title, a muted line, a chevron. */
function LinkRow({ icon, title, sub, onPress, divider = false }: {
  icon: ComponentProps<typeof Ionicons>['name']; title: string; sub: string; onPress: () => void; divider?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}. ${sub}`}
               style={({ pressed }) => [styles.linkRow, divider && styles.rowDivider, pressed && styles.rowPressed]}>
      <View style={styles.rowIcon}><Ionicons name={icon} size={19} color={colors.text} /></View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.rowSub} numberOfLines={2}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

const DOT = 40;

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:         { gap: 8 },
  links:        { marginTop: 6 },
  linkRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 14, paddingVertical: 10 },
  rowDivider:   { borderTopWidth: 1, borderTopColor: c.line },
  rowPressed:   { backgroundColor: c.bg3 },
  rowIcon:      { width: 38, height: 38, borderRadius: 19, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' },
  rowBody:      { flex: 1, gap: 1 },
  rowTitle:     { fontSize: 15, fontWeight: '700', color: c.text },
  rowSub:       { fontSize: 13, lineHeight: 17, fontWeight: '500', color: c.muted },
  peek:         { flexDirection: 'row', alignItems: 'center', gap: 6 },
  peekText:     { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  head:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  streak:       { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  streakText:   { fontSize: 15, fontWeight: '800', color: c.text },
  tomorrowText: { flexShrink: 1, fontSize: FontSizes.xs, fontWeight: '600', color: c.muted, textAlign: 'right' },
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
