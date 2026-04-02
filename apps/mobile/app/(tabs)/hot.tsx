import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, SectionList, StyleSheet,
  ActivityIndicator, TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { fetchCityEvents, fetchPublicCityEvents } from '@/api/events';
import { socket } from '@/lib/socket';
import { track } from '@/services/analytics';
import type { HiladsEvent } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

// ── Helpers ───────────────────────────────────────────────────────────────────

const EVENT_ICONS: Record<string, string> = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
};

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString([], {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

function fireEmoji(n: number): string {
  if (n >= 10) return '🔥🔥🔥';
  if (n >= 4)  return '🔥🔥';
  return '🔥';
}

// ── Event card ────────────────────────────────────────────────────────────────

function EventCard({ event, onPress }: { event: HiladsEvent; onPress: () => void }) {
  const now    = Date.now() / 1000;
  const isLive = event.starts_at <= now && event.expires_at > now;
  const icon   = EVENT_ICONS[event.event_type] ?? '📌';

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={onPress}>
      {/* Title row: icon + name + public badge / going count — web: .event-title */}
      <View style={styles.cardTitleRow}>
        <Text style={styles.cardIcon}>{icon}</Text>
        <Text style={styles.cardTitle} numberOfLines={2}>{event.title}</Text>
        {event.source_type === 'ticketmaster' ? (
          <Text style={styles.publicBadge}>Public</Text>
        ) : (event.participant_count ?? 0) > 0 ? (
          <Text style={styles.goingCount}>{fireEmoji(event.participant_count!)} {event.participant_count}</Text>
        ) : null}
      </View>

      {/* Time pill + recurrence badge — web: .event-time-row */}
      <View style={styles.timePillRow}>
        <View style={[styles.timePill, isLive && styles.timePillLive]}>
          <Text style={styles.timePillText}>
            🕐 {formatTime(event.starts_at)}{event.ends_at ? ` → ${formatTime(event.ends_at)}` : ''}
          </Text>
        </View>
        {event.recurrence_label && (
          <View style={styles.recurBadge}>
            <Text style={styles.recurBadgeText}>↻ {event.recurrence_label}</Text>
          </View>
        )}
      </View>

      {/* Location */}
      {(event.location ?? event.venue) ? (
        <Text style={styles.cardLocation} numberOfLines={1}>
          📍 {event.location ?? event.venue}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>🔥</Text>
      <Text style={styles.emptyTitle}>No events today</Text>
      <Text style={styles.emptySub}>Build the vibe you want to see.</Text>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function HotScreen() {
  const router = useRouter();
  const { city, identity } = useApp();
  const [hiladsEvents,  setHiladsEvents]  = useState<HiladsEvent[]>([]);
  const [publicEvents,  setPublicEvents]  = useState<HiladsEvent[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [error,         setError]         = useState<string | null>(null);

  // Stable ref so WS handler can patch counts without stale closure
  const eventsRef = useRef<HiladsEvent[]>([]);
  eventsRef.current = hiladsEvents;

  async function load(isRefresh = false) {
    if (!city) {
      setLoading(false);
      return;
    }
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      // Fetch hilads + public events in parallel — mirrors web Promise.allSettled() call.
      // Passing guestId embeds participant_count + is_participating per event (no N+1 fetches).
      const [hiladsData, publicData] = await Promise.all([
        fetchCityEvents(city.channelId, identity?.guestId),
        fetchPublicCityEvents(city.channelId),
      ]);
      setHiladsEvents(hiladsData);
      setPublicEvents(publicData);
    } catch {
      setError('Could not load events');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useFocusEffect(useCallback(() => { load(); }, [city?.channelId]));

  // Live participant count updates — mirrors web event_participants_update WS listener
  useEffect(() => {
    const off = socket.on('event_participants_update', (data: Record<string, unknown>) => {
      const { eventId, count } = data as { eventId: string; count: number };
      setHiladsEvents(prev => prev.map(e => e.id === eventId ? { ...e, participant_count: count } : e));
    });
    return off;
  }, []);

  // No city — prompt to select one
  if (!city && !loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.push('/(tabs)/chat')} activeOpacity={0.75}>
            <Ionicons name="chevron-back" size={20} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Hot</Text>
          </View>
        </View>
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🌍</Text>
          <Text style={styles.emptyTitle}>No city selected</Text>
          <Text style={styles.emptySub}>
            We couldn't detect your location.{'\n'}Pick a city to see what's happening.
          </Text>
          <TouchableOpacity
            style={styles.emptyBtn}
            onPress={() => router.push('/(tabs)/cities')}
            activeOpacity={0.85}
          >
            <Text style={styles.emptyBtnText}>Browse cities</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header — web: BackButton left + "Hot" title centered */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.push('/(tabs)/chat')}
          activeOpacity={0.75}
        >
          <Ionicons name="chevron-back" size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Hot</Text>
          {city && <Text style={styles.headerSub}>{city.name}</Text>}
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
      ) : hiladsEvents.length === 0 && publicEvents.length === 0 ? (
        <EmptyState />
      ) : (
        <SectionList
          sections={[
            { key: 'hilads', title: 'Hilads Events', data: hiladsEvents },
            ...(publicEvents.length > 0
              ? [{ key: 'public', title: 'Public Events', data: publicEvents }]
              : []),
          ]}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => (
            <EventCard
              event={item}
              onPress={() => {
                track('event_opened', { eventId: item.id });
                router.push(`/event/${item.id}`);
              }}
            />
          )}
          renderSectionHeader={({ section }) => (
            <>
              {section.key === 'public' && <View style={styles.sectionDivider} />}
              <Text style={styles.sectionLabel}>{section.title}</Text>
              {section.key === 'hilads' && hiladsEvents.length === 0 && (
                <Text style={styles.sectionEmpty}>No Hilads events yet</Text>
              )}
            </>
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={Colors.accent}
            />
          }
          stickySectionHeadersEnabled={false}
          ListFooterComponent={
            city ? (
              <TouchableOpacity
                style={styles.upcomingCta}
                activeOpacity={0.72}
                onPress={() => router.push(`/upcoming-events?channelId=${city.channelId}&timezone=${encodeURIComponent(city.timezone ?? 'UTC')}`)}
              >
                <Text style={styles.upcomingCtaEmoji}>🔮</Text>
                <Text style={styles.upcomingCtaText}>See what's coming</Text>
                <Ionicons name="chevron-forward" size={15} color="#FF7A3C" style={{ opacity: 0.7 }} />
              </TouchableOpacity>
            ) : null
          }
        />
      )}

      {/* ── FAB — always visible, matches web "+" button ── */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.85}
        onPress={() => router.push(`/event/create`)}
      >
        <Text style={styles.fabIcon}>+</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  flex1:     { flex: 1 },

  // Header — web: BackButton left + "Hot" centered (page-header layout)
  // Title is absolutely centered so it stays centered regardless of side elements.
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
  // Absolutely centered title — unaffected by left/right elements
  headerCenter: {
    position:  'absolute',
    left:      0,
    right:     0,
    alignItems: 'center',
  },
  headerTitle: { fontSize: FontSizes.xl, fontWeight: '800', color: Colors.text, letterSpacing: -0.5 },
  headerSub:   { fontSize: FontSizes.sm, color: Colors.muted, marginTop: 2 },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  errorText: { fontSize: FontSizes.sm, color: Colors.red, marginBottom: Spacing.md, textAlign: 'center' },
  retryBtn:  { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, backgroundColor: Colors.bg3, borderRadius: Radius.full },
  retryText: { color: Colors.accent, fontWeight: '600', fontSize: FontSizes.sm },

  sectionLabel: {
    paddingHorizontal: Spacing.md,
    paddingTop:        Spacing.md,
    paddingBottom:     Spacing.sm,
    fontSize:          FontSizes.xs,
    fontWeight:        '700',
    letterSpacing:     1.0,
    textTransform:     'uppercase',
    color:             Colors.muted,
  },
  sectionEmpty: {
    paddingHorizontal: Spacing.md,
    paddingBottom:     Spacing.md,
    fontSize:          FontSizes.sm,
    color:             Colors.muted2,
  },
  sectionDivider: {
    height:          1,
    backgroundColor: Colors.border,
    marginVertical:  Spacing.sm,
  },

  list: { paddingBottom: 100, paddingHorizontal: Spacing.md, gap: Spacing.sm },

  // ── Event card — web: .event-card ──────────────────────────────────────────

  card: {
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     Colors.border,
    padding:         Spacing.md,
    gap:             10,
  },

  // Title row: icon + name + going count
  cardTitleRow: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           10,
  },
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

  // Time pill + recurrence badge — web: .event-time pill dark bg, orange time text
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
  timePillText: { fontSize: FontSizes.sm, fontWeight: '600', color: Colors.accent },

  recurBadge:     { backgroundColor: 'rgba(184,114,40,0.15)', borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(184,114,40,0.25)' },
  recurBadgeText: { color: Colors.accent3, fontSize: FontSizes.sm, fontWeight: '600' },

  cardLocation: { fontSize: FontSizes.sm, color: Colors.muted, lineHeight: 20 },

  // ── Empty state ────────────────────────────────────────────────────────────

  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems:     'center',
    padding:        Spacing.xl,
    gap:            Spacing.sm,
  },
  emptyEmoji: { fontSize: 48, marginBottom: Spacing.sm },
  emptyTitle: { fontSize: FontSizes.xl, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  emptySub:   { fontSize: FontSizes.md, color: Colors.muted, textAlign: 'center', lineHeight: 22 },
  emptyBtn: {
    marginTop:         Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical:   Spacing.sm + 2,
    backgroundColor:   Colors.accent,
    borderRadius:      Radius.full,
  },
  emptyBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSizes.sm },

  // ── FAB — web: .fab-create (fixed bottom-right, orange circle) ────────────
  fab: {
    position:        'absolute',
    right:           20,
    bottom:          24,
    width:           58,
    height:          58,
    borderRadius:    29,
    backgroundColor: Colors.accent,
    alignItems:      'center',
    justifyContent:  'center',
    shadowColor:     Colors.accent,
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.45,
    shadowRadius:    12,
    elevation:       10,
  },
  fabIcon: { fontSize: 30, color: Colors.white, lineHeight: 34, marginTop: -2 },

  // ── Upcoming CTA footer ─────────────────────────────────────────────────────
  upcomingCta: {
    marginTop:        Spacing.lg,
    marginHorizontal: 0,
    paddingVertical:  Spacing.md + 2,
    paddingHorizontal: Spacing.lg,
    backgroundColor:  'rgba(255, 122, 60, 0.07)',
    borderRadius:     Radius.lg,
    borderWidth:      1,
    borderColor:      'rgba(255, 122, 60, 0.22)',
    flexDirection:    'row',
    alignItems:       'center',
    justifyContent:   'center',
    gap:              10,
    shadowColor:      '#FF7A3C',
    shadowOffset:     { width: 0, height: 0 },
    shadowOpacity:    0.18,
    shadowRadius:     14,
    elevation:        3,
  },
  upcomingCtaEmoji: {
    fontSize: 18,
    lineHeight: 22,
  },
  upcomingCtaText: {
    fontSize:   FontSizes.md,
    fontWeight: '700',
    color:      Colors.text,
  },
});
