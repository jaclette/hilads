import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  ActivityIndicator, TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { fetchNowFeed } from '@/api/topics';
import { fetchCanCreateEvent } from '@/api/events';
import { socket } from '@/lib/socket';
import { track } from '@/services/analytics';
import type { FeedItem, HiladsEvent } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import { AppHeader } from '@/features/shell/AppHeader';

// ── Helpers ───────────────────────────────────────────────────────────────────

const EVENT_ICONS: Record<string, string> = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
};

const CATEGORY_ICONS: Record<string, string> = {
  general: '🗣️', tips: '💡', food: '🍴', drinks: '🍺', help: '🙋', meetup: '👋',
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


// ── Event card ────────────────────────────────────────────────────────────────

function EventCard({ event, onPress }: { event: HiladsEvent | FeedItem; onPress: () => void }) {
  const isRecurring = !!(event.series_id ?? event.recurrence_label);
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
    <TouchableOpacity style={[styles.card, isRecurring && styles.cardRecurring]} activeOpacity={0.7} onPress={onPress}>
      <View style={styles.cardKindRow}>
        <View style={styles.kindBadgeEvent}><Text style={styles.kindBadgeText}>Event</Text></View>
        {isPublic && <View style={styles.publicBadge}><Text style={styles.publicBadgeText}>Public</Text></View>}
      </View>
      <View style={styles.cardTitleRow}>
        <Text style={styles.cardIcon}>{icon}</Text>
        <Text style={styles.cardTitle} numberOfLines={2}>{event.title}</Text>
        {!isPublic && (event.participant_count ?? 0) > 0 ? (
          <Text style={styles.goingCount}>🙌 {event.participant_count} going</Text>
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
      {(event as HiladsEvent).host_nickname ? (
        <Text style={styles.cardHost} numberOfLines={1}>
          Hosted by {(event as HiladsEvent).host_nickname}
        </Text>
      ) : null}
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
      <Text style={styles.topicMeta}>
        {replies > 0
          ? `💬 ${replies} ${replies === 1 ? 'reply' : 'replies'}${lastAct ? ` · ${timeAgo(lastAct)}` : ''}`
          : 'No replies yet — be first'}
      </Text>
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

function FilterEmptyState({
  filter, city, userMode, onStartPulse,
}: {
  filter:        'all' | 'events' | 'topics';
  city?:         string;
  userMode?:     string | null;
  onStartPulse?: () => void;
}) {
  if (filter === 'all') return <EmptyState city={city} />;
  if (filter === 'events' && userMode === 'local') {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyEmoji}>🌍</Text>
        <Text style={styles.emptyTitle}>Host your spot</Text>
        <Text style={styles.emptySub}>
          {city ? `Make ${city} feel alive.` : 'Make your city feel alive.'}{'\n'}Start a recurring hangout at your favorite place.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>{filter === 'events' ? '🔥' : '🗣️'}</Text>
      <Text style={styles.emptyTitle}>
        {filter === 'events' ? 'No events right now' : 'No pulses yet'}
      </Text>
      <Text style={styles.emptySub}>
        {filter === 'events'
          ? `Be the first to create one${city ? ` in ${city}` : ''}`
          : 'Start a pulse and get the city talking'}
      </Text>

      {/* Pulse-filter-only CTA — mirrors web's centered blue "Start a pulse ⚡"
          button in the empty state (apps/web App.jsx ~3884). */}
      {filter === 'topics' && onStartPulse && (
        <TouchableOpacity
          style={styles.emptyPulseBtn}
          onPress={onStartPulse}
          activeOpacity={0.8}
        >
          <Text style={styles.emptyPulseBtnText}>Start a pulse ⚡</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Participant count cache ───────────────────────────────────────────────────
// Module-level Map so WS patches survive NowScreen unmounts/remounts.
// When the API loads fresh items, applyCountCache() overlays any WS-received
// counts so the user never sees a stale number after navigating away and back.
const participantCountCache = new Map<string, number>(); // eventId → count

function applyCountCache(feedItems: FeedItem[]): FeedItem[] {
  if (participantCountCache.size === 0) return feedItems;
  return feedItems.map(item =>
    item.kind === 'event' && participantCountCache.has(item.id)
      ? { ...item, participant_count: participantCountCache.get(item.id) }
      : item,
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function NowScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { city, identity, account, booting } = useApp();
  const userMode = account?.mode ?? identity?.mode ?? null;

  const [items,         setItems]         = useState<FeedItem[]>([]);
  const [publicEvents,  setPublicEvents]  = useState<FeedItem[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [filter,        setFilter]        = useState<'all' | 'events' | 'topics'>('all');

  // ── NOW action-block handlers — web parity (apps/web/App.jsx:3950+). ────
  // Topics (pulses) have no 1/day rule, so Start-a-pulse pushes directly.
  // Events go through the fetchCanCreateEvent preflight landed in commit
  // e0274e4; server still enforces the limit on POST.
  function handleStartPulse() {
    router.push('/topic/create');
  }
  async function handleHostSpot() {
    if (!city) return;
    try {
      const r = await fetchCanCreateEvent(city.channelId, identity?.guestId);
      if (!r.canCreate) { router.push('/event/limit-reached' as never); return; }
    } catch { /* optimistic open — server safety net catches the race */ }
    router.push('/event/create');
  }
  function handleSeeUpcoming() {
    if (!city) return;
    router.push(
      `/upcoming-events?channelId=${city.channelId}&timezone=${encodeURIComponent(city.timezone ?? 'UTC')}`,
    );
  }

  // Stable ref for WS participant count patches
  const itemsRef = useRef<FeedItem[]>([]);
  itemsRef.current = items;

  // Dedup guard: prevents two concurrent loads (useFocusEffect + useEffect both fire on mount).
  const loadingRef    = useRef(false);
  const lastLoadAtRef = useRef(0);
  // Mirror load() in a ref so the WS handler always calls the current version without re-registering.
  const loadRef = useRef(load);
  loadRef.current = load;

  // Track the city we last loaded for — reset the 30s guard on city change.
  const loadedCityRef = useRef<string | undefined>(undefined);

  async function load(isRefresh = false) {
    if (!city) {
      // Don't set loading=false here — keep showing the spinner while app boots.
      // The city will arrive shortly for returning users; for fresh users the
      // booting/joined state drives the "no city" render below.
      console.log('[NowScreen] load() skipped — city not yet available');
      return;
    }

    // Reset the freshness guard whenever the city changes so we always fetch on switch.
    if (loadedCityRef.current !== city.channelId) {
      lastLoadAtRef.current = 0;
      loadedCityRef.current = city.channelId;
    }

    // Skip if already in-flight or data is fresh — unless it's a manual pull-to-refresh.
    if (!isRefresh && (loadingRef.current || Date.now() - lastLoadAtRef.current < 30_000)) {
      console.log('[NowScreen] load() skipped — in-flight or data fresh', { inFlight: loadingRef.current, age: Date.now() - lastLoadAtRef.current });
      return;
    }

    console.log('[NowScreen] fetch start —', city.name, city.channelId);
    loadingRef.current = true;
    lastLoadAtRef.current = Date.now();
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const { items: nowData, publicEvents: pubData } = await fetchNowFeed(city.channelId, identity?.guestId);
      console.log('[NowScreen] fetch done —', nowData.length, 'items,', pubData.length, 'public events');
      setItems(applyCountCache(nowData));
      setPublicEvents(pubData);
    } catch (err) {
      console.warn('[NowScreen] fetch error:', err);
      setError('Could not load feed');
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }

  // Primary trigger: runs when screen gains focus or city changes.
  useFocusEffect(useCallback(() => {
    console.log('[NowScreen] focus —', city?.name ?? 'no city');
    load();
  }, [city?.channelId]));

  // Safety trigger: if city loads after the screen is already focused,
  // useFocusEffect may not re-fire. This effect catches that case.
  useEffect(() => {
    if (city) {
      console.log('[NowScreen] city changed →', city.name);
      load();
    }
  }, [city?.channelId]);

  // Once boot completes with no city and no join, stop the spinner.
  useEffect(() => {
    if (!booting && !city) setLoading(false);
  }, [booting, city]);

  // Live participant count patches from WebSocket
  useEffect(() => {
    const off = socket.on('event_participants_update', (data: Record<string, unknown>) => {
      const { eventId, count } = data as { eventId: string; count: number };
      participantCountCache.set(eventId, count); // persist across remounts
      setItems(prev => prev.map(item =>
        item.kind === 'event' && item.id === eventId
          ? { ...item, participant_count: count }
          : item,
      ));
    });
    return off;
  }, []);

  // New event created in this city — server pushes new_event via WS.
  // Append the card directly from the WS payload (no HTTP fetch needed).
  // Fallback to a full reload if the payload is incomplete.
  useEffect(() => {
    const off = socket.on('new_event', (data: Record<string, unknown>) => {
      const ev = data.hiladsEvent as Record<string, unknown> | undefined;
      if (!ev?.id || !city || String(data.channelId) !== String(city.channelId)) return;

      const id = ev.id as string;
      setItems(prev => {
        if (prev.some(i => i.id === id)) return prev; // already in feed
        const feedItem: FeedItem = {
          kind:             'event',
          id,
          title:            (ev.title as string) ?? '',
          description:      (ev.location ?? ev.venue ?? null) as string | null,
          created_at:       (ev.created_at as number) ?? Math.floor(Date.now() / 1000),
          last_activity_at: null,
          active_now:       true,
          event_type:       (ev.event_type ?? ev.type ?? 'other') as string,
          source_type:      (ev.source_type ?? ev.source ?? 'hilads') as 'hilads' | 'ticketmaster',
          starts_at:        ev.starts_at as number,
          expires_at:       ev.expires_at as number,
          location:         (ev.location ?? null) as string | null,
          venue:            (ev.venue ?? null) as string | null,
          participant_count: (ev.participant_count ?? 1) as number,
          is_participating: false,
          recurrence_label: (ev.recurrence_label ?? null) as string | null,
          series_id:        (ev.series_id ?? null) as string | null,
          guest_id:         (ev.guest_id ?? null) as string | null,
          created_by:       (ev.created_by ?? null) as string | null,
        };
        return [feedItem, ...prev];
      });
    });
    return off;
  }, [city]);

  // New topic created in this city — append card directly from WS payload.
  useEffect(() => {
    const off = socket.on('newTopic', (data: Record<string, unknown>) => {
      const t = data.topic as Record<string, unknown> | undefined;
      if (!t?.id || !city || String(data.channelId) !== String(city.channelId)) return;

      const id = t.id as string;
      setItems(prev => {
        if (prev.some(i => i.id === id)) return prev;
        const feedItem: FeedItem = {
          kind:             'topic',
          id,
          title:            (t.title as string) ?? '',
          description:      (t.description ?? null) as string | null,
          created_at:       (t.created_at as number) ?? Math.floor(Date.now() / 1000),
          last_activity_at: null,
          active_now:       true,
          category:         (t.category ?? 'general') as string,
          message_count:    0,
          city_id:          (t.city_id ?? '') as string,
        };
        return [feedItem, ...prev];
      });
    });
    return off;
  }, [city]);

  // Still booting or waiting for city — keep showing spinner.
  if (!city && (booting || loading)) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  // Boot finished but user has no city.
  if (!city && !booting && !loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.appHeaderWrap}>
          <AppHeader />
        </View>
        <View style={styles.header}>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Now</Text>
          </View>
        </View>
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🌍</Text>
          <Text style={styles.emptyTitle}>No city selected</Text>
          <Text style={styles.emptySub}>Pick a city to see what's happening.</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/switch-city' as never)} activeOpacity={0.85}>
            <Text style={styles.emptyBtnText}>Browse cities</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Apply filter then build flat list data — memoized to avoid recreating arrays on every render.
  const filteredItems = useMemo(() => {
    const base = filter === 'events' ? items.filter(i => i.kind === 'event')
               : filter === 'topics' ? items.filter(i => i.kind === 'topic')
               : items;
    // Recurring events always float to the top — they're city anchors
    return [...base].sort((a, b) => {
      const aRecur = !!(a.series_id ?? a.recurrence_label) ? 1 : 0;
      const bRecur = !!(b.series_id ?? b.recurrence_label) ? 1 : 0;
      return bRecur - aRecur;
    });
  }, [items, filter]);

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
      {/* Persistent app header — bell / logo / DM across all tabs */}
      <View style={styles.appHeaderWrap}>
        <AppHeader />
      </View>

      {/* Tab-specific title (sub-header) */}
      <View style={styles.header}>
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
              {f === 'all' ? 'All' : f === 'events' ? '🔥 Events' : '🗣️ Pulses'}
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
        <FilterEmptyState
          filter={filter}
          city={city?.name}
          userMode={userMode}
          onStartPulse={handleStartPulse}
        />
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

      {/* Sticky bottom action block — web parity (apps/web index.css:5809 + 6056).
          Row: [Start a pulse ⚡] [Host your spot]  then [See what's coming 🔮]
          below it. Absolute so it pins above the bottom tab bar regardless of
          scroll. Safe-area-aware via insets.bottom. */}
      {city && (
        <View style={[styles.bottomActions, { paddingBottom: 10 + insets.bottom }]}>
          <View style={styles.bottomActionsRow}>
            <TouchableOpacity
              style={styles.pulseBtn}
              activeOpacity={0.8}
              onPress={handleStartPulse}
            >
              <Text style={styles.pulseBtnText}>Start a pulse ⚡</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.hostBtn}
              activeOpacity={0.85}
              onPress={handleHostSpot}
            >
              <Text style={styles.hostBtnText}>Host your spot</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.upcomingCta}
            activeOpacity={0.75}
            onPress={handleSeeUpcoming}
          >
            <Text style={styles.upcomingCtaEmoji}>🔮</Text>
            <Text style={styles.upcomingCtaText}>See what's coming</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.accent} />
          </TouchableOpacity>
        </View>
      )}
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
  // Wrapper that frames the shared AppHeader with consistent padding.
  // No borderBottom — header flows directly into the tab sub-header, matching
  // MY CITY's look. Background kept so the header area still reads as a
  // surface strip (bg2), not against the raw screen bg.
  appHeaderWrap: {
    paddingHorizontal: Spacing.md,
    paddingTop:        10,
    paddingBottom:     12,
    backgroundColor:   Colors.bg2,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
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

  // paddingBottom reserves room for the sticky bottomActions block
  // (pulse+host row ≈52 + gap 10 + upcoming ≈48 + padding ≈24 ≈ 140).
  // Safe-area inset is added at render time via contentContainerStyle merge.
  list: { paddingBottom: 160, paddingHorizontal: Spacing.md, gap: Spacing.sm },

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
  cardHost:         { fontSize: FontSizes.xs, color: Colors.muted2, marginTop: 2 },

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

  // ── Recurring event card anchor style ─────────────────────────────────────
  cardRecurring: {
    borderColor: 'rgba(184,114,40,0.35)',
    backgroundColor: 'rgba(184,114,40,0.04)',
  },

  // ── Sticky bottom action block — web parity ────────────────────────────────
  // Absolute-positioned container pinned above the bottom tab bar. Contains
  // the [Start a pulse ⚡] [Host your spot] row and the [See what's coming 🔮]
  // wide button stacked below. Content scroll has matching paddingBottom so
  // the last item isn't hidden under this block.
  bottomActions: {
    position:          'absolute',
    left:              0,
    right:             0,
    bottom:            0,
    paddingHorizontal: Spacing.md,
    paddingTop:        10,
    backgroundColor:   'rgba(14,14,16,0.92)',
    borderTopWidth:    1,
    borderTopColor:    Colors.border,
  },
  bottomActionsRow: {
    flexDirection: 'row',
    gap:           10,
  },

  // Mirrors web .now-pulse-btn (rgba(96,165,250,…) blue tint on dark bg).
  pulseBtn: {
    flex:              1,
    height:            52,
    borderRadius:      18,
    borderWidth:       1,
    borderColor:       'rgba(96,165,250,0.25)',
    backgroundColor:   'rgba(96,165,250,0.10)',
    alignItems:        'center',
    justifyContent:    'center',
  },
  pulseBtnText: {
    color:     '#60a5fa',
    fontSize:  FontSizes.md,
    fontWeight: '700',
  },

  // Mirrors web .now-create-btn--local (#FF7A3C + subtle orange shadow).
  hostBtn: {
    flex:              1,
    height:            52,
    borderRadius:      18,
    backgroundColor:   Colors.accent,
    alignItems:        'center',
    justifyContent:    'center',
    shadowColor:       Colors.accent,
    shadowOffset:      { width: 0, height: 4 },
    shadowOpacity:     0.35,
    shadowRadius:      12,
    elevation:         6,
  },
  hostBtnText: {
    color:     Colors.white,
    fontSize:  FontSizes.md,
    fontWeight: '700',
    letterSpacing: -0.2,
  },

  // Mirrors web .upcoming-cta (orange-tinted wide pill).
  upcomingCta: {
    marginTop:         10,
    backgroundColor:   'rgba(255,122,60,0.07)',
    borderRadius:      16,
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.22)',
    paddingVertical:   14,
    paddingHorizontal: Spacing.md,
    flexDirection:     'row',
    alignItems:        'center',
    gap:               10,
  },
  upcomingCtaEmoji: { fontSize: 20, lineHeight: 24 },
  upcomingCtaText:  { flex: 1, fontSize: FontSizes.md, fontWeight: '700', color: Colors.accent },

  // Centered CTA rendered inside the Pulses filter's empty state (web parity).
  emptyPulseBtn: {
    marginTop:         Spacing.md,
    paddingHorizontal: 22,
    height:            48,
    borderRadius:      16,
    borderWidth:       1,
    borderColor:       'rgba(96,165,250,0.25)',
    backgroundColor:   'rgba(96,165,250,0.10)',
    alignItems:        'center',
    justifyContent:    'center',
  },
  emptyPulseBtnText: {
    color:      '#60a5fa',
    fontSize:   FontSizes.md,
    fontWeight: '700',
  },
});
