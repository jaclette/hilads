/**
 * Switch-city screen — full-page list of cities with search + ranking filters.
 *
 * Non-tab route: opened from the City Channel header (tap the city name) and
 * from "Browse cities" fallbacks on other screens. Previously lived at
 * (tabs)/cities.tsx as a visible bottom tab — moved here when that slot was
 * repurposed for the "My city" tab pointing at the City Channel.
 *
 * Web source: App.jsx showCityPicker block + renderCityRow()
 *             index.css (.full-page, .city-row, .city-row-*, .city-list-label, .city-search-*)
 *
 * Structure:
 *   Header:  back button + centered "Switch city" title
 *   Search:  full-width pill input, placeholder "Search a city…"
 *   Label:   "Top cities right now" / "Cities"
 *   Cards:   two-row cards:
 *              top:   activity dot + flag + city name + "you're here" badge
 *              stats: N online (green) · N events · N msgs
 */

import { useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  TouchableOpacity, ActivityIndicator, TextInput, RefreshControl,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { fetchChannels, joinChannel, setCurrentCity } from '@/api/channels';
import { socket } from '@/lib/socket';
import { saveIdentity } from '@/lib/identity';
import { track } from '@/services/analytics';
import type { City } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

// ── Flag emoji — mirrors web cityFlag() ──────────────────────────────────────

function cityFlag(countryCode?: string): string {
  if (!countryCode || countryCode.length !== 2) return '';
  return [...countryCode.toUpperCase()]
    .map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
    .join('');
}

// ── Live activity dot — mirrors web .activity-dot.live pulse animation ───────

function ActivityDot({ live }: { live: boolean }) {
  const scale = useState(() => new Animated.Value(1))[0];

  useEffect(() => {
    if (!live) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.5, duration: 1000, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1,   duration: 1000, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [live]);

  return (
    <Animated.View style={[
      styles.activityDot,
      live && styles.activityDotLive,
      live && { transform: [{ scale }] },
    ]} />
  );
}

// ── City card — mirrors web renderCityRow() ───────────────────────────────────

function CityCard({ city, isActive, onPress }: { city: City; isActive: boolean; onPress: () => void }) {
  const flag = cityFlag(city.country);
  // Active city always counts as live — user is there, at least 1 person online
  const live = isActive || (city.onlineCount ?? 0) > 0;

  return (
    <View style={styles.cardWrapper}>
      {/* web: inset 2px 0 0 var(--accent) — rendered as sibling OUTSIDE the card
          so it is never clipped by the card's border-radius */}
      {isActive && <View style={styles.activeAccentBar} />}

      <TouchableOpacity
        style={[styles.card, isActive && styles.cardActive]}
        onPress={onPress}
        activeOpacity={0.75}
      >
      {/* ── Top row: dot + flag + name + "you're here" badge ── */}
      <View style={styles.cardTop}>
        <View style={styles.cardLeft}>
          <ActivityDot live={live} />
          {!!flag && <Text style={styles.flag}>{flag}</Text>}
          <Text style={[styles.cityName, isActive && styles.cityNameActive]} numberOfLines={2}>
            {city.name}
          </Text>
        </View>
        {isActive && (
          <View style={styles.hereBadge}>
            <Text style={styles.hereBadgeText}>you're here</Text>
          </View>
        )}
      </View>

      {/* ── Stats row: online · events · conversations · msgs ── */}
      <View style={styles.statsRow}>
        {(city.onlineCount ?? 0) > 0 && (
          <Text style={styles.statOnline}>{city.onlineCount} online</Text>
        )}
        {(city.eventCount ?? 0) > 0 && (
          <Text style={styles.statEvents}>
            {city.eventCount} {city.eventCount === 1 ? 'event' : 'events'}
          </Text>
        )}
        {(city.topicCount ?? 0) > 0 && (
          <Text style={styles.statTopics}>
            {city.topicCount} {city.topicCount === 1 ? 'hangout' : 'hangouts'}
          </Text>
        )}
        {(city.messageCount ?? 0) > 0 && (
          <Text style={styles.statMsgs}>{city.messageCount} msgs</Text>
        )}
      </View>
      </TouchableOpacity>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function SwitchCityScreen() {
  const router                                              = useRouter();
  const { city: activeCity, setCity, identity, sessionId, setIdentity, account, detectedCity, setJoined } = useApp();
  const nickname = account?.display_name ?? identity?.nickname ?? '';
  const [cities,        setCities]        = useState<City[]>([]);  // ranked top-10 (filter mode)
  const [allCities,     setAllCities]     = useState<City[]>([]);  // all cities unranked (search mode)
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [error,         setError]         = useState(false);
  const [query,         setQuery]         = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [filter,        setFilter]        = useState<'active' | 'events' | 'online'>('active');

  async function load(sort: string, isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else if (cities.length === 0) setLoading(true);
    setError(false);
    try {
      const ranked = await fetchChannels(sort);
      setCities(ranked);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // Lazy-load full channel list — only fetched when user actually types a search query.
  // Avoids a second parallel request on screen mount; the full list is only needed for search.
  useEffect(() => {
    if (!query.trim() || allCities.length > 0) return;
    let cancelled = false;
    fetchChannels().then(all => { if (!cancelled) setAllCities(all); }).catch(() => {});
    return () => { cancelled = true; };
  }, [query, allCities.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(filter); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function changeFilter(f: 'active' | 'events' | 'online') {
    setFilter(f);
    load(f);
  }

  function switchToCity(item: City) {
    setCity(item);
    if (identity) {
      const updated = { ...identity, channelId: item.channelId };
      saveIdentity(updated).catch(() => {});
      setIdentity(updated);
    }
    if (identity && sessionId) {
      joinChannel(item.channelId, sessionId, identity.guestId, nickname).catch(() => {});
      // joinCity now self-leaves the previous city + queues replay if WS is
      // not yet connected. No more on('connected', joinCity) subscription —
      // those leaked because they were never unsubscribed.
      socket.joinCity(item.channelId, sessionId, nickname, account?.id, identity?.guestId);
    }
    // Commit the manual switch on the backend (registered users only — guests
    // have no users row). Fire-and-forget; failures are non-blocking.
    if (account) setCurrentCity(item.channelId);
    track('city_selected', { cityId: item.channelId, cityName: item.name });
    // replace (not push) — back from the City Channel shouldn't return here.
    router.replace('/(tabs)/chat');
  }

  // Section label — "Top cities right now" when any city has activity, else "Cities"
  const hasActivity  = cities.some(c => (c.onlineCount ?? 0) > 0);
  const sectionLabel = query.trim() ? null : (hasActivity ? 'Top cities right now' : 'Cities');

  // Search mode: filter all cities by query, pin active city first
  // Default mode: use backend-ranked top-10, pin active city first
  const displayList = (() => {
    if (query.trim()) {
      const q = query.toLowerCase();
      const matches = allCities.filter(c =>
        c.name.toLowerCase().includes(q) || c.country.toLowerCase().includes(q),
      );
      if (!activeCity) return matches;
      return [
        ...matches.filter(c => c.channelId === activeCity.channelId),
        ...matches.filter(c => c.channelId !== activeCity.channelId),
      ];
    }
    if (!activeCity) return cities;
    return [
      ...cities.filter(c => c.channelId === activeCity.channelId),
      ...cities.filter(c => c.channelId !== activeCity.channelId),
    ];
  })();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* ── Header — web: .page-header (back button + centered title) ── */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => {
            // The landing's "Browse cities" navigates here with router.replace
            // (+ setJoined(true)), so there's often no history to pop. Fall
            // back gracefully instead of dead-ending:
            //   - history exists        → normal back
            //   - no city joined yet    → return to the landing (setJoined(false))
            //   - already in a city     → go to the city chat
            if (router.canGoBack()) { router.back(); return; }
            if (!activeCity) {
              setJoined(false);
              router.replace('/(tabs)/now');
            } else {
              router.replace('/(tabs)/chat');
            }
          }}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Switch city</Text>
      </View>

      {/* ── Search — web: .city-search-wrap + .city-search-input ── */}
      {/* Focus: border turns accent + soft orange outer glow (web: border-color var(--accent)) */}
      <View style={styles.searchWrap}>
        <View style={[styles.searchInner, searchFocused && styles.searchInnerFocused]}>
          <Ionicons
            name="search"
            size={16}
            color={searchFocused ? Colors.accent : Colors.muted2}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search a city…"
            placeholderTextColor={Colors.muted2}
            value={query}
            onChangeText={setQuery}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            clearButtonMode="while-editing"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </View>

      {/* ── Ranking filters — hidden during search ── */}
      {!query.trim() && (
        <View style={styles.filterRow}>
          {([
            { id: 'active', label: '🔥 Most active' },
            { id: 'events', label: '🎉 Most events' },
            { id: 'online', label: '🟢 Most online' },
          ] as const).map(f => (
            <TouchableOpacity
              key={f.id}
              style={[styles.filterPill, filter === f.id && styles.filterPillActive]}
              onPress={() => { if (filter !== f.id) changeFilter(f.id); }}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterPillText, filter === f.id && styles.filterPillTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── Back to my location CTA — visible only when detected city ≠ active city ── */}
      {detectedCity && detectedCity.channelId !== activeCity?.channelId && (
        <TouchableOpacity
          style={styles.backToLocationBtn}
          onPress={() => switchToCity(detectedCity)}
          activeOpacity={0.8}
        >
          <Ionicons name="locate" size={18} color={Colors.accent} style={styles.backToLocationIcon} />
          <View style={styles.backToLocationText}>
            <Text style={styles.backToLocationLabel}>Back to my location</Text>
            <Text style={styles.backToLocationSub}>{detectedCity.name}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={Colors.accent} />
        </TouchableOpacity>
      )}

      {/* ── City list ── */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>Couldn't load cities</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load(filter)} activeOpacity={0.7}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={displayList}
          keyExtractor={(c) => c.channelId}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <CityCard
              city={item}
              isActive={item.channelId === activeCity?.channelId}
              onPress={() => switchToCity(item)}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(filter, true)}
              tintColor={Colors.accent}
            />
          }
          ListHeaderComponent={sectionLabel ? (
            <Text style={styles.sectionLabel}>{sectionLabel}</Text>
          ) : null}
          contentContainerStyle={displayList.length === 0 ? styles.flex1 : styles.listContent}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>
                {query.trim() ? `No city found for "${query}"` : 'No cities found'}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  flex1:     { flex: 1 },

  // ── .page-header ─────────────────────────────────────────────────────────
  // Web: bg var(--surface), border-bottom rgba(255,255,255,0.05), min-height 80px
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    minHeight:         60,
    paddingHorizontal: Spacing.md,
    paddingVertical:   12,
    backgroundColor:   Colors.bg2,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  // Web: .back-button — 46×46px pill, border rgba(255,255,255,0.1), bg rgba(255,255,255,0.05)
  backBtn: {
    position:        'absolute',
    left:            Spacing.md,
    width:           46,
    height:          46,
    borderRadius:    13,
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  // Web: .page-title — centered, 1.35rem (~21.6px), weight 700, letter-spacing -0.01em
  headerTitle: {
    fontSize:      22,
    fontWeight:    '700',
    color:         Colors.text,
    letterSpacing: -0.22,
  },

  // ── .city-search-wrap ─────────────────────────────────────────────────────
  // Web: padding 12px 14px, border-bottom var(--border), bg rgba(13,11,9,0.9)
  searchWrap: {
    paddingHorizontal: 14,
    paddingVertical:   12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor:   'rgba(13,11,9,0.9)',
  },
  searchInner: {
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   Colors.bg2,
    borderRadius:      14,
    borderWidth:       1,
    borderColor:       Colors.border,
    paddingHorizontal: 14,
  },
  // Web: .city-search-input:focus { border-color: var(--accent) }
  // Android: do NOT change elevation on focus — changing elevation forces a new
  // rendering layer which immediately steals focus from the TextInput child.
  searchInnerFocused: {
    borderColor:     'rgba(194,74,56,0.55)',
    backgroundColor: 'rgba(194,74,56,0.04)',
  },
  searchIcon:  { marginRight: 8 },
  searchInput: {
    flex:            1,
    paddingVertical: 13,
    color:           Colors.text,
    fontSize:        FontSizes.md,
  },

  // ── Ranking filter pills — match Now's chip rhythm (now.tsx filterPill) ──
  // Tighter horizontal padding so the 3 emoji-prefixed labels fit without
  // "Most online" being clipped on iPhone SE / 6.1" widths.
  filterRow: {
    flexDirection:     'row',
    gap:               8,
    paddingHorizontal: 14,
    paddingVertical:   Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical:   6,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.12)',
    backgroundColor:   'transparent',
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

  // ── .city-list-label ──────────────────────────────────────────────────────
  // Web: padding 12px 18px 10px, 0.72rem, weight 600, uppercase, letter-spacing 0.08em
  sectionLabel: {
    paddingHorizontal: 18,
    paddingTop:        16,
    paddingBottom:     12,
    fontSize:          13,
    fontWeight:        '700',
    letterSpacing:     1.1,
    textTransform:     'uppercase',
    color:             Colors.muted,
  },

  // ── Back to my location CTA ──────────────────────────────────────────────
  backToLocationBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    marginHorizontal:  12,
    marginTop:         12,
    marginBottom:      4,
    paddingHorizontal: 18,
    paddingVertical:   14,
    borderRadius:      16,
    backgroundColor:   'rgba(194,74,56,0.10)',
    borderWidth:       1,
    borderColor:       'rgba(194,74,56,0.22)',
  },
  backToLocationIcon: { marginRight: 12 },
  backToLocationText: { flex: 1 },
  backToLocationLabel: {
    fontSize:    15,
    fontWeight:  '700',
    color:       Colors.accent,
    letterSpacing: -0.1,
  },
  backToLocationSub: {
    fontSize:   13,
    fontWeight: '500',
    color:      Colors.muted,
    marginTop:  1,
  },

  listContent: { paddingBottom: 24 },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  emptyText: { fontSize: FontSizes.md, color: Colors.muted2, textAlign: 'center' },
  retryBtn: {
    marginTop:         16,
    paddingHorizontal: 24,
    paddingVertical:   10,
    borderRadius:      999,
    backgroundColor:   Colors.accent2,
  },
  retryText: { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.white },

  // ── Card wrapper — positions accent bar as a sibling to the card ─────────
  // overflow: visible so the bar can bleed past the card's rounded corners
  cardWrapper: {
    marginHorizontal: Spacing.md,
    marginBottom:     6,           // matches Now FlatList's gap: 6
    position:         'relative',
  },

  // City card — compacted to Now's EventCard rhythm (padding 10, gap 4,
  // borderRadius lg). Heavy shadow dropped (Now uses none); active treatment
  // below still provides visual hierarchy via the accent bar + warm bg.
  card: {
    borderRadius:      Radius.lg,
    borderWidth:       1,
    borderColor:       Colors.border,
    backgroundColor:   Colors.bg2,
    padding:           10,
    gap:               4,
    overflow:          'hidden',
  },
  // Web: .city-row.active
  //   background: linear-gradient(180deg, rgba(194,74,56,0.12), rgba(194,74,56,0.07))
  //   border-color: rgba(194,74,56,0.22)
  //   box-shadow: 0 16px 30px rgba(0,0,0,0.18), inset 2px 0 0 var(--accent)
  //                         ↑ dark shadow — NOT orange. Orange only on the inset left bar.
  // Gradient approximated as flat midpoint rgba(194,74,56,0.09)
  cardActive: {
    // rgba(194,74,56,0.12) blended over Colors.bg2 (#161210) → warm dark red surface
    backgroundColor: '#211410',
    borderColor:     'rgba(194,74,56,0.22)',
  },
  // Web: inset 2px 0 0 var(--accent) via box-shadow — rendered as a sibling element
  // outside the card so it is never clipped by overflow: hidden on the card.
  // Positioned at left: -1 so it bleeds 1px past the card's left rounded edge.
  // top/bottom: 8 keeps it inset from the wrapper extremes so it doesn't clip
  // the outer rounded shadow edge.
  activeAccentBar: {
    position:        'absolute',
    left:            -1,
    top:             8,
    bottom:          8,
    width:           4,
    zIndex:          1,
    borderRadius:    2,
    backgroundColor: Colors.accent,
    shadowColor:     Colors.accent,
    shadowOffset:    { width: 0, height: 0 },
    shadowOpacity:   0.55,
    shadowRadius:    5,
    elevation:       4,
  },

  // ── Card top row: activity dot + flag + name + "you're here" badge ──────
  cardTop: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            8,
  },
  cardLeft: {
    flex:          1,
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
  },

  // Activity dot — small circle next to the flag. 7px so it stays
  // proportional to the smaller compact-card type rhythm.
  activityDot: {
    width:           7,
    height:          7,
    borderRadius:    3.5,
    backgroundColor: Colors.border,
    flexShrink:      0,
  },
  activityDotLive: {
    backgroundColor: Colors.green,
    shadowColor:     Colors.green,
    shadowOffset:    { width: 0, height: 0 },
    shadowOpacity:   0.6,
    shadowRadius:    4,
    elevation:       2,
  },

  // Flag — matches Now's `cardIcon` (16px / lh 18) so cards look uniform.
  flag: {
    fontSize:   16,
    lineHeight: 18,
    flexShrink: 0,
  },

  // City name — matches Now's `cardTitle` (md / 700 / lh 19).
  cityName: {
    flex:       1,
    fontSize:   FontSizes.md,
    fontWeight: '700',
    color:      Colors.text,
    lineHeight: 19,
    letterSpacing: -0.1,
  },
  cityNameActive: {},

  // "you're here" badge — kept compact to fit on the title row without
  // forcing the city name to wrap.
  hereBadge: {
    backgroundColor:   'rgba(194,74,56,0.14)',
    borderWidth:       1,
    borderColor:       'rgba(194,74,56,0.18)',
    borderRadius:      999,
    paddingHorizontal: 8,
    paddingVertical:   2,
    flexShrink:        0,
    alignSelf:         'center',
  },
  hereBadgeText: {
    fontSize:      10,
    fontWeight:    '700',
    color:         Colors.accent,
    letterSpacing: 0.1,
  },

  // Stats row — runs full-width compact, matching Now's metaLine font sizing
  // (xs / 600). Smaller gap than before since we no longer indent under the
  // flag (paddingLeft removed).
  statsRow: {
    flexDirection: 'row',
    alignItems:    'center',
    flexWrap:      'wrap',
    gap:           10,
  },
  statOnline: { fontSize: FontSizes.xs, fontWeight: '700', color: Colors.green },
  statEvents: { fontSize: FontSizes.xs, fontWeight: '600', color: Colors.text },
  statTopics: { fontSize: FontSizes.xs, fontWeight: '600', color: '#60a5fa' },
  statMsgs:   { fontSize: FontSizes.xs, fontWeight: '600', color: Colors.muted },
});
