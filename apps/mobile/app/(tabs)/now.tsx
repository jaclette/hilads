import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  ActivityIndicator, TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { fetchNowFeed } from '@/api/topics';
import { socket } from '@/lib/socket';
import { track } from '@/services/analytics';
import type { FeedItem, HiladsEvent } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import { CreateSheet } from '@/components/CreateSheet';

// ── Helpers ───────────────────────────────────────────────────────────────────

const EVENT_ICONS: Record<string, string> = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
};

const CATEGORY_ICONS: Record<string, string> = {
  general: '💬', tips: '💡', food: '🍴', drinks: '🍺', help: '🙋', meetup: '👋',
};

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60)   return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function fireEmoji(n: number): string {
  if (n >= 10) return '🔥🔥🔥';
  if (n >= 4)  return '🔥🔥';
  return '🔥';
}

// ── Event card ────────────────────────────────────────────────────────────────

function EventCard({ event, onPress }: { event: HiladsEvent | FeedItem; onPress: () => void }) {
  const now    = Date.now() / 1000;
  const startsAt  = (event as HiladsEvent).starts_at  ?? 0;
  const expiresAt = (event as HiladsEvent).expires_at ?? 0;
  const isLive    = startsAt <= now && expiresAt > now;
  // FeedItem uses event_type; HiladsEvent also has event_type — canonical field
  const eventType = (event as FeedItem).event_type ?? (event as HiladsEvent).event_type ?? 'other';
  const icon      = EVENT_ICONS[eventType] ?? '📌';
  const sourceType = (event as FeedItem).source_type ?? (event as HiladsEvent).source_type ?? 'hilads';
  const isPublic   = sourceType === 'ticketmaster';

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={onPress}>
      <View style={styles.cardKindRow}>
        <View style={styles.kindBadgeEvent}><Text style={styles.kindBadgeText}>Event</Text></View>
        {isPublic && <View style={styles.publicBadge}><Text style={styles.publicBadgeText}>Public</Text></View>}
      </View>
      <View style={styles.cardTitleRow}>
        <Text style={styles.cardIcon}>{icon}</Text>
        <Text style={styles.cardTitle} numberOfLines={2}>{event.title}</Text>
        {!isPublic && (event.participant_count ?? 0) > 0 ? (
          <Text style={styles.goingCount}>{fireEmoji(event.participant_count ?? 0)} {event.participant_count}</Text>
        ) : null}
      </View>
      <View style={styles.timePillRow}>
        <View style={[styles.timePill, isLive && styles.timePillLive]}>
          <Text style={styles.timePillText}>
            🕐 {formatTime(startsAt)}{(event as HiladsEvent).ends_at ? ` → ${formatTime((event as HiladsEvent).ends_at!)}` : ''}
          </Text>
        </View>
        {event.recurrence_label && (
          <View style={styles.recurBadge}>
            <Text style={styles.recurBadgeText}>↻ {event.recurrence_label}</Text>
          </View>
        )}
      </View>
      {(event.location ?? event.venue) ? (
        <Text style={styles.cardLocation} numberOfLines={1}>
          📍 {event.location ?? event.venue}
        </Text>
      ) : null}
      {!isPublic && (
        <View style={styles.cardFooter}>
          <View style={styles.joinBtn}><Text style={styles.joinBtnText}>Join →</Text></View>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── Topic card ────────────────────────────────────────────────────────────────

function TopicCard({ topic, onPress }: { topic: FeedItem & { kind: 'topic' }; onPress: () => void }) {
  const icon      = CATEGORY_ICONS[topic.category ?? 'general'] ?? '💬';
  const replies   = topic.message_count ?? 0;
  const lastAct   = topic.last_activity_at;
  const activeNow = topic.active_now === true;

  return (
    <TouchableOpacity style={styles.topicCard} activeOpacity={0.75} onPress={onPress}>
      <View style={styles.cardKindRow}>
        <View style={styles.kindBadgeTopic}><Text style={styles.kindBadgeTopicText}>Pulse</Text></View>
        {activeNow && (
          <View style={styles.activeNowBadge}>
            <Text style={styles.activeNowText}>● Active now</Text>
          </View>
        )}
      </View>
      <View style={styles.cardTitleRow}>
        <Text style={styles.cardIcon}>{icon}</Text>
        <Text style={[styles.cardTitle, styles.topicTitle]} numberOfLines={2}>{topic.title}</Text>
      </View>
      {topic.description ? (
        <Text style={styles.topicDesc} numberOfLines={2}>{topic.description}</Text>
      ) : null}
      <View style={styles.cardFooter}>
        <Text style={styles.topicMeta}>
          {replies > 0
            ? `💬 ${replies} ${replies === 1 ? 'reply' : 'replies'}${lastAct ? ` · ${timeAgo(lastAct)}` : ''}`
            : 'No replies yet — be first'}
        </Text>
        <View style={styles.joinBtn}><Text style={styles.joinBtnText}>Join →</Text></View>
      </View>
    </TouchableOpacity>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ city }: { city?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>✨</Text>
      <Text style={styles.emptyTitle}>Nothing happening yet</Text>
      <Text style={styles.emptySub}>
        {city ? `Be the first in ${city}` : 'Start something now'}
        {'\n'}Create an event or start a pulse.
      </Text>
    </View>
  );
}

function FilterEmptyState({ filter, city }: { filter: 'all' | 'events' | 'topics'; city?: string }) {
  if (filter === 'all') return <EmptyState city={city} />;
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>{filter === 'events' ? '🔥' : '💬'}</Text>
      <Text style={styles.emptyTitle}>
        {filter === 'events' ? 'No events right now' : 'No pulses yet'}
      </Text>
      <Text style={styles.emptySub}>
        {filter === 'events'
          ? `Be the first to create one${city ? ` in ${city}` : ''}`
          : 'Start a pulse and get the city talking'}
      </Text>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function NowScreen() {
  const router = useRouter();
  const { city, identity, bootstrapData } = useApp();

  // Seed from bootstrap data if available for the current city (avoids initial fetchNowFeed call).
  const nowBootstrap = bootstrapData?.channelId === city?.channelId ? bootstrapData : undefined;

  const [items,         setItems]         = useState<FeedItem[]>(nowBootstrap?.feedItems ?? []);
  const [publicEvents,  setPublicEvents]  = useState<HiladsEvent[]>(nowBootstrap?.publicEvents ?? []);
  const [loading,       setLoading]       = useState(!nowBootstrap);
  const [refreshing,    setRefreshing]    = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [showSheet,     setShowSheet]     = useState(false);
  const [filter,        setFilter]        = useState<'all' | 'events' | 'topics'>('all');

  // Stable ref for WS participant count patches
  const itemsRef = useRef<FeedItem[]>([]);
  itemsRef.current = items;

  // Dedup guard: prevents two concurrent loads (useFocusEffect + useEffect both fire on mount).
  // Pre-seeded from bootstrap → set lastLoadAtRef to now so the first focus doesn't re-fetch.
  const loadingRef    = useRef(false);
  const lastLoadAtRef = useRef(nowBootstrap ? Date.now() : 0);

  async function load(isRefresh = false) {
    if (!city) { setLoading(false); return; }
    // Skip if already in-flight or data is fresh — unless it's a manual pull-to-refresh.
    if (!isRefresh && (loadingRef.current || Date.now() - lastLoadAtRef.current < 30_000)) return;

    loadingRef.current = true;
    lastLoadAtRef.current = Date.now();
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const { items: nowData, publicEvents: pubData } = await fetchNowFeed(city.channelId, identity?.guestId);
      setItems(nowData);
      setPublicEvents(pubData);
    } catch {
      setError('Could not load feed');
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }

  // Primary trigger: runs when screen gains focus or city changes.
  useFocusEffect(useCallback(() => { load(); }, [city?.channelId]));

  // Safety trigger: if city loads after the screen is already focused,
  // useFocusEffect may not re-fire. This effect catches that case.
  useEffect(() => { if (city) load(); }, [city?.channelId]);

  // Live participant count patches from WebSocket
  useEffect(() => {
    const off = socket.on('event_participants_update', (data: Record<string, unknown>) => {
      const { eventId, count } = data as { eventId: string; count: number };
      setItems(prev => prev.map(item =>
        item.kind === 'event' && item.id === eventId
          ? { ...item, participant_count: count as number }
          : item,
      ));
    });
    return off;
  }, []);

  // No city
  if (!city && !loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.push('/(tabs)/chat')} activeOpacity={0.75}>
            <Ionicons name="chevron-back" size={20} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Now</Text>
          </View>
        </View>
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🌍</Text>
          <Text style={styles.emptyTitle}>No city selected</Text>
          <Text style={styles.emptySub}>Pick a city to see what's happening.</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/(tabs)/cities')} activeOpacity={0.85}>
            <Text style={styles.emptyBtnText}>Browse cities</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Apply filter then build flat list data — memoized to avoid recreating arrays on every render.
  const filteredItems = useMemo(
    () => filter === 'events' ? items.filter(i => i.kind === 'event')
        : filter === 'topics' ? items.filter(i => i.kind === 'topic')
        : items,
    [items, filter],
  );

  const listData = useMemo<Array<FeedItem | { kind: 'section'; label: string } | (HiladsEvent & { kind: 'public_event' })>>(
    () => {
      const showPublic = filter !== 'topics' && publicEvents.length > 0;
      return [
        ...filteredItems,
        ...(showPublic
          ? [
              { kind: 'section' as const, label: '🎫 Public Events' },
              ...publicEvents.map(e => ({ ...e, kind: 'public_event' as const })),
            ]
          : []),
      ];
    },
    [filteredItems, publicEvents, filter],
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.push('/(tabs)/chat')} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Now</Text>
          {city && <Text style={styles.headerSub}>{city.name}</Text>}
        </View>
      </View>

      {/* Filter pills */}
      <View style={styles.filterBar}>
        {(['all', 'events', 'topics'] as const).map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterPill, filter === f && styles.filterPillActive]}
            onPress={() => setFilter(f)}
            activeOpacity={0.75}
          >
            <Text style={[styles.filterPillText, filter === f && styles.filterPillTextActive]}>
              {f === 'all' ? 'All' : f === 'events' ? '🔥 Events' : '💬 Pulses'}
            </Text>
          </TouchableOpacity>
        ))}
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
      ) : listData.length === 0 ? (
        <FilterEmptyState filter={filter} city={city?.name} />
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item, idx) => ('id' in item ? item.id : `section-${idx}`)}
          removeClippedSubviews
          maxToRenderPerBatch={6}
          windowSize={5}
          renderItem={({ item }) => {
            if (item.kind === 'section') {
              return <Text style={styles.sectionLabel}>{item.label}</Text>;
            }
            if (item.kind === 'topic') {
              return (
                <TopicCard
                  topic={item as FeedItem & { kind: 'topic' }}
                  onPress={() => {
                    track('topic_opened', { topicId: item.id });
                    router.push(`/topic/${item.id}`);
                  }}
                />
              );
            }
            // event or public_event — map FeedItem to HiladsEvent shape for EventCard
            const event = item as HiladsEvent;
            return (
              <EventCard
                event={event}
                onPress={() => {
                  track('event_opened', { eventId: event.id });
                  router.push(`/event/${event.id}`);
                }}
              />
            );
          }}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.accent} />
          }
        />
      )}

      {/* Sticky CTA */}
      {city && (
        <TouchableOpacity
          style={styles.upcomingCta}
          activeOpacity={0.7}
          onPress={() => router.push(`/upcoming-events?channelId=${city.channelId}&timezone=${encodeURIComponent(city.timezone ?? 'UTC')}`)}
        >
          <Text style={styles.upcomingCtaEmoji}>🔮</Text>
          <Text style={styles.upcomingCtaText}>See what's coming</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.accent} />
        </TouchableOpacity>
      )}

      {/* FAB — unified create */}
      <TouchableOpacity style={styles.fab} activeOpacity={0.85} onPress={() => setShowSheet(true)}>
        <Text style={styles.fabIcon}>+</Text>
      </TouchableOpacity>

      <CreateSheet
        visible={showSheet}
        onClose={() => setShowSheet(false)}
        onSelectEvent={() => router.push('/event/create')}
        onSelectTopic={() => router.push('/topic/create')}
      />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  // Header — web: BackButton left + "Now" centered (page-header layout)
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
  headerCenter: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  headerTitle:  { fontSize: FontSizes.xl, fontWeight: '800', color: Colors.text, letterSpacing: -0.5 },
  headerSub:    { fontSize: FontSizes.sm, color: Colors.muted, marginTop: 2 },

  // ── Filter bar ─────────────────────────────────────────────────────────────
  filterBar: {
    flexDirection:     'row',
    gap:               8,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical:   6,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.12)',
  },
  filterPillActive: {
    backgroundColor: Colors.accent,
    borderColor:     Colors.accent,
  },
  filterPillText: {
    fontSize:   FontSizes.sm,
    fontWeight: '500',
    color:      Colors.muted,
  },
  filterPillTextActive: {
    color:      Colors.white,
    fontWeight: '600',
  },

  center:    { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
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

  list: { paddingBottom: 170, paddingHorizontal: Spacing.md, gap: Spacing.sm },

  // ── Shared card base ───────────────────────────────────────────────────────
  card: {
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     Colors.border,
    padding:         Spacing.md,
    gap:             8,
  },

  // ── Kind badge row ─────────────────────────────────────────────────────────
  cardKindRow: { flexDirection: 'row', marginBottom: -2 },
  kindBadgeEvent: {
    backgroundColor:   'rgba(255,122,60,0.12)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.22)',
  },
  kindBadgeTopic: {
    backgroundColor:   'rgba(96,165,250,0.12)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderWidth:       1,
    borderColor:       'rgba(96,165,250,0.22)',
  },
  kindBadgeText:      { fontSize: 10, fontWeight: '700', color: Colors.accent,  letterSpacing: 0.5 },
  kindBadgeTopicText: { fontSize: 10, fontWeight: '700', color: '#60a5fa',      letterSpacing: 0.5 },

  // ── Event card fields ──────────────────────────────────────────────────────
  cardTitleRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardIcon:      { fontSize: 22, marginTop: 1 },
  cardTitle:     { flex: 1, fontSize: FontSizes.lg, fontWeight: '700', color: Colors.text, lineHeight: 26 },
  goingCount:    { fontSize: FontSizes.sm, color: Colors.accent, fontWeight: '600', marginTop: 3, flexShrink: 0 },

  timePillRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  timePill: {
    backgroundColor:   'rgba(255,255,255,0.06)',
    borderRadius:      Radius.full,
    paddingHorizontal: 12,
    paddingVertical:   5,
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.08)',
  },
  timePillLive:     { backgroundColor: 'rgba(255,122,60,0.12)', borderColor: 'rgba(255,122,60,0.2)' },
  timePillText:     { fontSize: FontSizes.sm, fontWeight: '600', color: Colors.accent },
  recurBadge:       { backgroundColor: 'rgba(184,114,40,0.15)', borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(184,114,40,0.25)' },
  recurBadgeText:   { color: Colors.accent3, fontSize: FontSizes.sm, fontWeight: '600' },
  cardLocation:     { fontSize: FontSizes.sm, color: Colors.muted, lineHeight: 20 },

  // ── Topic card fields ──────────────────────────────────────────────────────
  topicCard: {
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     'rgba(96,165,250,0.15)',
    padding:         Spacing.md,
    gap:             8,
  },
  topicTitle: { color: Colors.text },
  topicDesc:  { fontSize: FontSizes.sm, color: Colors.muted, lineHeight: 20 },
  topicMeta:  { flex: 1, fontSize: FontSizes.sm, color: '#60a5fa', fontWeight: '600' },

  // ── Shared card footer (meta + Join CTA) ───────────────────────────────────
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  joinBtn: {
    backgroundColor:   'rgba(255,122,60,0.12)',
    borderRadius:      Radius.full,
    paddingHorizontal: 12,
    paddingVertical:   5,
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.22)',
    flexShrink:        0,
  },
  joinBtnText: { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.accent },

  // ── Active now badge ───────────────────────────────────────────────────────
  activeNowBadge: {
    backgroundColor:   'rgba(34,197,94,0.10)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderWidth:       1,
    borderColor:       'rgba(34,197,94,0.20)',
    marginLeft:        6,
  },
  activeNowText: { fontSize: 10, fontWeight: '700', color: '#4ade80', letterSpacing: 0.3 },

  // ── Public badge ───────────────────────────────────────────────────────────
  publicBadge: {
    backgroundColor:   'rgba(255,255,255,0.07)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.10)',
    marginLeft:        6,
  },
  publicBadgeText: { fontSize: 10, fontWeight: '700', color: Colors.muted, letterSpacing: 0.3 },

  // ── Empty state ────────────────────────────────────────────────────────────
  empty: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    padding: Spacing.xl, gap: Spacing.sm,
  },
  emptyEmoji: { fontSize: 48, marginBottom: Spacing.sm },
  emptyTitle: { fontSize: FontSizes.xl, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  emptySub:   { fontSize: FontSizes.md, color: Colors.muted, textAlign: 'center', lineHeight: 22 },
  emptyBtn: {
    marginTop: Spacing.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm + 2,
    backgroundColor: Colors.accent, borderRadius: Radius.full,
  },
  emptyBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSizes.sm },

  // ── FAB + CTA ──────────────────────────────────────────────────────────────
  fab: {
    position:        'absolute',
    right:           Spacing.md,
    bottom:          Spacing.md + 52 + Spacing.sm,
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

  upcomingCta: {
    position:          'absolute',
    left:              Spacing.md,
    right:             Spacing.md,
    bottom:            Spacing.md,
    backgroundColor:   Colors.bg2,
    borderRadius:      Radius.lg,
    borderWidth:       1,
    borderColor:       Colors.border,
    paddingVertical:   Spacing.md,
    paddingHorizontal: Spacing.md,
    flexDirection:     'row',
    alignItems:        'center',
    gap:               10,
  },
  upcomingCtaEmoji: { fontSize: 22, lineHeight: 28 },
  upcomingCtaText:  { flex: 1, fontSize: FontSizes.lg, fontWeight: '700', color: Colors.text },
});
