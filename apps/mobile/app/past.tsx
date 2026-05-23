import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, Modal,
  ActivityIndicator, TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fetchPastArchive } from '@/api/topics';
import { track } from '@/services/analytics';
import type { FeedItem } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import { EventCard } from '@/components/EventCard';
import { TopicCard } from '@/components/TopicCard';

// ── Date helpers ────────────────────────────────────────────────────────────

const MAX_SPAN_DAYS = 14;          // hard cap on a custom window (UI mirror of backend)
const MONTHS_BACK   = 12;          // how far back the custom picker can navigate

function pad(n: number): string { return String(n).padStart(2, '0'); }
function ymd(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseYmd(s: string): Date { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(d: Date, n: number): Date { const c = new Date(d); c.setDate(c.getDate() + n); return c; }
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
// "Today" as the city sees it — avoids off-by-one when the device tz differs.
function cityTodayYmd(tz: string): string { return new Date().toLocaleDateString('en-CA', { timeZone: tz }); }

function prettyRange(from: string, to: string): string {
  const f = parseYmd(from), t = parseYmd(to);
  const opt: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${f.toLocaleDateString(undefined, opt)} – ${t.toLocaleDateString(undefined, opt)}`;
}

type RangeKey  = 'recent' | '7' | '14' | 'custom';
type Range     = { key: RangeKey; from?: string; to?: string };
type FilterType = 'both' | 'hangouts' | 'pulses';

const PAGE = 12;

// ── Custom range picker — tap start then end, clamped to 14 days ─────────────

function RangeMonthModal({
  tz, initial, onApply, onClose,
}: {
  tz: string;
  initial: { from?: string; to?: string };
  onApply: (from: string, to: string) => void;
  onClose: () => void;
}) {
  const today = parseYmd(cityTodayYmd(tz));
  const [view, setView]   = useState<Date>(new Date(today.getFullYear(), today.getMonth(), 1));
  const [start, setStart] = useState<Date | null>(initial.from ? parseYmd(initial.from) : null);
  const [end,   setEnd]   = useState<Date | null>(initial.to ? parseYmd(initial.to) : null);

  const minDate  = addDays(today, -(MONTHS_BACK * 31));
  const monthLbl = view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const firstDow    = new Date(view.getFullYear(), view.getMonth(), 1).getDay();
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(view.getFullYear(), view.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);

  const prevDisabled = view.getFullYear() === minDate.getFullYear() && view.getMonth() === minDate.getMonth();
  const nextDisabled = view.getFullYear() === today.getFullYear() && view.getMonth() === today.getMonth();

  function pick(d: Date) {
    // First tap (or restart) sets the start; second tap sets the end.
    if (!start || (start && end)) { setStart(d); setEnd(null); return; }
    if (d < start) { setStart(d); setEnd(null); return; }            // tapped earlier → new start
    const span = Math.round((d.getTime() - start.getTime()) / 86400000);
    if (span > MAX_SPAN_DAYS - 1) { setStart(d); setEnd(null); return; } // beyond cap → restart
    setEnd(d);
  }

  function inRange(d: Date): boolean {
    if (!start) return false;
    const hi = end ?? start;
    return d >= start && d <= hi;
  }

  const canApply = !!start;

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

          <Text style={styles.dpHint}>
            {start && end
              ? prettyRange(ymd(start), ymd(end))
              : start
                ? 'Now pick the end day'
                : `Pick a start day (up to ${MAX_SPAN_DAYS} days)`}
          </Text>

          <View style={styles.dpRow}>
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
              <Text key={d} style={styles.dpDow}>{d}</Text>
            ))}
          </View>

          {Array.from({ length: cells.length / 7 }).map((_, row) => (
            <View key={row} style={styles.dpRow}>
              {cells.slice(row * 7, row * 7 + 7).map((cell, i) => {
                if (!cell) return <View key={i} style={styles.dpCell} />;
                const disabled = cell > today || cell < minDate;
                const sel      = inRange(cell);
                const edge     = (start && isSameDay(cell, start)) || (end && isSameDay(cell, end));
                return (
                  <TouchableOpacity
                    key={i}
                    style={[styles.dpCell, sel && styles.dpCellSel, edge && styles.dpCellEdge, disabled && styles.dpCellDisabled]}
                    onPress={() => { if (!disabled) pick(cell); }}
                    activeOpacity={disabled ? 1 : 0.7}
                    disabled={disabled}
                  >
                    <Text style={[styles.dpCellText, disabled && styles.dpCellTextDisabled, (sel || edge) && styles.dpCellTextSel]}>
                      {cell.getDate()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}

          <TouchableOpacity
            style={[styles.applyBtn, !canApply && styles.applyBtnDisabled]}
            disabled={!canApply}
            onPress={() => { if (start) onApply(ymd(start), ymd(end ?? start)); }}
            activeOpacity={0.85}
          >
            <Text style={styles.applyBtnText}>Apply</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function PastArchiveScreen() {
  const router = useRouter();
  const { channelId, timezone, city } = useLocalSearchParams<{ channelId: string; timezone: string; city: string }>();
  const tz       = decodeURIComponent(timezone ?? 'UTC');
  const cityName = decodeURIComponent(city ?? '');

  const [type,       setType]       = useState<FilterType>('both');
  const [range,      setRange]      = useState<Range>({ key: 'recent' });
  const [items,      setItems]      = useState<FeedItem[]>([]);
  const [cursor,     setCursor]     = useState<number | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  // Guard against out-of-order responses when filters change mid-flight.
  const reqIdRef = useRef(0);

  const load = useCallback(async (isRefresh = false) => {
    if (!channelId) return;
    const reqId = ++reqIdRef.current;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const { items: list, nextCursor } = await fetchPastArchive(channelId, {
        type,
        limit: PAGE,
        from:  range.from,
        to:    range.to,
      });
      if (reqId !== reqIdRef.current) return;  // a newer request superseded this one
      setItems(list);
      setCursor(nextCursor);
    } catch {
      if (reqId === reqIdRef.current) setError('Could not load the archive');
    } finally {
      if (reqId === reqIdRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [channelId, type, range.from, range.to]);

  const loadMore = useCallback(async () => {
    if (!channelId || loadingMore || loading || cursor == null) return;
    setLoadingMore(true);
    const reqId = reqIdRef.current;
    try {
      const { items: more, nextCursor } = await fetchPastArchive(channelId, {
        type,
        limit:  PAGE,
        before: cursor,
        from:   range.from,
        to:     range.to,
      });
      if (reqId !== reqIdRef.current) return;
      setItems(prev => [...prev, ...more]);
      setCursor(nextCursor);
    } catch {
      /* keep what we have; user can pull-to-refresh */
    } finally {
      if (reqId === reqIdRef.current) setLoadingMore(false);
    }
  }, [channelId, type, range.from, range.to, cursor, loadingMore, loading]);

  useEffect(() => { load(); }, [load]);

  function applyPreset(key: '7' | '14') {
    const to   = cityTodayYmd(tz);
    const days = key === '7' ? 7 : 14;
    const from = ymd(addDays(parseYmd(to), -(days - 1)));
    setRange({ key, from, to });
    track('past_archive_range', { range: `last${days}` });
  }
  function applyCustom(from: string, to: string) {
    setRange({ key: 'custom', from, to });
    setShowPicker(false);
    track('past_archive_range', { range: 'custom' });
  }

  const chips: { key: RangeKey; label: string }[] = [
    { key: 'recent', label: 'Recent' },
    { key: '7',      label: 'Last 7 days' },
    { key: '14',     label: 'Last 14 days' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>What happened</Text>
          {!!cityName && <Text style={styles.headerSub}>{cityName}</Text>}
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {/* Type filter */}
      <View style={styles.filterBar}>
        {(['both', 'hangouts', 'pulses'] as const).map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterPill, type === f && styles.filterPillActive]}
            onPress={() => setType(f)}
            activeOpacity={0.75}
          >
            <Text style={[styles.filterPillText, type === f && styles.filterPillTextActive]}>
              {f === 'both' ? 'All' : f === 'hangouts' ? '🔥 Events' : '🗣️ Hangouts'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Date range chips */}
      <View style={styles.rangeBar}>
        {chips.map(c => (
          <TouchableOpacity
            key={c.key}
            style={[styles.rangeChip, range.key === c.key && styles.rangeChipActive]}
            onPress={() => setRange({ key: c.key })}
            activeOpacity={0.75}
          >
            <Text style={[styles.rangeChipText, range.key === c.key && styles.rangeChipTextActive]}>{c.label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={[styles.rangeChip, range.key === 'custom' && styles.rangeChipActive]}
          onPress={() => setShowPicker(true)}
          activeOpacity={0.75}
        >
          <Ionicons
            name="calendar-outline"
            size={13}
            color={range.key === 'custom' ? '#fff' : Colors.muted}
            style={{ marginRight: 4 }}
          />
          <Text style={[styles.rangeChipText, range.key === 'custom' && styles.rangeChipTextActive]}>
            {range.key === 'custom' && range.from && range.to ? prettyRange(range.from, range.to) : 'Custom'}
          </Text>
        </TouchableOpacity>
      </View>
      {/* Quick reset to presets when 7/14 is active (chip tap re-selects recent). */}

      {/* Body */}
      {loading && !refreshing ? (
        <View style={styles.center}><ActivityIndicator color={Colors.accent} size="large" /></View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load()} activeOpacity={0.8}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🕰️</Text>
          <Text style={styles.emptyTitle}>Nothing here yet</Text>
          <Text style={styles.emptySub}>
            {range.key === 'recent'
              ? 'Past events and hangouts will show up here once the city has some history.'
              : 'No events or hangouts in this window. Try a wider range.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => `${item.kind}-${item.id}`}
          renderItem={({ item }) => {
            if (item.kind === 'topic') {
              return (
                <TopicCard
                  topic={item as FeedItem & { kind: 'topic' }}
                  pastMode
                  onPress={() => { track('topic_opened', { topicId: item.id, from: 'archive' }); router.push(`/topic/${item.id}`); }}
                />
              );
            }
            return (
              <EventCard
                event={item}
                tz={tz}
                onPress={() => { track('event_opened', { eventId: item.id, from: 'archive' }); router.push(`/event/${item.id}`); }}
              />
            );
          }}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={Colors.accent} style={{ marginVertical: 20 }} /> : null}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.accent} />
          }
        />
      )}

      {showPicker && (
        <RangeMonthModal
          tz={tz}
          initial={{ from: range.from, to: range.to }}
          onApply={applyCustom}
          onClose={() => setShowPicker(false)}
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border, minHeight: 56,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, zIndex: 1,
  },
  headerSpacer: { width: 40, height: 40, marginLeft: 'auto' },
  headerCenter: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  headerTitle:  { fontSize: FontSizes.xl, fontWeight: '800', color: Colors.text, letterSpacing: -0.5 },
  headerSub:    { fontSize: FontSizes.xs, color: Colors.muted, marginTop: 1 },

  filterBar: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: Spacing.md, paddingTop: Spacing.sm,
  },
  filterPill: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  filterPillActive:     { backgroundColor: Colors.accent, borderColor: Colors.accent },
  filterPillText:       { fontSize: FontSizes.sm, fontWeight: '600', color: Colors.muted },
  filterPillTextActive: { color: '#fff' },

  rangeBar: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  rangeChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
  },
  rangeChipActive:     { backgroundColor: 'rgba(255,122,60,0.16)', borderColor: 'rgba(255,122,60,0.4)' },
  rangeChipText:       { fontSize: FontSizes.xs, fontWeight: '600', color: Colors.muted },
  rangeChipTextActive: { color: '#fff' },

  center:     { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl, gap: Spacing.sm },
  errorText:  { fontSize: FontSizes.sm, color: Colors.red, textAlign: 'center' },
  retryBtn:   { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, backgroundColor: Colors.bg3, borderRadius: Radius.full },
  retryText:  { color: Colors.accent, fontWeight: '600', fontSize: FontSizes.sm },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: FontSizes.xl, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  emptySub:   { fontSize: FontSizes.md, color: Colors.muted, textAlign: 'center', lineHeight: 22 },

  list: { padding: Spacing.md, paddingBottom: 40 },

  // ── Range picker modal ───────────────────────────────────────────────────
  overlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: Spacing.lg },
  monthBox: {
    width: '100%', maxWidth: 360, backgroundColor: Colors.bg2, borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  dpHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  dpTitle:  { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
  dpHint:   { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center', marginBottom: Spacing.sm },
  dpNavBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  dpNavBtnDisabled: { opacity: 0.4 },
  dpRow:    { flexDirection: 'row' },
  dpDow:    { flex: 1, textAlign: 'center', fontSize: FontSizes.xs, color: Colors.muted, paddingVertical: 6, fontWeight: '600' },
  dpCell:   { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 8, margin: 2 },
  dpCellSel:     { backgroundColor: 'rgba(255,122,60,0.18)' },
  dpCellEdge:    { backgroundColor: Colors.accent },
  dpCellDisabled:{ opacity: 0.3 },
  dpCellText:        { fontSize: FontSizes.md, color: Colors.text, fontWeight: '600' },
  dpCellTextSel:     { color: '#fff' },
  dpCellTextDisabled:{ color: Colors.muted2 },
  applyBtn:        { marginTop: Spacing.md, paddingVertical: 12, borderRadius: Radius.md, backgroundColor: Colors.accent, alignItems: 'center' },
  applyBtnDisabled:{ opacity: 0.4 },
  applyBtnText:    { fontSize: FontSizes.md, fontWeight: '700', color: '#fff' },
});
