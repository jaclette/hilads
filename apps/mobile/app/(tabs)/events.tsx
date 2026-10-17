import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, ScrollView,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import { useApp } from '@/context/AppContext';
import { localizeCityName } from '@/i18n/cityName';
import { fetchNowFeed, fetchHangoutParticipants } from '@/api/topics';
import { haversineMeters, formatDistance } from '@/lib/distance';
import { MembersSheet } from '@/components/MembersSheet';
import { fetchCanCreateEvent, fetchEventParticipants, fetchEventInspiration, type EventInspirationExample } from '@/api/events';
import { ExampleEventCard } from '@/components/ExampleEventCard';
import { socket } from '@/lib/socket';
import { track } from '@/services/analytics';
import type { FeedItem, HiladsEvent, UserDTO } from '@/types';
import { Border, FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Button, EmptyState, Screen, ScreenHeader, SectionTitle } from '@/ui';
import { EventCard } from '@/components/EventCard';
import { TopicCard } from '@/components/TopicCard';

// ── Empty state ───────────────────────────────────────────────────────────────
// Locals are invited to host a recurring spot; everyone else to start a plan.

function FeedEmptyState({ city, userMode }: { city?: string; userMode?: string | null }) {
  const { t } = useTranslation('now');
  if (userMode === 'local') {
    return (
      <EmptyState
        icon="storefront-outline"
        title={t('hostSpotTitle')}
        body={`${city ? t('hostSpotCity', { city }) : t('hostSpotNoCity')}\n${t('hostSpotLine')}`}
      />
    );
  }
  return (
    <EmptyState
      icon="calendar-outline"
      title={t('noEvents')}
      body={city ? t('beFirstEventCity', { city }) : t('beFirstEvent')}
    />
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
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const router = useRouter();
  const { t } = useTranslation('now');
  // Measured height of the sticky bottom CTA bar (Hi now / Hi plan). The list reserves exactly this much so the
  // last event never hides behind it. Sensible default until first layout.
  const [bottomBarH, setBottomBarH] = useState(130);
  const { city, identity, account, booting, blockedSet } = useApp();
  const userMode = account?.mode ?? identity?.mode ?? null;

  const [items,         setItems]         = useState<FeedItem[]>([]);
  const [publicEvents,  setPublicEvents]  = useState<FeedItem[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  // Inspiration ("idea book") for the zero-activity empty state. Fetched lazily
  // only once the feed has loaded empty, so active cities never pay for it.
  const [eventInspiration,     setEventInspiration]     = useState<EventInspirationExample[]>([]);
  const [eventInspirationCity, setEventInspirationCity] = useState<string | null>(null);
  const inspirationTriedRef = useRef(false);
  // Viewer coords for NOW distance display. Read ONCE from the OS cache on load /
  // pull-to-refresh (getLastKnownPositionAsync - no watcher, no permission prompt;
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

  // ── NOW action-block handlers - web parity (apps/web/App.jsx:3950+). ────
  // Topics (pulses) have no 1/day rule, so Start-a-pulse pushes directly.
  // Events go through the fetchCanCreateEvent preflight landed in commit
  // e0274e4; server still enforces the limit on POST.
  function handleStartPulse() {
    if (!account) { router.push('/auth-gate?reason=create_hangout'); return; }
    router.push('/topic/create');
  }
  async function handleHostSpot() {
    if (!city) return;
    try {
      const r = await fetchCanCreateEvent(city.channelId, identity?.guestId);
      if (!r.canCreate) { router.push('/event/limit-reached' as never); return; }
    } catch { /* optimistic open - server safety net catches the race */ }
    router.push('/event/create');
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

  // Track the city we last loaded for - reset the 30s guard on city change.
  const loadedCityRef = useRef<string | undefined>(undefined);

  async function load(isRefresh = false) {
    if (!city) {
      // Don't set loading=false here - keep showing the spinner while app boots.
      // The city will arrive shortly for returning users; for fresh users the
      // booting/joined state drives the "no city" render below.
      console.log('[NowScreen] load() skipped - city not yet available');
      return;
    }

    // Reset the freshness guard whenever the city changes so we always fetch on switch.
    if (loadedCityRef.current !== city.channelId) {
      lastLoadAtRef.current = 0;
      loadedCityRef.current = city.channelId;
    }

    // Skip if already in-flight or data is fresh - unless it's a manual pull-to-refresh.
    if (!isRefresh && (loadingRef.current || Date.now() - lastLoadAtRef.current < 30_000)) {
      console.log('[NowScreen] load() skipped - in-flight or data fresh', { inFlight: loadingRef.current, age: Date.now() - lastLoadAtRef.current });
      return;
    }

    console.log('[NowScreen] fetch start -', city.name, city.channelId);
    loadingRef.current = true;
    lastLoadAtRef.current = Date.now();
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const { items: nowData, publicEvents: pubData } = await fetchNowFeed(city.channelId, identity?.guestId);
      console.log('[NowScreen] fetch done -', nowData.length, 'items,', pubData.length, 'public events');
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
    console.log('[NowScreen] focus -', city?.name ?? 'no city');
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

  // New event created in this city - server pushes new_event via WS.
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

  // New topic created in this city - append card directly from WS payload.
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
  // ABOVE the early returns below - otherwise when `city` flips null→set the
  // hook count changes and React throws "Rendered more hooks than during the
  // previous render." (They depend only on items/filter/blockedSet/publicEvents,
  // all defined regardless of city, so they're safe to compute even with no city.)
  // Distance (meters) per item from the viewer - computed ONCE per [items,
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
    // Hi Local → both temporalities: events ("Later") + topics/hangouts ("Now").
    // fetchNowFeed returns only events + topics, so no kind filter is needed.
    const base = items;
    // Block filter (Apple G1.2) - drop events / topics whose host or creator
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
    // recurring events float to the top - they're city anchors. Stable sort
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
  }, [items, blockedSet, distanceById]);

  const listData = useMemo<Array<
    FeedItem
    | { kind: 'section'; label: string }
    | (HiladsEvent & { kind: 'public_event' })
  >>(
    () => {
      const showPublic = publicEvents.length > 0;
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
              { kind: 'section' as const, label: t('publicEventsSection', { ns: 'common' }) },
              ...sortedPublic.map(e => ({ ...e, kind: 'public_event' as const }) as HiladsEvent & { kind: 'public_event' }),
            ]
          : []),
      ];
    },
    [filteredItems, publicEvents, distanceById, t],
  );

  // Inspiration "idea book" for the genuine zero-activity empty state. Re-armed
  // on city change; fetched lazily only once the feed has loaded empty.
  useEffect(() => {
    inspirationTriedRef.current = false;
    setEventInspiration([]);
    setEventInspirationCity(null);
  }, [city?.channelId]);

  useEffect(() => {
    if (loading || error || listData.length > 0 || !city?.channelId) return;
    if (inspirationTriedRef.current) return;
    inspirationTriedRef.current = true;
    let alive = true;
    fetchEventInspiration(String(city.channelId)).then(r => {
      if (!alive) return;
      setEventInspiration(r.examples);
      setEventInspirationCity(r.city);
    });
    return () => { alive = false; };
  }, [loading, error, listData.length, city?.channelId]);

  const header = (
    <ScreenHeader
      title={t('hiNow')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/chat' as never))}
      right={city ? <Text style={styles.headerSub} numberOfLines={1}>{localizeCityName(city.name)}</Text> : undefined}
    />
  );

  // Still booting or waiting for city - keep showing spinner.
  if (!city && (booting || loading)) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </Screen>
    );
  }

  // Boot finished but user has no city.
  if (!city && !booting && !loading) {
    return (
      <Screen>
        {header}
        <View style={styles.center}>
          <EmptyState
            icon="globe-outline"
            title={t('noCityTitle')}
            body={t('noCitySub')}
            action={<Button label={t('browseCities')} onPress={() => router.push('/switch-city' as never)} />}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      {header}

      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <EmptyState
            icon="cloud-offline-outline"
            body={error}
            action={<Button variant="secondary" size="sm" label={t('retry', { ns: 'common' })} onPress={() => load()} />}
          />
        </View>
      ) : listData.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyScroll}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { readUserLocation(); load(true); }} tintColor={colors.primary} />
          }
        >
          {/* Local hero stays on top, dominant. */}
          <FeedEmptyState city={localizeCityName(city?.name)} userMode={userMode} />

          {/* Inspiration "idea book" - inert example hangouts/events from the
              most-active other city. NOT joinable: each card's only action
              routes back to LOCAL creation. Renders nothing when empty. */}
          {eventInspiration.length > 0 && (
            <View style={styles.inspirationBlock}>
              <SectionTitle title={t('inspiration.heading')} />
              <Text style={styles.inspirationSub}>{t('inspiration.sub')}</Text>
              {eventInspiration.map((ex, i) => (
                <ExampleEventCard
                  key={`${ex.id}-${i}`}
                  example={ex}
                  sourceCity={eventInspirationCity ?? ''}
                  currentCity={localizeCityName(city?.name) ?? (city?.name ?? '')}
                  onOpen={() => router.push(`/${ex.kind === 'hangout' ? 'topic' : 'event'}/${ex.id}` as never)}
                  onCreate={() => router.push('/event/create' as never)}
                />
              ))}
            </View>
          )}
        </ScrollView>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item, idx) => ('id' in item ? item.id : `section-${idx}`)}
          removeClippedSubviews
          maxToRenderPerBatch={6}
          windowSize={5}
          renderItem={({ item }) => {
            if (item.kind === 'section') {
              return <SectionTitle title={item.label} style={styles.sectionLabel} />;
            }
            if (item.kind === 'topic') {
              const topicMeters = distanceById.get(item.id);
              return (
                <TopicCard
                  topic={item as FeedItem & { kind: 'topic' }}
                  isHost={
                    (!!(item as FeedItem).created_by && (item as FeedItem).created_by === account?.id)
                    || (!!(item as FeedItem).guest_id && (item as FeedItem).guest_id === identity?.guestId)
                  }
                  distanceLabel={topicMeters !== undefined ? formatDistance(topicMeters) : undefined}
                  onAvatarsPress={() => openMembers('topic', item.id, (item as FeedItem).participant_count ?? 0)}
                  onPress={() => {
                    // Hangouts are members-only - send guests to signup with
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
            // event or public_event - map FeedItem to HiladsEvent shape for EventCard
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
          contentContainerStyle={[styles.list, { paddingBottom: bottomBarH + Spacing.sm }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { readUserLocation(); load(true); }} tintColor={colors.primary} />
          }
        />
      )}

      {/* Two create CTAs: "Hi now" (spontaneous hangout) and "Hi plan" (planned event). */}
      {city && (
        <View style={styles.bottomActions} onLayout={(e) => setBottomBarH(e.nativeEvent.layout.height)}>
          <Button icon="flash-outline" label={t('hiNow')} onPress={handleStartPulse} />
          <Button variant="secondary" icon="calendar-outline" label={t('hiLater')} onPress={handleHostSpot} />
        </View>
      )}

      <MembersSheet
        visible={membersOpen}
        loading={membersLoading}
        participants={membersList}
        count={membersCount}
        noun={membersNoun}
        onClose={() => setMembersOpen(false)}
        onSelect={(uid) => { setMembersOpen(false); router.push({ pathname: '/user/[id]', params: { id: uid } }); }}
      />
    </Screen>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  headerSub:    { maxWidth: 160, fontSize: FontSizes.xs, fontWeight: '600', color: c.muted },
  center:       { flex: 1, justifyContent: 'center', padding: Spacing.lg },
  sectionLabel: { paddingTop: Spacing.md, paddingBottom: 4 },
  list:         { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, gap: 10 },

  emptyScroll:      { flexGrow: 1, paddingTop: Spacing.lg, paddingBottom: Spacing.xl },
  inspirationBlock: { paddingHorizontal: Spacing.md, gap: Spacing.sm, marginTop: Spacing.md },
  inspirationSub:   { fontSize: 12, fontWeight: '600', color: c.muted, marginBottom: 2 },

  // Sticky bottom block, pinned above the tab bar: Hi now (primary) over Hi plan.
  bottomActions: {
    position:          'absolute',
    left:              0,
    right:             0,
    bottom:            0,
    gap:               8,
    paddingHorizontal: Spacing.md,
    paddingVertical:   10,
    backgroundColor:   c.bg,
    borderTopWidth:    Border,
    borderTopColor:    c.line,
  },
});
