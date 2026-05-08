import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, ScrollView, StyleSheet, Modal,
  ActivityIndicator, TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fetchUpcomingEvents, fetchCalendarSummary } from '@/api/events';
import { track } from '@/services/analytics';
import type { HiladsEvent } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

// ── Helpers ───────────────────────────────────────────────────────────────────

const EVENT_ICONS: Record<string, string> = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
};

// Day strip reaches 90 days ahead. 6mo modal calendar matches event-create.
const STRIP_DAYS  = 90;
const MAX_MODAL   = 180;

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ymdInTz(d: Date, tz: string): string {
  // Locale en-CA renders as YYYY-MM-DD which is sortable + parseable.
  return d.toLocaleDateString('en-CA', { timeZone: tz });
}

function formatTime(ts: number, tz: string): string {
  return new Date(ts * 1000).toLocaleTimeString('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function startOfDay(d: Date): Date {
  const c = new Date(d); c.setHours(0, 0, 0, 0); return c;
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d); c.setDate(c.getDate() + n); return c;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
}

// Build an ISO YYYY-MM-DD from a (possibly local) Date — used to key rows
// without timezone drift.
function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Day strip cell ────────────────────────────────────────────────────────────

function DayCell({
  date, isSelected, hasDot, onPress,
}: {
  date: Date;
  isSelected: boolean;
  hasDot: boolean;
  onPress: () => void;
}) {
  const today    = startOfDay(new Date());
  const isToday  = isSameDay(date, today);
  const dowLabel = DOW_SHORT[date.getDay()];

  return (
    <TouchableOpacity
      style={[styles.dayCell, isSelected && styles.dayCellSelected]}
      activeOpacity={0.75}
      onPress={onPress}
    >
      <Text style={[styles.dayCellDow, isSelected && styles.dayCellDowSelected]}>
        {isToday ? 'Today' : dowLabel}
      </Text>
      <Text style={[styles.dayCellNum, isSelected && styles.dayCellNumSelected]}>
        {date.getDate()}
      </Text>
      <View style={styles.dayCellDotSlot}>
        {hasDot ? (
          <View style={[styles.dayCellDot, isSelected && styles.dayCellDotSelected]} />
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

// ── Month modal — full-month grid w/ event dots ───────────────────────────────

function MonthModal({
  visibleMonth, summary, selected, onPick, onClose,
}: {
  visibleMonth: Date;
  summary: Record<string, number>;
  selected: Date;
  onPick: (d: Date) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<Date>(() =>
    new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1),
  );

  const today    = startOfDay(new Date());
  const maxDate  = startOfDay(addDays(today, MAX_MODAL));
  const monthLbl = view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const firstDow      = new Date(view.getFullYear(), view.getMonth(), 1).getDay();
  const daysInMonth   = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(view.getFullYear(), view.getMonth(), d));
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const prevDisabled = view.getFullYear() === today.getFullYear() && view.getMonth() === today.getMonth();
  const nextDisabled = view.getFullYear() === maxDate.getFullYear() && view.getMonth() === maxDate.getMonth();

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.monthBox} onStartShouldSetResponder={() => true}>
          <View style={styles.dpHeader}>
            <TouchableOpacity
              onPress={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
              disabled={prevDisabled}
              style={[styles.dpNavBtn, prevDisabled && styles.dpNavBtnDisabled]}
            >
              <Ionicons name="chevron-back" size={20} color={prevDisabled ? Colors.muted2 : Colors.text} />
            </TouchableOpacity>
            <Text style={styles.dpTitle}>{monthLbl}</Text>
            <TouchableOpacity
              onPress={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
              disabled={nextDisabled}
              style={[styles.dpNavBtn, nextDisabled && styles.dpNavBtnDisabled]}
            >
              <Ionicons name="chevron-forward" size={20} color={nextDisabled ? Colors.muted2 : Colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.dpRow}>
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
              <Text key={d} style={styles.dpDow}>{d}</Text>
            ))}
          </View>

          {Array.from({ length: cells.length / 7 }).map((_, row) => (
            <View key={row} style={styles.dpRow}>
              {cells.slice(row * 7, row * 7 + 7).map((cell, i) => {
                if (!cell) return <View key={i} style={styles.dpCell} />;
                const disabled = cell < today || cell > maxDate;
                const isSel    = isSameDay(cell, selected);
                const dot      = (summary[localYmd(cell)] ?? 0) > 0;
                return (
                  <TouchableOpacity
                    key={i}
                    style={[
                      styles.dpCell,
                      isSel && styles.dpCellSelected,
                      disabled && styles.dpCellDisabled,
                    ]}
                    onPress={() => { if (!disabled) { onPick(cell); onClose(); } }}
                    activeOpacity={disabled ? 1 : 0.7}
                    disabled={disabled}
                  >
                    <Text style={[
                      styles.dpCellText,
                      disabled && styles.dpCellTextDisabled,
                      isSel && styles.dpCellTextSelected,
                    ]}>{cell.getDate()}</Text>
                    {dot ? (
                      <View style={[styles.dpDot, isSel && styles.dpDotSelected]} />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}

          <TouchableOpacity style={styles.pickerDone} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.pickerDoneText}>Close</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ── Event card ────────────────────────────────────────────────────────────────

function UpcomingCard({ event, tz, onPress }: { event: HiladsEvent; tz: string; onPress: () => void }) {
  const now    = Date.now() / 1000;
  const isLive = event.starts_at <= now && (event.expires_at ?? event.ends_at ?? 0) > now;
  const icon   = EVENT_ICONS[event.event_type] ?? '📌';
  const going  = event.participant_count ?? 0;
  const loc    = event.location ?? event.venue ?? null;

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={onPress}>
      <View style={styles.cardTitleRow}>
        <Text style={styles.cardIcon}>{icon}</Text>
        <Text style={styles.cardTitle} numberOfLines={2}>{event.title}</Text>
        {event.source_type === 'ticketmaster' ? (
          <Text style={styles.publicBadge}>Public</Text>
        ) : going > 0 ? (
          <Text style={styles.goingCount}>🙌 {going} going</Text>
        ) : null}
      </View>

      <View style={styles.timePillRow}>
        <View style={[styles.timePill, isLive && styles.timePillLive]}>
          <Text style={[styles.timePillText, isLive && styles.timePillLiveText]}>
            {isLive ? '🔥 Live now' : `🕐 ${formatTime(event.starts_at, tz)}`}
            {event.ends_at ? ` → ${formatTime(event.ends_at, tz)}` : ''}
          </Text>
        </View>
        {event.recurrence_label ? (
          <View style={styles.recurBadge}>
            <Text style={styles.recurBadgeText}>↻ {event.recurrence_label}</Text>
          </View>
        ) : null}
      </View>

      {loc ? <Text style={styles.cardLocation} numberOfLines={1}>📍 {loc}</Text> : null}
    </TouchableOpacity>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function UpcomingEventsScreen() {
  const router = useRouter();
  const { channelId, timezone } = useLocalSearchParams<{ channelId: string; timezone: string }>();
  const tz = decodeURIComponent(timezone ?? 'UTC');

  // Build the strip dates once — today through STRIP_DAYS ahead. We anchor
  // off local-Date midnight; the dot indicator + grouping use city-tz YMD.
  const stripDates = useMemo<Date[]>(() => {
    const out: Date[] = [];
    const anchor = startOfDay(new Date());
    for (let i = 0; i <= STRIP_DAYS; i++) out.push(addDays(anchor, i));
    return out;
  }, []);

  const [selected,    setSelected]    = useState<Date>(() => startOfDay(new Date()));
  const [events,      setEvents]      = useState<HiladsEvent[]>([]);
  const [summary,     setSummary]     = useState<Record<string, number>>({});
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [showMonth,   setShowMonth]   = useState(false);

  const stripRef = useRef<ScrollView>(null);

  // ── Fetch list of events for selected day (range = single day) ─────────────
  // We hit /events/upcoming with from=to=ymd so the backend range generator
  // ensures any series occurrences for that day are materialized.
  const loadDay = useCallback(async (date: Date, isRefresh = false) => {
    if (!channelId) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    const ymd = localYmd(date);
    try {
      const list = await fetchUpcomingEvents(channelId, { from: ymd, to: ymd });
      setEvents(list);
    } catch {
      setError('Could not load events for this day');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [channelId]);

  // ── Fetch the strip's per-day summary once on mount ────────────────────────
  const loadSummary = useCallback(async () => {
    if (!channelId) return;
    const from = localYmd(stripDates[0]);
    const to   = localYmd(stripDates[stripDates.length - 1]);
    try {
      const s = await fetchCalendarSummary(channelId, from, to);
      setSummary(s);
    } catch {
      // Soft-fail — strip still works without dots.
    }
  }, [channelId, stripDates]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadDay(selected); }, [selected, loadDay]);

  function handlePickDate(d: Date) {
    const day = startOfDay(d);
    setSelected(day);
    track('calendar_day_tapped', { date: localYmd(day) });
  }

  // Day-strip cell width is fixed below — we let RN measure layout once,
  // then auto-scroll the selected cell into view.
  const onStripLayout = useCallback(() => {
    const idx = stripDates.findIndex(d => isSameDay(d, selected));
    if (idx >= 0) {
      stripRef.current?.scrollTo({ x: Math.max(0, idx * 64 - 16), animated: false });
    }
  }, [stripDates, selected]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>What's coming</Text>
        </View>
        <TouchableOpacity
          style={styles.calendarBtn}
          onPress={() => setShowMonth(true)}
          activeOpacity={0.75}
        >
          <Ionicons name="calendar-outline" size={20} color={Colors.text} />
        </TouchableOpacity>
      </View>

      {/* Day strip */}
      <ScrollView
        ref={stripRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.stripContent}
        onLayout={onStripLayout}
        style={styles.strip}
      >
        {stripDates.map(d => (
          <DayCell
            key={localYmd(d)}
            date={d}
            isSelected={isSameDay(d, selected)}
            hasDot={(summary[localYmd(d)] ?? 0) > 0}
            onPress={() => handlePickDate(d)}
          />
        ))}
      </ScrollView>

      {/* List for the selected day */}
      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => loadDay(selected)} activeOpacity={0.8}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : events.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>📅</Text>
          <Text style={styles.emptyTitle}>Nothing scheduled</Text>
          <Text style={styles.emptySub}>No events on this day yet.</Text>
        </View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => (
            <UpcomingCard
              event={item}
              tz={tz}
              onPress={() => router.push(`/event/${item.id}`)}
            />
          )}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadDay(selected, true)}
              tintColor={Colors.accent}
            />
          }
        />
      )}

      {showMonth && (
        <MonthModal
          visibleMonth={selected}
          summary={summary}
          selected={selected}
          onPick={handlePickDate}
          onClose={() => setShowMonth(false)}
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    minHeight:         56,
  },
  backBtn: {
    width:           40,
    height:          40,
    borderRadius:    12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.10)',
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
    zIndex:          1,
  },
  calendarBtn: {
    width:           40,
    height:          40,
    borderRadius:    12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.10)',
    alignItems:      'center',
    justifyContent:  'center',
    marginLeft:      'auto',
    flexShrink:      0,
    zIndex:          1,
  },
  headerCenter: {
    position:  'absolute',
    left:      0,
    right:     0,
    alignItems: 'center',
  },
  headerTitle: { fontSize: FontSizes.xl, fontWeight: '800', color: Colors.text, letterSpacing: -0.5 },

  // ── Day strip ──────────────────────────────────────────────────────────────

  strip: {
    flexGrow:        0,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  stripContent: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    gap:               8,
  },
  dayCell: {
    width:           56,
    paddingVertical: 10,
    borderRadius:    Radius.md,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.07)',
    alignItems:      'center',
  },
  dayCellSelected: {
    backgroundColor: Colors.accent,
    borderColor:     Colors.accent,
  },
  dayCellDow: { fontSize: FontSizes.xs, fontWeight: '600', color: Colors.muted, letterSpacing: 0.3 },
  dayCellDowSelected: { color: '#fff' },
  dayCellNum: { fontSize: 20, fontWeight: '800', color: Colors.text, marginTop: 2 },
  dayCellNumSelected: { color: '#fff' },
  dayCellDotSlot: { height: 8, marginTop: 4, alignItems: 'center', justifyContent: 'center' },
  dayCellDot: {
    width: 5, height: 5, borderRadius: 3,
    backgroundColor: Colors.accent,
  },
  dayCellDotSelected: { backgroundColor: '#fff' },

  // ── List ───────────────────────────────────────────────────────────────────

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl, gap: Spacing.sm },
  errorText:  { fontSize: FontSizes.sm, color: Colors.red, textAlign: 'center' },
  retryBtn:   { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, backgroundColor: Colors.bg3, borderRadius: Radius.full },
  retryText:  { color: Colors.accent, fontWeight: '600', fontSize: FontSizes.sm },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: FontSizes.xl, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  emptySub:   { fontSize: FontSizes.md, color: Colors.muted, textAlign: 'center', lineHeight: 22 },

  list: { padding: Spacing.md, paddingBottom: 40 },

  // ── Card — same as hot.tsx EventCard ──────────────────────────────────────

  card: {
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     Colors.border,
    padding:         Spacing.md,
    gap:             10,
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardIcon:  { fontSize: 22, marginTop: 1 },
  cardTitle: { flex: 1, fontSize: FontSizes.lg, fontWeight: '700', color: Colors.text, lineHeight: 26 },
  goingCount: {
    fontSize:   FontSizes.sm,
    color:      Colors.accent,
    fontWeight: '600',
    marginTop:  3,
    flexShrink: 0,
  },
  publicBadge: { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.accent, marginTop: 3 },

  timePillRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  timePill: {
    backgroundColor:   'rgba(255,255,255,0.06)',
    borderRadius:      Radius.full,
    paddingHorizontal: 12,
    paddingVertical:   5,
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.08)',
  },
  timePillLive: {
    backgroundColor: 'rgba(255,122,60,0.12)',
    borderColor:     'rgba(255,122,60,0.2)',
  },
  timePillText:     { fontSize: FontSizes.sm, fontWeight: '600', color: Colors.accent },
  timePillLiveText: { color: '#FF7A3C' },

  recurBadge:     { backgroundColor: 'rgba(184,114,40,0.15)', borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(184,114,40,0.25)' },
  recurBadgeText: { color: Colors.accent3, fontSize: FontSizes.sm, fontWeight: '600' },

  cardLocation: { fontSize: FontSizes.sm, color: Colors.muted, lineHeight: 20 },

  // ── Month modal ────────────────────────────────────────────────────────────

  overlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent:  'center',
    alignItems:      'center',
    padding:         Spacing.lg,
  },
  monthBox: {
    width:           '100%',
    maxWidth:        360,
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    padding:         Spacing.md,
    borderWidth:     1,
    borderColor:     Colors.border,
  },
  dpHeader: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   Spacing.sm,
  },
  dpTitle:           { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
  dpNavBtn:          {
    width:           36,
    height:          36,
    borderRadius:    10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  dpNavBtnDisabled:  { opacity: 0.4 },
  dpRow:             { flexDirection: 'row' },
  dpDow:             {
    flex:        1,
    textAlign:   'center',
    fontSize:    FontSizes.xs,
    color:       Colors.muted,
    paddingVertical: 6,
    fontWeight:  '600',
  },
  dpCell: {
    flex:           1,
    aspectRatio:    1,
    alignItems:     'center',
    justifyContent: 'center',
    borderRadius:   8,
    margin:         2,
  },
  dpCellSelected:    { backgroundColor: Colors.accent },
  dpCellDisabled:    { opacity: 0.3 },
  dpCellText:        { fontSize: FontSizes.md, color: Colors.text, fontWeight: '600' },
  dpCellTextSelected:{ color: '#fff' },
  dpCellTextDisabled:{ color: Colors.muted2 },
  dpDot: {
    position:        'absolute',
    bottom:          4,
    width:           4,
    height:          4,
    borderRadius:    2,
    backgroundColor: Colors.accent,
  },
  dpDotSelected:     { backgroundColor: '#fff' },
  pickerDone: {
    marginTop:       Spacing.md,
    paddingVertical: 10,
    borderRadius:    Radius.md,
    backgroundColor: Colors.bg3,
    alignItems:      'center',
  },
  pickerDoneText:    { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
});
