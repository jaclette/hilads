/**
 * Cities screen — faithful port of the web "Switch city" full-page screen.
 *
 * Web source: App.jsx showCityPicker block + renderCityRow()
 *             index.css (.full-page, .city-row, .city-row-*, .city-list-label, .city-search-*)
 *
 * Structure:
 *   Header:  back button (→ chat) + centered "Switch city" title
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
import { fetchChannels, joinChannel } from '@/api/channels';
import { socket } from '@/lib/socket';
import { saveIdentity } from '@/lib/identity';
import { track } from '@/services/analytics';
import type { City } from '@/types';
import { Colors, FontSizes, Spacing } from '@/constants';

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

      {/* ── Stats row: online · events · msgs ── */}
      <View style={styles.statsRow}>
        {(city.onlineCount ?? 0) > 0 && (
          <Text style={styles.statOnline}>{city.onlineCount} online</Text>
        )}
        {(city.eventCount ?? 0) > 0 && (
          <Text style={styles.statEvents}>
            {city.eventCount} {city.eventCount === 1 ? 'event' : 'events'}
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

export default function CitiesScreen() {
  const router                                              = useRouter();
  const { city: activeCity, setCity, identity, sessionId, setIdentity, account } = useApp();
  const nickname = account?.display_name ?? identity?.nickname ?? '';
  const [cities,        setCities]        = useState<City[]>([]);
  const [filtered,      setFiltered]      = useState<City[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [query,         setQuery]         = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    try {
      const data = await fetchChannels();
      setCities(data);
      setFiltered(data);
    } catch {
      // silent — show stale data
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!query.trim()) {
      setFiltered(cities);
    } else {
      const q = query.toLowerCase();
      setFiltered(cities.filter(c =>
        c.name.toLowerCase().includes(q) || c.country.toLowerCase().includes(q),
      ));
    }
  }, [query, cities]);

  // Section label — web: "Top cities right now" when any city has activity, else "Cities"
  // Rendered uppercase via textTransform → "TOP CITIES RIGHT NOW" / "CITIES"
  const hasActivity  = cities.some(c => (c.onlineCount ?? 0) > 0);
  const sectionLabel = query.trim() ? null : (hasActivity ? 'Top cities right now' : 'Cities');

  // Current city always first — regardless of server ordering.
  // Default (no query): top 10 only — mirrors web getDefaultCityTargets(limit=10).
  // Search: all matching results — mirrors web getSearchCityTargets(limit=12, but unbounded here).
  const ranked = activeCity
    ? [
        ...filtered.filter(c => c.channelId === activeCity.channelId),
        ...filtered.filter(c => c.channelId !== activeCity.channelId),
      ]
    : filtered;
  const sortedFiltered = query.trim() ? ranked : ranked.slice(0, 10);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* ── Header — web: .page-header (back button + centered title) ── */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.push('/(tabs)/chat')}
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

      {/* ── City list ── */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : (
        <FlatList
          data={sortedFiltered}
          keyExtractor={(c) => c.channelId}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <CityCard
              city={item}
              isActive={item.channelId === activeCity?.channelId}
              onPress={() => {
                setCity(item);
                // Persist new channelId so relaunch restores the correct city.
                // Bug: without this, identity.channelId stays stale in AsyncStorage
                // and the boot auto-rejoin restores the OLD city on next launch.
                if (identity) {
                  const updated = { ...identity, channelId: item.channelId };
                  saveIdentity(updated).catch(() => {});
                  setIdentity(updated);
                }
                // Join new city on the server and socket
                if (identity && sessionId) {
                  joinChannel(item.channelId, sessionId, identity.guestId, nickname).catch(() => {});
                  if (socket.isConnected) {
                    socket.joinCity(item.channelId, sessionId, nickname, account?.id);
                  } else {
                    socket.on('connected', () => socket.joinCity(item.channelId, sessionId, nickname, account?.id));
                  }
                }
                track('city_selected', { cityId: item.channelId, cityName: item.name });
                router.push('/(tabs)/chat');
              }}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={Colors.accent}
            />
          }
          ListHeaderComponent={sectionLabel ? (
            <Text style={styles.sectionLabel}>{sectionLabel}</Text>
          ) : null}
          contentContainerStyle={sortedFiltered.length === 0 ? styles.flex1 : styles.listContent}
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

  listContent: { paddingBottom: 24 },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  emptyText: { fontSize: FontSizes.md, color: Colors.muted2, textAlign: 'center' },

  // ── Card wrapper — positions accent bar as a sibling to the card ─────────
  // overflow: visible so the bar can bleed past the card's rounded corners
  cardWrapper: {
    marginHorizontal: 12,
    marginBottom:     10,
    position:         'relative',
  },

  // ── .city-row ─────────────────────────────────────────────────────────────
  // Web: border-radius 18px, border rgba(255,255,255,0.05), padding 18px 18px 16px,
  //      flex-col, gap 12px, shadow 0 10px 22px rgba(0,0,0,0.12), margin-bottom 10px
  card: {
    borderRadius:      18,
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.07)',
    // Solid bg required — rgba(255,255,255,0.03) is effectively transparent on Android,
    // causing touch events to fall through to the FlatList instead of the card.
    backgroundColor:   Colors.bg2,
    paddingHorizontal: 18,
    paddingTop:        20,
    paddingBottom:     18,
    gap:               12,
    overflow:          'hidden',
    shadowColor:       '#000',
    shadowOffset:      { width: 0, height: 12 },
    shadowOpacity:     0.22,
    shadowRadius:      16,
    elevation:         5,
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
    shadowColor:     '#000',   // web uses dark shadow, not orange glow
    shadowOffset:    { width: 0, height: 16 },
    shadowOpacity:   0.18,
    shadowRadius:    15,
    elevation:       5,
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

  // ── .city-row-top ─────────────────────────────────────────────────────────
  cardTop: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    justifyContent: 'space-between',
    gap:            12,
  },
  // ── .city-row-left ────────────────────────────────────────────────────────
  cardLeft: {
    flex:        1,
    flexDirection: 'row',
    alignItems:  'flex-start',
    gap:         12,
  },

  // ── .activity-dot / .activity-dot.live ────────────────────────────────────
  // Web: 9px circle, bg var(--border) inactive, var(--green) + glow active, margin-top 7px
  activityDot: {
    width:           9,
    height:          9,
    borderRadius:    4.5,
    backgroundColor: Colors.border,
    flexShrink:      0,
    marginTop:       7,
  },
  activityDotLive: {
    backgroundColor: Colors.green,
    shadowColor:     Colors.green,
    shadowOffset:    { width: 0, height: 0 },
    shadowOpacity:   0.6,
    shadowRadius:    4,
    elevation:       2,
  },

  // ── .city-row-flag ────────────────────────────────────────────────────────
  // Web: font-size 1.18rem (~18.9px) → 21px for stronger presence on mobile
  flag: {
    fontSize:   21,
    lineHeight: 24,
    flexShrink: 0,
    marginTop:  2,
  },

  // ── .city-row-name ────────────────────────────────────────────────────────
  // Web: 1.08rem, font-weight 750 → 19px + weight 800 for mobile visual weight
  cityName: {
    flex:         1,
    fontSize:     19,
    fontWeight:   '800',
    color:        Colors.text,
    lineHeight:   24,
    letterSpacing: -0.2,
  },
  cityNameActive: {},

  // ── .city-row-current — "you're here" badge ───────────────────────────────
  // Web: 0.72rem, weight 700, color --accent, bg rgba(194,74,56,0.14),
  //      border rgba(194,74,56,0.18), radius 999px, padding 5px 10px
  // Web: .city-row-current — bg rgba(194,74,56,0.14), border rgba(194,74,56,0.18),
  //      radius 999px, padding 5px 10px, font 0.72rem/700/accent
  // Web: .city-row-current — no shadow, just subtle bg + border
  hereBadge: {
    backgroundColor:   'rgba(194,74,56,0.14)',
    borderWidth:       1,
    borderColor:       'rgba(194,74,56,0.18)',
    borderRadius:      999,
    paddingHorizontal: 11,
    paddingVertical:   5,
    flexShrink:        0,
    alignSelf:         'flex-start',
  },
  hereBadgeText: {
    fontSize:   11,
    fontWeight: '700',
    color:      Colors.accent,
    letterSpacing: 0.1,
  },

  // ── .city-row-stats ───────────────────────────────────────────────────────
  // Web: flex row, gap 16px, padding-left 33px (= 9px dot + 12px gap + 12px flag area)
  statsRow: {
    flexDirection: 'row',
    alignItems:    'center',
    flexWrap:      'wrap',
    gap:           16,
    paddingLeft:   33,
  },
  // Web: .city-row-users — 0.82rem (~13px), green, weight 700 → 14px mobile
  statOnline: { fontSize: 14, fontWeight: '700', color: Colors.green },
  // Web: .city-row-events — 0.82rem, var(--text), weight 600
  statEvents: { fontSize: 14, fontWeight: '600', color: Colors.text },
  // Web: .city-row-count — 0.82rem, var(--muted), weight 600
  statMsgs:   { fontSize: 14, fontWeight: '600', color: Colors.muted },
});
