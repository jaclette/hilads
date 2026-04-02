import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, SectionList, StyleSheet,
  ActivityIndicator, TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fetchUpcomingEvents } from '@/api/events';
import type { HiladsEvent } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

// ── Helpers ───────────────────────────────────────────────────────────────────

const EVENT_ICONS: Record<string, string> = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
};

function formatTime(ts: number, tz: string): string {
  return new Date(ts * 1000).toLocaleTimeString('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function getDayLabel(ts: number, tz: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const toKey = (d: Date) => {
    const parts = formatter.formatToParts(d);
    const m: Record<string, string> = {};
    parts.forEach(p => { m[p.type] = p.value; });
    return `${m.year}-${m.month}-${m.day}`;
  };
  const todayKey = toKey(new Date());
  const eventKey = toKey(new Date(ts * 1000));

  if (eventKey === todayKey) return 'Today';
  const diff = Math.round((new Date(eventKey).getTime() - new Date(todayKey).getTime()) / 86400000);
  if (diff === 1) return 'Tomorrow';
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    timeZone: tz, weekday: 'long', month: 'short', day: 'numeric',
  });
}

type DaySection = { title: string; data: HiladsEvent[] };

function groupByDay(events: HiladsEvent[], tz: string): DaySection[] {
  const sections: DaySection[] = [];
  const seen: Record<string, number> = {};
  for (const event of events) {
    const label = getDayLabel(event.starts_at, tz);
    if (!(label in seen)) {
      seen[label] = sections.length;
      sections.push({ title: label, data: [] });
    }
    sections[seen[label]].data.push(event);
  }
  return sections;
}

// ── Event card ────────────────────────────────────────────────────────────────

function UpcomingCard({ event, tz, onPress }: { event: HiladsEvent; tz: string; onPress: () => void }) {
  const now    = Date.now() / 1000;
  const isLive = event.starts_at <= now && event.expires_at > now;
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
          <Text style={styles.goingCount}>👥 {going}</Text>
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

  const [sections,   setSections]   = useState<DaySection[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  async function load(isRefresh = false) {
    if (!channelId) return;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const events = await fetchUpcomingEvents(channelId);
      setSections(groupByDay(events, tz));
    } catch {
      setError('Could not load upcoming events');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, [channelId]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Next 7 days</Text>
        </View>
      </View>

      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load()} activeOpacity={0.8}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : sections.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>📅</Text>
          <Text style={styles.emptyTitle}>Nothing planned yet</Text>
          <Text style={styles.emptySub}>Check back soon — the week is just getting started.</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => (
            <UpcomingCard
              event={item}
              tz={tz}
              onPress={() => router.push(`/event/${item.id}`)}
            />
          )}
          renderSectionHeader={({ section }) => (
            <Text style={[
              styles.sectionLabel,
              section.title === 'Today' && styles.sectionLabelToday,
            ]}>
              {section.title}
            </Text>
          )}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={Colors.accent}
            />
          }
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
  headerCenter: {
    position:  'absolute',
    left:      0,
    right:     0,
    alignItems: 'center',
  },
  headerTitle: { fontSize: FontSizes.xl, fontWeight: '800', color: Colors.text, letterSpacing: -0.5 },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl, gap: Spacing.sm },
  errorText:  { fontSize: FontSizes.sm, color: Colors.red, textAlign: 'center' },
  retryBtn:   { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, backgroundColor: Colors.bg3, borderRadius: Radius.full },
  retryText:  { color: Colors.accent, fontWeight: '600', fontSize: FontSizes.sm },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: FontSizes.xl, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  emptySub:   { fontSize: FontSizes.md, color: Colors.muted, textAlign: 'center', lineHeight: 22 },

  list: { paddingBottom: 40, paddingHorizontal: Spacing.md, gap: Spacing.sm },

  sectionLabel: {
    paddingTop:    Spacing.md,
    paddingBottom: Spacing.sm,
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    letterSpacing: 1.0,
    textTransform: 'uppercase',
    color:         Colors.muted,
    borderTopWidth:  1,
    borderTopColor:  Colors.border,
    marginTop:       Spacing.sm,
  },
  sectionLabelToday: {
    color:         Colors.text,
    borderTopWidth: 0,
    marginTop:     0,
  },

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
  goingCount:  { fontSize: FontSizes.sm, color: Colors.muted, fontWeight: '600', marginTop: 3 },
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
});
