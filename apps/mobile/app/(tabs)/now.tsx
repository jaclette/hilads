import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  ActivityIndicator, TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useApp } from '@/context/AppContext';
import { localizeCityName } from '@/i18n/cityName';
import { fetchNowFeed, fetchHangoutParticipants } from '@/api/topics';
import { haversineMeters, formatDistance } from '@/lib/distance';
import { MembersSheet } from '@/components/MembersSheet';
import { fetchCanCreateEvent, fetchEventParticipants } from '@/api/events';
import { socket } from '@/lib/socket';
import { track } from '@/services/analytics';
import type { FeedItem, HiladsEvent, UserDTO } from '@/types';
import { Colors, FontSizes, Spacing, Radius, Gradients, Shadows } from '@/constants';
import { AppHeader } from '@/features/shell/AppHeader';
import { CreateSheet } from '@/components/CreateSheet';
import { EventCard } from '@/components/EventCard';
import { TopicCard } from '@/components/TopicCard';
import { LinearGradient } from 'expo-linear-gradient';

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ city }: { city?: string }) {
  const { t } = useTranslation('now');
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>✨</Text>
      <Text style={styles.emptyTitle}>{t('emptyTitle')}</Text>
      <Text style={styles.emptySub}>
        {city ? t('emptyBeFirst', { city }) : t('emptyStartNow')}
        {'\n'}{t('emptyCreateLine')}
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
  const { t } = useTranslation('now');
  if (filter === 'all') return <EmptyState city={city} />;
  if (filter === 'events' && userMode === 'local') {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyEmoji}>🌍</Text>
        <Text style={styles.emptyTitle}>{t('hostSpotTitle')}</Text>
        <Text style={styles.emptySub}>
          {city ? t('hostSpotCity', { city }) : t('hostSpotNoCity')}{'\n'}{t('hostSpotLine')}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>{filter === 'events' ? '🔥' : '🗣️'}</Text>
      <Text style={styles.emptyTitle}>
        {filter === 'events' ? t('noEvents') : t('noHangouts')}
      </Text>
      <Text style={styles.emptySub}>
        {filter === 'events'
          ? (city ? t('beFirstEventCity', { city }) : t('beFirstEvent'))
          : t('hangoutTalk')}
      </Text>

      {/* Pulse-filter-only CTA — mirrors web's centered blue "Start a pulse ⚡"
          button in the empty state (apps/web App.jsx ~3884). */}
      {filter === 'topics' && onStartPulse && (
        <TouchableOpacity
          style={styles.emptyPulseBtn}
          onPress={onStartPulse}
          activeOpacity={0.8}
        >
          <Text style={styles.emptyPulseBtnText}>{t('startHangout')}</Text>
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
  const { t } = useTranslation('now');
  const { city, identity, account, booting, blockedSet } = useApp();
  const userMode = account?.mode ?? identity?.mode ?? null;

  const [items,         setItems]         = useState<FeedItem[]>([]);
  const [publicEvents,  setPublicEvents]  = useState<FeedItem[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [filter,        setFilter]        = useState<'all' | 'events' | 'topics'>('all');
  // Viewer coords for NOW distance display. Read ONCE from the OS cache on load /
  // pull-to-refresh (getLastKnownPositionAsync — no watcher, no permission prompt;
  // permission was already requested at boot). null → no usable location → cards
  // fall back to showing the address and the default ordering.
  const [userLocation,  setUserLocation]  = useState<{ lat: number; lng: number } | null>(null);

  // Members list opened by tapping the attendee-avatar row on a NOW card.
  const [membersOpen,    setMembersOpen]    = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersList,    setMembersList]    = useState<UserDTO[]>([]);
  const [membersCount,   setMembersCount]   = useState(0);
  const [membersNoun,    setMembersNoun]    = useState('going');

  const openMembers = useCallback(async (kind: 'event' | 'topic', itemId: string, total: number) => {
    setMembersOpen(true);
    setMembersLoading(true);
    setMembersList([]);
    setMembersCount(total);
    setMembersNoun(kind === 'topic' ? t('inThisHangout') : t('going'));
    try {
      const data = kind === 'topic'
        ? await fetchHangoutParticipants(itemId)
        : await fetchEventParticipants(itemId);
      setMembersList(data.participants ?? []);
      setMembersCount(data.count ?? (data.participants?.length ?? total));
    } catch {
      // leave empty
    } finally {
      setMembersLoading(false);
    }
  }, [t]);

  const readUserLocation = useCallback(async () => {
    try {
      // getForegroundPermissionsAsync just reads status (no prompt). If location
      // is disabled/denied, clear coords so cards fall back to the address.
      const { granted } = await Location.getForegroundPermissionsAsync();
      if (!granted) { setUserLocation(null); return; }
      const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 });
      // Keep the prior fix if granted-but-no-cache (avoids a distance→address flicker).
      if (last) setUserLocation({ lat: last.coords.latitude, lng: last.coords.longitude });
    } catch {
      setUserLocation(null);
    }
  }, []);

  // ── NOW action-block handlers — web parity (apps/web/App.jsx:3950+). ────
  // Topics (pulses) have no 1/day rule, so Start-a-pulse pushes directly.
  // Events go through the fetchCanCreateEvent preflight landed in commit
  // e0274e4; server still enforces the limit on POST.
  // Both creation flows now flow through the CreateSheet picker (one + button
  // instead of two side-by-side CTAs). Routing + analytics are unchanged.
  const [showCreateSheet, setShowCreateSheet] = useState(false);

  function handleStartPulse() {
    if (!account) { router.push('/auth-gate?reason=create_hangout'); return; }
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
  function handleSeePast() {
    if (!city) return;
    track('past_archive_opened', { channelId: city.channelId });
    router.push(
      `/past?channelId=${city.channelId}&timezone=${encodeURIComponent(city.timezone ?? 'UTC')}&city=${encodeURIComponent(city.name ?? '')}`,
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
      setError(t('loadError'));
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }

  // Primary trigger: runs when screen gains focus or city changes.
  useFocusEffect(useCallback(() => {
    console.log('[NowScreen] focus —', city?.name ?? 'no city');
    readUserLocation();
    load();
  }, [city?.channelId, readUserLocation]));

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
          recurrence_type:  (ev.recurrence_type ?? null) as 'daily' | 'weekly' | 'every_n_days' | null,
          recurrence_weekdays: (ev.recurrence_weekdays ?? []) as number[],
          recurrence_interval: (ev.recurrence_interval ?? null) as number | null,
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

  // Filter + flat-list memos. These MUST run on every render, so they live
  // ABOVE the early returns below — otherwise when `city` flips null→set the
  // hook count changes and React throws "Rendered more hooks than during the
  // previous render." (They depend only on items/filter/blockedSet/publicEvents,
  // all defined regardless of city, so they're safe to compute even with no city.)
  // Distance (meters) per item from the viewer — computed ONCE per [items,
  // userLocation] change, not per render. Only items with coords + a known
  // viewer location get an entry; everything else is "no distance".
  const distanceById = useMemo(() => {
    const map = new Map<string, number>();
    if (!userLocation) return map;
    for (const it of [...items, ...publicEvents]) {
      const lat = (it as FeedItem).venue_lat;
      const lng = (it as FeedItem).venue_lng;
      if (typeof lat === 'number' && typeof lng === 'number') {
        map.set(it.id, haversineMeters(userLocation.lat, userLocation.lng, lat, lng));
      }
    }
    return map;
  }, [items, publicEvents, userLocation]);

  const filteredItems = useMemo(() => {
    const base = filter === 'events' ? items.filter(i => i.kind === 'event')
               : filter === 'topics' ? items.filter(i => i.kind === 'topic')
               : items;
    // Block filter (Apple G1.2) — drop events / topics whose host or creator
    // the viewer has blocked. Public Ticketmaster events have no human host
    // so they're filtered separately below.
    const userBlocked  = blockedSet.userIds;
    const guestBlocked = blockedSet.guestIds;
    const visible = (userBlocked.size === 0 && guestBlocked.size === 0)
      ? base
      : base.filter(item => {
          const uid = (item as { user_id?: string | null }).user_id  ?? null;
          const gid = (item as { guest_id?: string | null }).guest_id ?? null;
          if (uid && userBlocked.has(uid))  return false;
          if (gid && guestBlocked.has(gid)) return false;
          return true;
        });
    // Hangouts (topics) take priority over events. Within each group, when the
    // viewer's location is known, sort nearest → farthest; items without coords
    // sort after the located ones. With no location (or as a tiebreaker),
    // recurring events float to the top — they're city anchors. Stable sort
    // preserves the feed's underlying activity order otherwise.
    return [...visible].sort((a, b) => {
      const aTopic = a.kind === 'topic' ? 1 : 0;
      const bTopic = b.kind === 'topic' ? 1 : 0;
      if (aTopic !== bTopic) return bTopic - aTopic;
      const aDist = distanceById.get(a.id);
      const bDist = distanceById.get(b.id);
      const aHas  = aDist !== undefined;
      const bHas  = bDist !== undefined;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (aHas && bHas && aDist !== bDist) return aDist! - bDist!;
      const aRecur = !!(a.series_id ?? a.recurrence_label) ? 1 : 0;
      const bRecur = !!(b.series_id ?? b.recurrence_label) ? 1 : 0;
      return bRecur - aRecur;
    });
  }, [items, filter, blockedSet, distanceById]);

  const listData = useMemo<Array<FeedItem | { kind: 'section'; label: string } | (HiladsEvent & { kind: 'public_event' })>>(
    () => {
      const showPublic = filter !== 'topics' && publicEvents.length > 0;
      // Public events are distance-sorted within their section too (nearest →
      // farthest; no-coord last), consistent with the main feed.
      const sortedPublic = [...publicEvents].sort((a, b) => {
        const aDist = distanceById.get(a.id);
        const bDist = distanceById.get(b.id);
        const aHas = aDist !== undefined;
        const bHas = bDist !== undefined;
        if (aHas !== bHas) return aHas ? -1 : 1;
        if (aHas && bHas && aDist !== bDist) return aDist! - bDist!;
        return 0;
      });
      return [
        ...filteredItems,
        ...(showPublic
          ? [
              { kind: 'section' as const, label: '🎫 Public Events' },
              ...sortedPublic.map(e => ({ ...e, kind: 'public_event' as const })),
            ]
          : []),
      ];
    },
    [filteredItems, publicEvents, filter, distanceById],
  );

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
          <Text style={styles.emptyTitle}>{t('noCityTitle')}</Text>
          <Text style={styles.emptySub}>{t('noCitySub')}</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/switch-city' as never)} activeOpacity={0.85}>
            <Text style={styles.emptyBtnText}>{t('browseCities')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

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
          {city && <Text style={styles.headerSub}>{localizeCityName(city.name)}</Text>}
        </View>
      </View>

      {/* Filter pills */}
      <View style={styles.filterBar}>
        {(['all', 'topics', 'events'] as const).map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterPill, filter === f && styles.filterPillActive]}
            onPress={() => setFilter(f)}
            activeOpacity={0.75}
          >
            <Text style={[styles.filterPillText, filter === f && styles.filterPillTextActive]}>
              {f === 'all' ? t('filterAll') : f === 'events' ? '🔥 Events' : '🗣️ Hangouts'}
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
            <Text style={styles.retryText}>{t('retry', { ns: 'common' })}</Text>
          </TouchableOpacity>
        </View>
      ) : listData.length === 0 ? (
        <FilterEmptyState
          filter={filter}
          city={localizeCityName(city?.name)}
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
              const topicMeters = distanceById.get(item.id);
              return (
                <TopicCard
                  topic={item as FeedItem & { kind: 'topic' }}
                  distanceLabel={topicMeters !== undefined ? formatDistance(topicMeters) : undefined}
                  onAvatarsPress={() => openMembers('topic', item.id, (item as FeedItem).participant_count ?? 0)}
                  onPress={() => {
                    // Hangouts are members-only — send guests to signup with
                    // the join value-prop instead of opening the channel.
                    if (!account) {
                      router.push('/auth-gate?reason=join_hangout' as never);
                      return;
                    }
                    track('topic_opened', { topicId: item.id });
                    router.push(`/topic/${item.id}`);
                  }}
                />
              );
            }
            // event or public_event — map FeedItem to HiladsEvent shape for EventCard
            const event = item as HiladsEvent;
            const meters = distanceById.get(event.id);
            return (
              <EventCard
                event={event}
                tz={city?.timezone ?? undefined}
                showDay
                distanceLabel={meters !== undefined ? formatDistance(meters) : undefined}
                onAvatarsPress={item.kind === 'public_event' ? undefined : () => openMembers('event', event.id, event.participant_count ?? 0)}
                onPress={() => {
                  track('event_opened', { eventId: event.id });
                  router.push(`/event/${event.id}`);
                }}
              />
            );
          }}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { readUserLocation(); load(true); }} tintColor={Colors.accent} />
          }
        />
      )}

      {/* Sticky bottom action — single horizontal row pinned above the tab bar.
          [ See what's coming 🔮 ─────────────────────────── ] [+]
          The + opens CreateSheet which picks between Create an event / Share a moment
          (preserves both routes + analytics). Safe-area-aware via insets.bottom. */}
      {city && (
        <View style={[styles.bottomActions, { paddingBottom: 10 + insets.bottom }]}>
          <View style={styles.bottomActionsRow}>
            <TouchableOpacity
              style={styles.upcomingCta}
              activeOpacity={0.75}
              onPress={handleSeeUpcoming}
            >
              <Text style={styles.upcomingCtaEmoji}>🔮</Text>
              <Text style={styles.upcomingCtaText} numberOfLines={1}>{t('seeComing')}</Text>
              <Ionicons name="chevron-forward" size={16} color={Colors.accent} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.createFab}
              activeOpacity={0.85}
              onPress={() => setShowCreateSheet(true)}
              accessibilityLabel={t('createNew')}
              accessibilityRole="button"
            >
              <LinearGradient
                colors={Gradients.primary.colors}
                start={Gradients.primary.start}
                end={Gradients.primary.end}
                style={styles.createFabGradient}
              />
              <Ionicons name="add" size={28} color={Colors.white} />
            </TouchableOpacity>
          </View>
          {/* Discreet archive entry — muted text link under the upcoming pill. */}
          <TouchableOpacity
            style={styles.pastLink}
            activeOpacity={0.6}
            onPress={handleSeePast}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.pastLinkText}>{t('seeHappened')}</Text>
          </TouchableOpacity>
        </View>
      )}

      <CreateSheet
        visible={showCreateSheet}
        onClose={() => setShowCreateSheet(false)}
        onSelectEvent={handleHostSpot}
        onSelectTopic={handleStartPulse}
      />

      <MembersSheet
        visible={membersOpen}
        loading={membersLoading}
        participants={membersList}
        count={membersCount}
        noun={membersNoun}
        onClose={() => setMembersOpen(false)}
        onSelect={(uid) => { setMembersOpen(false); router.push({ pathname: '/user/[id]', params: { id: uid } }); }}
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

  // paddingBottom reserves room for the sticky single-row bottomActions block
  // (one row of ~56px + safe-area). Smaller than before since we collapsed
  // the two-row layout into one.
  list: { paddingBottom: 96, paddingHorizontal: Spacing.md, gap: 6 },

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

  // ── Sticky bottom action block — single-row layout ─────────────────────────
  // Absolute-positioned container pinned above the bottom tab bar. One row:
  // [ See what's coming 🔮 ] flex-1, and [+] 48×48 circle on the right that
  // opens the CreateSheet picker.
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
    alignItems:    'center',
    gap:           10,
  },

  // Wide pill on the left — orange-tinted, mirrors web .upcoming-cta.
  upcomingCta: {
    flex:              1,
    backgroundColor:   'rgba(255,122,60,0.07)',
    borderRadius:      16,
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.22)',
    paddingVertical:   12,
    paddingHorizontal: Spacing.md,
    flexDirection:     'row',
    alignItems:        'center',
    gap:               10,
    minHeight:         48,  // ≥44 tap target
  },
  upcomingCtaEmoji: { fontSize: 18, lineHeight: 22 },
  upcomingCtaText:  { flex: 1, fontSize: FontSizes.md, fontWeight: '700', color: Colors.accent },

  // Discreet archive entry — muted, left-aligned under the upcoming pill.
  pastLink:     { alignSelf: 'flex-start', paddingTop: 6, paddingBottom: 2 },
  pastLinkText: { fontSize: FontSizes.sm, color: Colors.muted, fontWeight: '500' },

  // Circular + button on the right — opens CreateSheet picker. Background is a
  // 135° orange gradient (LinearGradient absolute child); shadow uses the
  // shared FAB token for the colored glow.
  createFab: {
    width:           48,
    height:          48,
    borderRadius:    24,
    alignItems:      'center',
    justifyContent:  'center',
    overflow:        'hidden',
    flexShrink:      0,
    ...Shadows.fab,
    shadowRadius:    12,   // smaller surface than the in-chat send FAB → tighter glow
    shadowOpacity:   0.35,
  },
  createFabGradient: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
  },

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
