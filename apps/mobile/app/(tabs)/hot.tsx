import { useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  ActivityIndicator, TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { fetchCityEvents } from '@/api/events';
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

// ── Event card ────────────────────────────────────────────────────────────────

function EventCard({ event, onPress }: { event: HiladsEvent; onPress: () => void }) {
  const now    = Date.now() / 1000;
  const isLive = event.starts_at <= now && event.expires_at > now;
  const icon   = EVENT_ICONS[event.event_type] ?? '📌';

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={onPress}>
      {/* Top row: icon + badges */}
      <View style={styles.cardTop}>
        <Text style={styles.cardIcon}>{icon}</Text>
        <View style={styles.cardBadges}>
          {isLive && (
            <View style={styles.liveBadge}>
              <Text style={styles.liveBadgeText}>Live</Text>
            </View>
          )}
          {event.recurrence_label && (
            <View style={styles.recurBadge}>
              <Text style={styles.recurBadgeText}>↻ {event.recurrence_label}</Text>
            </View>
          )}
        </View>
        {event.participant_count !== undefined && event.participant_count > 0 && (
          <Text style={styles.goingCount}>{event.participant_count} going</Text>
        )}
      </View>

      {/* Title — large, the hero of the card */}
      <Text style={styles.cardTitle} numberOfLines={2}>{event.title}</Text>

      {/* Location */}
      {(event.location ?? event.venue) ? (
        <Text style={styles.cardLocation} numberOfLines={1}>
          📍 {event.location ?? event.venue}
        </Text>
      ) : null}

      {/* Time */}
      <Text style={styles.cardTime}>
        {formatDate(event.starts_at)} · {formatTime(event.starts_at)}
        {event.ends_at ? ` → ${formatTime(event.ends_at)}` : ''}
      </Text>
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
  const { city } = useApp();
  const [events,     setEvents]     = useState<HiladsEvent[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  async function load(isRefresh = false) {
    if (!city) {
      setLoading(false);
      return;
    }
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      // eslint-disable-next-line no-console
      console.log('[Hot] fetching events for', city.channelId);
      const data = await fetchCityEvents(city.channelId);
      // eslint-disable-next-line no-console
      console.log('[Hot] received', data.length, 'events');
      setEvents(data);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[Hot] fetch failed:', e);
      setError('Could not load events');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, [city?.channelId]);

  // No city — prompt to select one
  if (!city && !loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>🔥 Hot</Text>
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
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>🔥 Hot</Text>
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
      ) : (
        <FlatList
          data={events}
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
          contentContainerStyle={events.length === 0 ? styles.flex1 : styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={Colors.accent}
            />
          }
          ListEmptyComponent={<EmptyState />}
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  flex1:     { flex: 1 },

  header: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSizes.xl, fontWeight: '800', color: Colors.text, letterSpacing: -0.5 },
  headerSub:   { fontSize: FontSizes.sm, color: Colors.muted, marginTop: 2 },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  errorText: { fontSize: FontSizes.sm, color: Colors.red, marginBottom: Spacing.md, textAlign: 'center' },
  retryBtn:  { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, backgroundColor: Colors.bg3, borderRadius: Radius.full },
  retryText: { color: Colors.accent, fontWeight: '600', fontSize: FontSizes.sm },

  list: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, gap: Spacing.sm },

  // ── Event card ─────────────────────────────────────────────────────────────

  card: {
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     Colors.border,
    padding:         Spacing.md,
    gap:             6,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.xs,
    marginBottom:  2,
  },
  cardIcon:  { fontSize: 22 },
  cardBadges:{ flexDirection: 'row', gap: Spacing.xs, flex: 1 },

  liveBadge:     { backgroundColor: 'rgba(255,122,60,0.18)', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  liveBadgeText: { color: Colors.accent, fontSize: FontSizes.xs, fontWeight: '700' },
  recurBadge:    { backgroundColor: 'rgba(139,92,246,0.15)', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  recurBadgeText:{ color: Colors.violet, fontSize: FontSizes.xs, fontWeight: '600' },

  goingCount: { fontSize: FontSizes.xs, color: Colors.muted, fontWeight: '600' },

  cardTitle:    { fontSize: FontSizes.lg, fontWeight: '700', color: Colors.text, lineHeight: 24 },
  cardLocation: { fontSize: FontSizes.sm, color: Colors.muted, lineHeight: 18 },
  cardTime:     { fontSize: FontSizes.xs, color: Colors.muted2, marginTop: 2 },

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
});
