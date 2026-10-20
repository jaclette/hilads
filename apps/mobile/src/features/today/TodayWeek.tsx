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
import { ThemeIcon } from '@/ui/ThemeIcon';
import { themeColor, tint } from '@/ui/joy';
import type { DailyCalendar, DailyToday } from '@/types';
import { RowGroup } from '@/ui';

type Day = DailyCalendar['days'][number];
type State = 'done' | 'pending' | 'missed' | 'today' | 'tomorrow' | 'later' | 'none';

/**
 * Today's week strip (SPEC 9.3, today.html): the streak, tomorrow's theme as a
 * teaser, and Monday to Sunday with each day's status: done, missed, today,
 * tomorrow, each in its theme's color (DESIGN.md: a done day is filled with it,
 * today ringed with it). A past day opens its sheet; the streak opens the
 * calendar. Guests see the week's themes without statuses.
 */
export function TodayWeek({ today }: { today: DailyToday | null }) {
  const styles = useThemedStyles(makeStyles);
  const { colors, theme: mode } = useTheme();
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
  const tomorrowSpecial = today?.tomorrow?.special ?? byDate.get(addDays(current, 1))?.special ?? null;

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
        {!!tomorrowTheme && <Text style={styles.tomorrowText}>{t('today.tomorrow', { theme: themeName(tomorrowTheme.key, { special: tomorrowSpecial }) })}</Text>}
      </View>
      <View style={styles.row}>
        {week.map(date => {
          const d = byDate.get(date);
          const state = stateOf(date, d);
          const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString(i18n.language, { weekday: 'short', timeZone: 'UTC' });
          const label = `${weekday}: ${themeName(d?.theme?.key, { special: d?.special })}, ${t(`today.day.${state}`)}`;
          // The day's theme color: a fill (done), a ring (today, tomorrow), a tint (in review), the icon's color.
          const tc = themeColor(d?.special ? 'special' : d?.theme?.key);
          const iconColor = mode === 'dark' ? tc.textDark : tc.textLight;
          const dotColor = state === 'done' ? { backgroundColor: tc.fill }
            : state === 'pending' ? { backgroundColor: tint(tc.fill, 0.24) }
            : state === 'today' ? { borderColor: tc.fill, backgroundColor: tint(tc.fill, 0.14) }
            : state === 'tomorrow' ? { borderColor: tc.fill } : null;
          return (
            <TouchableOpacity key={date} style={styles.day} onPress={() => open(date, state)}
                              disabled={state === 'later'} accessibilityRole="button" accessibilityLabel={label}
                              accessibilityState={state === 'tomorrow' ? { expanded: peek } : undefined}>
              <Text style={[styles.weekday, state === 'today' && styles.weekdayToday]} numberOfLines={1}>{weekday}</Text>
              <View style={[styles.dot, styles[state], dotColor]}>
                {state === 'done' && <Ionicons name="checkmark" size={20} color={tc.onFill} />}
                {state === 'pending' && <Ionicons name="time-outline" size={18} color={colors.text} />}
                {state === 'missed' && <Ionicons name="close" size={18} color={colors.mutedDim} />}
                {(state === 'today' || state === 'tomorrow' || state === 'none' || state === 'later') && !!d?.theme && (
                  <ThemeIcon theme={d.theme.key} special={d.special?.icon} size={18} color={state === 'later' ? colors.mutedDim : iconColor} />
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
      {peek && !!tomorrowTheme && (
        <View style={styles.peek} accessibilityLiveRegion="polite">
          <ThemeIcon theme={tomorrowTheme.key} special={tomorrowSpecial?.icon} size={16} color={colors.text} />
          <Text style={styles.peekText}>{t('today.tomorrow', { theme: themeName(tomorrowTheme.key, { special: tomorrowSpecial }) })}</Text>
        </View>
      )}
      {/* Secondary links (SPEC 9.3): list rows in one card, no orange (it stays the Daily Challenge button's). */}
      <RowGroup style={styles.links}>
        <LinkRow icon="calendar-outline" accent={ACCENT_SKY} title={t('today.allPast')} sub={t('today.links.pastSub')}
                 onPress={() => router.push('/daily/archive' as never)} />
        {/* Propose a challenge (SPEC 8.6): guests get the sign-up sheet, then the form. */}
        <LinkRow divider icon="bulb-outline" accent={ACCENT_SUN} title={t('propose.cta')} sub={t('today.links.proposeSub')}
                 onPress={() => router.push((account ? '/daily/propose?source=week_strip'
                   : '/auth-gate?reason=create_challenge&returnTo=%2Fdaily%2Fpropose%3Fsource%3Dweek_strip') as never)} />
        {/* Locals of a live city only: tomorrow's Local Twist, until its deadline in their local time. */}
        {today?.twistProposal && (today.twistProposal.open || today.twistProposal.status) && (
          <LinkRow divider icon="leaf-outline" accent={ACCENT_TEAL} title={t('today.links.twistTitle')}
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

/** A Today link row: a circle tinted with its accent and the icon in ink, a bold title, a muted line, a chevron. */
function LinkRow({ icon, title, sub, onPress, accent, divider = false }: {
  icon: ComponentProps<typeof Ionicons>['name']; title: string; sub: string; onPress: () => void; accent: string; divider?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}. ${sub}`}
               style={({ pressed }) => [styles.linkRow, divider && styles.rowDivider, pressed && styles.rowPressed]}>
      <View style={[styles.rowIcon, { backgroundColor: tint(accent, 0.22) }]}><Ionicons name={icon} size={19} color={colors.text} /></View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.rowSub} numberOfLines={2}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

const DOT = 40;
const ACCENT_SKY = '#3D9BF0';
const ACCENT_SUN = '#FFC93C';
const ACCENT_TEAL = '#1FB5A8';

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
  done:         {},
  pending:      {},
  missed:       { backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line },
  today:        { borderWidth: 2.5 },
  tomorrow:     { borderWidth: 2, borderStyle: 'dashed' },
  later:        { borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.line },
  none:         { backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line },
});
