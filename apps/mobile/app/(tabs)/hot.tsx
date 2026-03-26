import { useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  ActivityIndicator, TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '@/context/AppContext';
import { fetchCityEvents } from '@/api/events';
import type { HiladsEvent } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

const EVENT_ICONS: Record<string, string> = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
};

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function EventCard({ event }: { event: HiladsEvent }) {
  const now     = Date.now() / 1000;
  const isLive  = event.starts_at <= now && event.expires_at > now;
  const icon    = EVENT_ICONS[event.event_type] ?? '📌';

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.7}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardIcon}>{icon}</Text>
        <View style={styles.cardMeta}>
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
      </View>

      <Text style={styles.cardTitle} numberOfLines={2}>{event.title}</Text>

      {(event.location ?? event.venue) ? (
        <Text style={styles.cardLocation} numberOfLines={1}>
          📍 {event.location ?? event.venue}
        </Text>
      ) : null}

      <Text style={styles.cardTime}>
        {formatTime(event.starts_at)}
        {event.ends_at ? ` → ${formatTime(event.ends_at)}` : ''}
      </Text>
    </TouchableOpacity>
  );
}

export default function HotScreen() {
  const { city } = useApp();
  const [events,     setEvents]     = useState<HiladsEvent[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  async function load(isRefresh = false) {
    if (!city) return;
    if (isRefresh) setRefreshing(true);
    setError(null);
    try {
      const data = await fetchCityEvents(city.channelId);
      setEvents(data);
    } catch (e) {
      setError('Could not load events');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, [city?.channelId]);

  if (!city && !loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No city selected</Text>
          <Text style={styles.emptySubtitle}>We couldn't detect your location. Go to Cities to pick one.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🔥 Hot</Text>
        {city && <Text style={styles.headerCity}>{city.name}</Text>}
      </View>

      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => <EventCard event={item} />}
          contentContainerStyle={events.length === 0 ? styles.flex1 : styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={Colors.accent}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>Nothing happening yet</Text>
              <Text style={styles.emptySubtitle}>Be the first to start something.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  flex1:     { flex: 1 },
  header: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle:  { fontSize: FontSizes.lg, fontWeight: '700', color: Colors.text },
  headerCity:   { fontSize: FontSizes.sm, color: Colors.muted },
  center:       { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  emptyTitle:   { fontSize: FontSizes.md, fontWeight: '600', color: Colors.text, textAlign: 'center', marginBottom: Spacing.xs },
  emptySubtitle:{ fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center' },
  errorText:    { fontSize: FontSizes.sm, color: Colors.red, marginBottom: Spacing.md },
  retryBtn:     { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, backgroundColor: Colors.bg3, borderRadius: Radius.md },
  retryText:    { color: Colors.accent, fontWeight: '600', fontSize: FontSizes.sm },
  list:         { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, gap: Spacing.sm },
  card: {
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     Colors.border,
    padding:         Spacing.md,
    gap:             Spacing.xs,
  },
  cardHeader:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  cardIcon:         { fontSize: 20 },
  cardMeta:         { flexDirection: 'row', gap: Spacing.xs, flex: 1 },
  liveBadge:        { backgroundColor: 'rgba(255,122,60,0.18)', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  liveBadgeText:    { color: Colors.accent, fontSize: FontSizes.xs, fontWeight: '700' },
  recurBadge:       { backgroundColor: 'rgba(167,139,250,0.15)', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  recurBadgeText:   { color: Colors.violet, fontSize: FontSizes.xs, fontWeight: '600' },
  cardTitle:        { fontSize: FontSizes.md, fontWeight: '600', color: Colors.text },
  cardLocation:     { fontSize: FontSizes.sm, color: Colors.muted },
  cardTime:         { fontSize: FontSizes.xs, color: Colors.muted2 },
});
