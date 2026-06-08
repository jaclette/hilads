import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, ScrollView,
  ActivityIndicator, TouchableOpacity, RefreshControl,
  type ViewToken,
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
import { fetchCityChallenges } from '@/api/challenges';
import { socket } from '@/lib/socket';
import { track } from '@/services/analytics';
import { canAccessProfile } from '@/lib/profileAccess';
import { ScoringInfoButton } from '@/components/ScoringInfoButton';
import type { FeedItem, HiladsEvent, UserDTO, Challenge } from '@/types';
import { Colors, FontSizes, Spacing, Radius, Gradients, Shadows } from '@/constants';
import { AppHeader } from '@/features/shell/AppHeader';
import { CreateSheet } from '@/components/CreateSheet';
import { EventCard } from '@/components/EventCard';
import { TopicCard } from '@/components/TopicCard';
import { ChallengeVersusCard } from '@/components/ChallengeVersusCard';
import { LinearGradient } from 'expo-linear-gradient';

// Cap the inline challenge strip shown on NOW. The full list lives at
// /challenge/all behind the "See all" CTA. Spec: "Show maximum 5 défis,
// sorted by most recent."
const NOW_CHALLENGES_CAP = 5;

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
  filter:        'all' | 'challenges' | 'events' | 'topics';
  city?:         string;
  userMode?:     string | null;
  onStartPulse?: () => void;
}) {
  const { t } = useTranslation('now');
  if (filter === 'all') return <EmptyState city={city} />;
  if (filter === 'challenges') {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyEmoji}>🔥</Text>
        <Text style={styles.emptyTitle}>{t('noChallenges')}</Text>
        <Text style={styles.emptySub}>
          {city ? t('noChallengesCity', { city }) : t('noChallengesGeneric')}
        </Text>
      </View>
    );
  }
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
      <Text style={styles.emptyEmoji}>{filter === 'events' ? '🎉' : '🗣️'}</Text>
      <Text style={styles.emptyTitle}>
        {filter === 'events' ? t('noEvents') : t('noHangouts')}
      </Text>
      <Text style={styles.emptySub}>
        {filter === 'events'
          ? (city ? t('beFirstEventCity', { city }) : t('beFirstEvent'))
          : t('hangoutTalk')}
      </Text>

      {/* Pulse-filter-only CTA - mirrors web's centered blue "Start a pulse 🗣️"
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
  const [challenges,    setChallenges]    = useState<Challenge[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [filter,        setFilter]        = useState<'all' | 'challenges' | 'events' | 'topics'>('all');
  // Set of currently-visible challenge ids — drives the open-slot pulse
  // animation on ChallengeVersusCard. Updated by FlatList's
  // onViewableItemsChanged so off-screen cards stop redrawing and entry-
  // level Android doesn't burn battery on a long scroll. The ref keeps
  // the latest viewability config stable across re-renders (RN errors if
  // it changes between renders).
  const [visibleChallengeIds, setVisibleChallengeIds] = useState<Set<string>>(() => new Set());
  const viewabilityConfigRef = useRef({ itemVisiblePercentThreshold: 10 });
  const onViewableItemsChangedRef = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const next = new Set<string>();
    for (const v of viewableItems) {
      const item = v.item as { kind?: string; challenge?: { id?: string } } | null;
      if (item?.kind === 'challenge' && item.challenge?.id) {
        next.add(item.challenge.id);
      }
    }
    setVisibleChallengeIds(next);
  });
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
  // Both creation flows now flow through the CreateSheet picker (one + button
  // instead of two side-by-side CTAs). Routing + analytics are unchanged.
  const [showCreateSheet, setShowCreateSheet] = useState(false);

  function handleStartPulse() {
    if (!account) { router.push('/auth-gate?reason=create_hangout'); return; }
    router.push('/topic/create');
  }
  function handleCreateChallenge() {
    // Challenges allow guests (mirrors events, not hangouts). Server enforces
    // the 5/hour rate limit per city. `as never` because expo-router's typed
    // routes haven't picked up the new app/challenge/create.tsx yet.
    router.push('/challenge/create' as never);
  }
  function handleSeeAllChallenges() {
    if (!city) return;
    router.push(`/challenge/all?channelId=${city.channelId}` as never);
  }
  async function handleHostSpot() {
    if (!city) return;
    try {
      const r = await fetchCanCreateEvent(city.channelId, identity?.guestId);
      if (!r.canCreate) { router.push('/event/limit-reached' as never); return; }
    } catch { /* optimistic open - server safety net catches the race */ }
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
      // Parallel - challenges are a sibling fetch (no backend change needed to
      // unify /now). Failure of either is non-fatal; the other section still
      // renders. fetchCityChallenges already catches + returns [] on failure.
      const [{ items: nowData, publicEvents: pubData }, chData] = await Promise.all([
        fetchNowFeed(city.channelId, identity?.guestId),
        fetchCityChallenges(city.channelId, 50),
      ]);
      console.log('[NowScreen] fetch done -', nowData.length, 'items,', pubData.length, 'public events,', chData.length, 'challenges');
      setItems(applyCountCache(nowData));
      setPublicEvents(pubData);
      setChallenges(chData);
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

  // New challenge created in this city - server pushes new_challenge via WS.
  // Append at the head of the local list (backend sorts by created_at DESC so
  // a fresh one is always first). Same defensive city-room match as events.
  useEffect(() => {
    const off = socket.on('new_challenge', (data: Record<string, unknown>) => {
      const ch = data.challenge as Challenge | undefined;
      if (!ch?.id || !city || String(data.channelId) !== String(city.channelId)) return;
      setChallenges(prev => prev.some(c => c.id === ch.id) ? prev : [ch, ...prev]);
    });
    return off;
  }, [city]);

  // Challenge validated by its creator - flip the badge live + remove from the
  // active strip (the See-all-past screen picks it up via its own fetch).
  useEffect(() => {
    const off = socket.on('challenge_validated', (data: Record<string, unknown>) => {
      const ch = data.challenge as Challenge | undefined;
      if (!ch?.id || !city || String(data.channelId) !== String(city.channelId)) return;
      // Validated challenges leave the active feed but the channel still
      // exists - when we ship the detail screen in Phase 5 the user can still
      // open the chat. Here we just drop them from the strip.
      setChallenges(prev => prev.filter(c => c.id !== ch.id));
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
    // 'challenges' filter hides events + hangouts entirely - the strip below
    // is the only section in that mode.
    if (filter === 'challenges') return [];
    const base = filter === 'events' ? items.filter(i => i.kind === 'event')
               : filter === 'topics' ? items.filter(i => i.kind === 'topic')
               : items;
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
  }, [items, filter, blockedSet, distanceById]);

  // Top 5 challenges for the inline strip (open status, most-recent first -
  // backend already sorts). Both 'all' and 'challenges' filters surface them.
  const topChallenges = useMemo(
    () => (filter === 'events' || filter === 'topics' ? [] : challenges.slice(0, NOW_CHALLENGES_CAP)),
    [challenges, filter],
  );

  // Note: see_all_challenges carries an explicit `label?: undefined` to keep
  // TS's array-literal type inference aligned with the section/see_all rows.
  // Without it, the discriminated union inference adds it implicitly and
  // mismatches the explicit annotation.
  const listData = useMemo<Array<
    FeedItem
    | { kind: 'section'; label: string }
    | { kind: 'challenge'; challenge: Challenge }
    | { kind: 'see_all_challenges'; label?: undefined }
    | (HiladsEvent & { kind: 'public_event' })
  >>(
    () => {
      const showPublic = filter !== 'topics' && filter !== 'challenges' && publicEvents.length > 0;
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
      const challengesBlock = topChallenges.length > 0
        ? [
            { kind: 'section' as const, label: t('challengesSection') },
            ...topChallenges.map(c => ({ kind: 'challenge' as const, challenge: c })),
            // See-all CTA only when there are more challenges than the cap.
            ...(challenges.length > NOW_CHALLENGES_CAP
              ? [{ kind: 'see_all_challenges' as const }]
              : []),
          ]
        : [];
      return [
        ...challengesBlock,
        ...filteredItems,
        ...(showPublic
          ? [
              { kind: 'section' as const, label: t('publicEventsSection', { ns: 'common' }) },
              ...sortedPublic.map(e => ({ ...e, kind: 'public_event' as const })),
            ]
          : []),
      ];
    },
    [filteredItems, topChallenges, challenges.length, publicEvents, filter, distanceById, t],
  );

  // Still booting or waiting for city - keep showing spinner.
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
            <Text style={styles.headerTitle}>{t('nowTitle', { ns: 'common' })}</Text>
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
      {/* Persistent app header - bell / logo / DM across all tabs */}
      <View style={styles.appHeaderWrap}>
        <AppHeader />
      </View>

      {/* Tab-specific title (sub-header) */}
      <View style={styles.header}>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('nowTitle', { ns: 'common' })}</Text>
          {city && <Text style={styles.headerSub}>{localizeCityName(city.name)}</Text>}
        </View>
      </View>

      {/* Filter pills - order: All → Challenges (new primary) → Hangouts → Events.
          Spec: "Défi filter chip placed before Sortie and Événements".
          Horizontally scrollable so longer locale labels (e.g. "Mga Challenge")
          or future filters never clip on narrow screens. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterBar}
        contentContainerStyle={styles.filterBarContent}
      >
        {(['all', 'challenges', 'topics', 'events'] as const).map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterPill, filter === f && styles.filterPillActive]}
            onPress={() => setFilter(f)}
            activeOpacity={0.75}
          >
            <Text style={[styles.filterPillText, filter === f && styles.filterPillTextActive]}>
              {f === 'all'        ? t('filterAll')
                : f === 'challenges' ? t('filterChallenges')
                : f === 'events'     ? t('filterEvents', { ns: 'common' })
                :                      t('filterHangouts', { ns: 'common' })}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

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
          keyExtractor={(item, idx) =>
            item.kind === 'challenge'           ? `challenge-${item.challenge.id}`
              : item.kind === 'see_all_challenges' ? `see-all-challenges-${idx}`
              : 'id' in item                       ? item.id
              :                                      `section-${idx}`}
          removeClippedSubviews
          maxToRenderPerBatch={6}
          windowSize={5}
          viewabilityConfig={viewabilityConfigRef.current}
          onViewableItemsChanged={onViewableItemsChangedRef.current}
          renderItem={({ item }) => {
            if (item.kind === 'section') {
              // The Challenges section header carries the scoring-info (i)
              // button on the right - same affordance as on the channel
              // pipeline, so the user can learn the points rules from
              // either entry point without hunting through settings.
              const isChallenges = item.label === t('challengesSection');
              return isChallenges ? (
                <View style={styles.sectionRow}>
                  <Text style={[styles.sectionLabel, styles.sectionLabelFlex]}>{item.label}</Text>
                  <ScoringInfoButton />
                </View>
              ) : (
                <Text style={styles.sectionLabel}>{item.label}</Text>
              );
            }
            if (item.kind === 'challenge') {
              const ch = item.challenge;
              return (
                <ChallengeVersusCard
                  challenge={ch}
                  animated={visibleChallengeIds.has(ch.id)}
                  onPress={() => {
                    track('challenge_opened', { challengeId: ch.id });
                    router.push(`/challenge/${ch.id}` as never);
                  }}
                  onAvatarsPress={() => {
                    track('challenge_opened', { challengeId: ch.id, via: 'avatars' });
                    router.push(`/challenge/${ch.id}` as never);
                  }}
                  onAcceptPress={() => {
                    // Open-slot shortcut. Lands on the challenge channel —
                    // the accept-challenge CTA there is already the
                    // primary one and runs the same guest gate / auth
                    // flow we'd otherwise duplicate here.
                    track('challenge_opened', { challengeId: ch.id, via: 'open_slot' });
                    router.push(`/challenge/${ch.id}` as never);
                  }}
                  onAvatarPress={(uid) => {
                    // Profile gate — ghost users can't open registered
                    // profiles. Identical guard as the chat surface so
                    // a guest tapping an avatar lands on /auth-gate
                    // instead of a 404.
                    if (!canAccessProfile(account)) {
                      router.push('/auth-gate' as never);
                      return;
                    }
                    router.push({ pathname: '/user/[id]', params: { id: uid } });
                  }}
                />
              );
            }
            if (item.kind === 'see_all_challenges') {
              return (
                <TouchableOpacity style={styles.seeAllRow} activeOpacity={0.7} onPress={handleSeeAllChallenges}>
                  <Text style={styles.seeAllText}>{t('seeAllChallenges')}</Text>
                </TouchableOpacity>
              );
            }
            if (item.kind === 'topic') {
              const topicMeters = distanceById.get(item.id);
              return (
                <TopicCard
                  topic={item as FeedItem & { kind: 'topic' }}
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
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { readUserLocation(); load(true); }} tintColor={Colors.accent} />
          }
        />
      )}

      {/* Sticky bottom action - single horizontal row pinned above the tab bar.
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
          {/* Discreet archive entry - muted text link under the upcoming pill. */}
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
        onSelectChallenge={handleCreateChallenge}
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

  // Header - web: BackButton left + "Now" centered (page-header layout)
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
  // No borderBottom - header flows directly into the tab sub-header, matching
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
  // ScrollView style. flexGrow:0 is critical - without it the ScrollView
  // expands to fill the column and pushes the FlatList off-screen.
  filterBar: {
    flexGrow:          0,
    flexShrink:        0,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  // Inner row - what was previously the filterBar's layout.
  filterBarContent: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               8,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
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
  // Row wrapper for section headers that need a trailing element (e.g. the
  // scoring-info (i) button next to "CHALLENGES"). Keeps padding identical
  // to .sectionLabel so the row aligns with plain-text sections above/below.
  sectionRow: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingTop:        Spacing.md,
    paddingBottom:     Spacing.sm,
    gap:               Spacing.sm,
  },
  // When .sectionLabel sits inside .sectionRow, its outer paddings already
  // come from the row - zero them on the Text so the label hugs the row.
  sectionLabelFlex: {
    flex:              1,
    paddingHorizontal: 0,
    paddingTop:        0,
    paddingBottom:     0,
  },
  // "See all challenges →" row that sits at the end of the inline strip.
  seeAllRow: {
    alignSelf:         'flex-end',
    paddingHorizontal: Spacing.sm,
    paddingVertical:   Spacing.xs,
    marginTop:         Spacing.xs,
  },
  seeAllText: {
    fontSize:   FontSizes.sm,
    fontWeight: '700',
    color:      '#FF7A3C',
    letterSpacing: 0.2,
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

  // ── Sticky bottom action block - single-row layout ─────────────────────────
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

  // Wide pill on the left - orange-tinted, mirrors web .upcoming-cta.
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

  // Discreet archive entry - muted, left-aligned under the upcoming pill.
  pastLink:     { alignSelf: 'flex-start', paddingTop: 6, paddingBottom: 2 },
  pastLinkText: { fontSize: FontSizes.sm, color: Colors.muted, fontWeight: '500' },

  // Circular + button on the right - opens CreateSheet picker. Background is a
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
