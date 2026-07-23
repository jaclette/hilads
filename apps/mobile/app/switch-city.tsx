/**
 * Switch-city screen - full-page list of cities with search + ranking filters.
 *
 * Non-tab route: opened from the City Channel header (tap the city name) and
 * from "Browse cities" fallbacks on other screens. Previously lived at
 * (tabs)/cities.tsx as a visible bottom tab - moved here when that slot was
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

import { useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  TouchableOpacity, ActivityIndicator, TextInput, RefreshControl,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useApp } from '@/context/AppContext';
import { localizeCityName } from '@/i18n/cityName';
import { fetchChannels, joinChannel } from '@/api/channels';
import { socket } from '@/lib/socket';
import { saveIdentity } from '@/lib/identity';
import { track } from '@/services/analytics';
import type { City } from '@/types';
import { FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

// ── Flag emoji - mirrors web cityFlag() ──────────────────────────────────────

function cityFlag(countryCode?: string): string {
  if (!countryCode || countryCode.length !== 2) return '';
  return [...countryCode.toUpperCase()]
    .map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
    .join('');
}

// ── Live activity dot - mirrors web .activity-dot.live pulse animation ───────

function ActivityDot({ live }: { live: boolean }) {
  const styles = useThemedStyles(makeStyles);
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

// ── City card - mirrors web renderCityRow() ───────────────────────────────────

function CityCard({ city, isActive, onPress }: { city: City; isActive: boolean; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('cities');
  const flag = cityFlag(city.country);
  // Active city always counts as live - user is there, at least 1 person online
  const live = isActive || (city.onlineCount ?? 0) > 0;

  return (
    <View style={styles.cardWrapper}>
      {/* web: inset 2px 0 0 var(--accent) - rendered as sibling OUTSIDE the card
          so it is never clipped by the card's border-radius */}
      {isActive && <View style={styles.activeAccentBar} />}

      <TouchableOpacity
        style={[styles.card, isActive && styles.cardActive]}
        onPress={onPress}
        activeOpacity={0.75}
      >
      {/* Warm accent gradient for the current city (web .city-row.active) -
          sits behind the content, clipped by the card's overflow:hidden. */}
      {isActive && (
        <LinearGradient
          colors={['rgba(194,74,56,0.12)', 'rgba(194,74,56,0.07)']}
          style={styles.cardActiveGradient}
          pointerEvents="none"
        />
      )}
      {/* ── Top row: dot + flag + name + "you're here" badge ── */}
      <View style={styles.cardTop}>
        <View style={styles.cardLeft}>
          <ActivityDot live={live} />
          {!!flag && <Text style={styles.flag}>{flag}</Text>}
          <Text style={[styles.cityName, isActive && styles.cityNameActive]} numberOfLines={2}>
            {localizeCityName(city.name)}
          </Text>
        </View>
        {isActive && (
          <View style={styles.hereBadge}>
            <Text style={styles.hereBadgeText}>{t('youreHere')}</Text>
          </View>
        )}
      </View>

      {/* ── Stats row: challenges (main feature, first) · presence · events · hangouts · msgs ── */}
      <View style={styles.statsRow}>
        {/* Challenges first - the app's headline feature */}
        {(city.challengeCount ?? 0) > 0 && (
          <Text style={styles.statChallenges}>{t('challenges', { count: city.challengeCount })}</Text>
        )}
        {/* Presence: ≥2 online → "X online"; <2 online → "X members" (if any);
            no members → show nothing. */}
        {(city.onlineCount ?? 0) >= 2 ? (
          <Text style={styles.statOnline}>{t('online', { count: city.onlineCount })}</Text>
        ) : (city.memberCount ?? 0) > 0 ? (
          <Text style={styles.statMembers}>{t('members', { count: city.memberCount })}</Text>
        ) : null}
        {(city.eventCount ?? 0) > 0 && (
          <Text style={styles.statEvents}>
            {t('events', { count: city.eventCount })}
          </Text>
        )}
        {(city.topicCount ?? 0) > 0 && (
          <Text style={styles.statTopics}>
            {t('hangout', { count: city.topicCount })}
          </Text>
        )}
        {(city.messageCount ?? 0) > 0 && (
          <Text style={styles.statMsgs}>{t('msgs', { count: city.messageCount })}</Text>
        )}
      </View>
      </TouchableOpacity>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function SwitchCityScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const router                                              = useRouter();
  const { t } = useTranslation('cities');
  // First-launch mode: routed here by useAppBoot when IP detection found no city.
  // No back button, a "start here" headline, and the pick completes onboarding.
  const { firstTime } = useLocalSearchParams<{ firstTime?: string }>();
  const isFirstTime = firstTime === '1';
  const { city: activeCity, setCity, identity, sessionId, setIdentity, account, detectedCity, setJoined } = useApp();
  const nickname = account?.display_name ?? identity?.nickname ?? '';
  // Guards a double-tap / rapid re-pick from firing the switch sequence twice
  // (setCity + joinChannel + WS join + navigate) before navigation settles.
  const switchingRef = useRef(false);
  const [cities,        setCities]        = useState<City[]>([]);  // ranked top-10 (filter mode)
  const [allCities,     setAllCities]     = useState<City[]>([]);  // all cities unranked (search mode)
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [error,         setError]         = useState(false);
  const [query,         setQuery]         = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [filter,        setFilter]        = useState<'active' | 'challenges' | 'events' | 'online'>('active');

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

  // Lazy-load full channel list - only fetched when user actually types a search query.
  // Avoids a second parallel request on screen mount; the full list is only needed for search.
  useEffect(() => {
    if (!query.trim() || allCities.length > 0) return;
    let cancelled = false;
    fetchChannels().then(all => { if (!cancelled) setAllCities(all); }).catch(() => {});
    return () => { cancelled = true; };
  }, [query, allCities.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(filter); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function changeFilter(f: 'active' | 'challenges' | 'events' | 'online') {
    setFilter(f);
    load(f);
  }

  function switchToCity(item: City) {
    if (switchingRef.current) return; // ignore rapid double-taps
    switchingRef.current = true;
    setCity(item);
    if (identity) {
      const updated = { ...identity, channelId: item.channelId };
      saveIdentity(updated).catch(() => {});
      setIdentity(updated);
    }
    if (identity && sessionId) {
      joinChannel(item.channelId, sessionId, identity.guestId, nickname).catch(() => {});
      // joinCity now self-leaves the previous city + queues replay if WS is
      // not yet connected. No more on('connected', joinCity) subscription -
      // those leaked because they were never unsubscribed.
      socket.joinCity(item.channelId, sessionId, nickname, account?.id, identity?.guestId);
    }
    // Switch-city is a browse surface - NEVER overwrites the home city,
    // not even for Legends. The home city is strictly geolocation-driven
    // (set by /location/resolve). Legends still have an explicit override
    // path on their profile (HOME CITY input → city picker with search +
    // autocomplete), which is the only place /me/city is called from now.
    track('city_selected', { cityId: item.channelId, cityName: item.name });
    if (isFirstTime) {
      // First-launch pick completes onboarding: the guest wasn't joined yet.
      setJoined(true);
      track('first_launch_city_selected', { chosen_city: item.name, method: 'manual_picker' });
    }
    // replace (not push) - back from the City Channel shouldn't return here.
    router.replace('/(tabs)/chat');
  }

  // Section label - "Top cities right now" when any city has activity, else "Cities"
  const hasActivity  = cities.some(c => (c.onlineCount ?? 0) > 0);
  const sectionLabel = query.trim() ? null : (hasActivity ? t('topCities') : t('cities'));

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

      {/* ── Header - web: .page-header (back button + centered title) ── */}
      {/* First-launch mode: no back button (the user must pick to proceed) and a
          "start here" headline. Otherwise the normal back button + "Switch city". */}
      <View style={styles.header}>
        {!isFirstTime && (
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
                router.replace('/(tabs)/events');
              } else {
                router.replace('/(tabs)/chat');
              }
            }}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle}>{isFirstTime ? t('firstTimeTitle') : t('title')}</Text>
      </View>

      {/* ── Search - web: .city-search-wrap + .city-search-input ── */}
      {/* Focus: border turns accent + soft orange outer glow (web: border-color var(--accent)) */}
      <View style={styles.searchWrap}>
        <View style={[styles.searchInner, searchFocused && styles.searchInnerFocused]}>
          <Ionicons
            name="search"
            size={16}
            color={searchFocused ? colors.accent : colors.muted2}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder={t('searchPlaceholder')}
            placeholderTextColor={colors.muted2}
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

      {/* ── Ranking filters - hidden during search ── */}
      {!query.trim() && (
        <View style={styles.filterRow}>
          {([
            { id: 'active', labelKey: 'filterActive' },
            { id: 'challenges', labelKey: 'filterChallenges' },
            { id: 'events', labelKey: 'filterEvents' },
            { id: 'online', labelKey: 'filterOnline' },
          ] as const).map(f => (
            <TouchableOpacity
              key={f.id}
              style={[styles.filterPill, filter === f.id && styles.filterPillActive]}
              onPress={() => { if (filter !== f.id) changeFilter(f.id); }}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterPillText, filter === f.id && styles.filterPillTextActive]}>
                {t(f.labelKey)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── Back to my location CTA - visible only when detected city ≠ active city ── */}
      {detectedCity && detectedCity.channelId !== activeCity?.channelId && (
        <TouchableOpacity
          style={styles.backToLocationBtn}
          onPress={() => switchToCity(detectedCity)}
          activeOpacity={0.8}
        >
          <Ionicons name="locate" size={18} color={colors.accent} style={styles.backToLocationIcon} />
          <View style={styles.backToLocationText}>
            <Text style={styles.backToLocationLabel}>{t('backToLocation')}</Text>
            <Text style={styles.backToLocationSub}>{localizeCityName(detectedCity.name)}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.accent} />
        </TouchableOpacity>
      )}

      {/* ── City list ── */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>{t('loadError')}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load(filter)} activeOpacity={0.7}>
            <Text style={styles.retryText}>{t('retry', { ns: 'common' })}</Text>
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
              tintColor={colors.accent}
            />
          }
          ListHeaderComponent={sectionLabel ? (
            <Text style={styles.sectionLabel}>{sectionLabel}</Text>
          ) : null}
          contentContainerStyle={displayList.length === 0 ? styles.flex1 : styles.listContent}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>
                {query.trim() ? t('noResults', { query }) : t('noCities')}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
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
    backgroundColor:   c.bg2,
    borderBottomWidth: 1,
    borderBottomColor: c.overlayWeak,
  },
  // Web: .back-button - 46×46px pill, border rgba(255,255,255,0.1), bg rgba(255,255,255,0.05)
  backBtn: {
    position:        'absolute',
    left:            Spacing.md,
    width:           46,
    height:          46,
    borderRadius:    13,
    borderWidth:     1,
    borderColor:     c.overlayStrong,
    backgroundColor: c.overlayWeak,
    alignItems:      'center',
    justifyContent:  'center',
  },
  // Web: .page-title - centered, 1.35rem (~21.6px), weight 700, letter-spacing -0.01em
  headerTitle: {
    fontSize:      22,
    fontWeight:    '700',
    color:         c.text,
    letterSpacing: -0.22,
  },

  // ── .city-search-wrap ─────────────────────────────────────────────────────
  // Web: padding 12px 14px, border-bottom var(--border), bg rgba(13,11,9,0.9)
  searchWrap: {
    paddingHorizontal: 14,
    paddingVertical:   12,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor:   c.bg,
  },
  searchInner: {
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   c.bg2,
    borderRadius:      14,
    borderWidth:       1,
    borderColor:       c.border,
    paddingHorizontal: 14,
  },
  // Web: .city-search-input:focus { border-color: var(--accent) }
  // Android: do NOT change elevation on focus - changing elevation forces a new
  // rendering layer which immediately steals focus from the TextInput child.
  searchInnerFocused: {
    borderColor:     'rgba(194,74,56,0.55)',
    backgroundColor: 'rgba(194,74,56,0.04)',
  },
  searchIcon:  { marginRight: 8 },
  searchInput: {
    flex:            1,
    paddingVertical: 13,
    color:           c.text,
    fontSize:        FontSizes.md,
  },

  // ── Ranking filter pills - match Now's chip rhythm (now.tsx filterPill) ──
  // Tighter horizontal padding so the 3 emoji-prefixed labels fit without
  // "Most online" being clipped on iPhone SE / 6.1" widths.
  filterRow: {
    flexDirection:     'row',
    gap:               8,
    paddingHorizontal: 14,
    paddingVertical:   Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical:   6,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       c.overlayStrong,
    backgroundColor:   'transparent',
  },
  filterPillActive: {
    backgroundColor: c.accent,
    borderColor:     c.accent,
  },
  filterPillText: {
    fontSize:   FontSizes.sm,
    fontWeight: '500',
    color:      c.muted,
  },
  filterPillTextActive: {
    color:      c.white,
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
    color:             c.muted,
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
    color:       c.accent,
    letterSpacing: -0.1,
  },
  backToLocationSub: {
    fontSize:   13,
    fontWeight: '500',
    color:      c.muted,
    marginTop:  1,
  },

  listContent: { paddingBottom: 24 },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  emptyText: { fontSize: FontSizes.md, color: c.muted2, textAlign: 'center' },
  retryBtn: {
    marginTop:         16,
    paddingHorizontal: 24,
    paddingVertical:   10,
    borderRadius:      999,
    backgroundColor:   c.accent2,
  },
  retryText: { fontSize: FontSizes.sm, fontWeight: '700', color: c.white },

  // ── Card wrapper - positions accent bar as a sibling to the card ─────────
  // overflow: visible so the bar can bleed past the card's rounded corners
  cardWrapper: {
    marginHorizontal: Spacing.md,
    marginBottom:     6,           // matches Now FlatList's gap: 6
    position:         'relative',
  },

  // City card - compacted to Now's EventCard rhythm (padding 10, gap 4,
  // borderRadius lg). Heavy shadow dropped (Now uses none); active treatment
  // below still provides visual hierarchy via the accent bar + warm bg.
  card: {
    borderRadius:      Radius.lg,
    borderWidth:       1,
    borderColor:       c.border,
    backgroundColor:   c.bg2,
    padding:           10,
    gap:               4,
    overflow:          'hidden',
  },
  // Web: .city-row.active
  //   background: linear-gradient(180deg, rgba(194,74,56,0.12), rgba(194,74,56,0.07))
  //   border-color: rgba(194,74,56,0.22)
  //   box-shadow: 0 16px 30px rgba(0,0,0,0.18), inset 2px 0 0 var(--accent)
  //                         ↑ dark shadow - NOT orange. Orange only on the inset left bar.
  // The gradient itself is a <LinearGradient> overlay in the JSX (same stops as
  // web) so it reads as a warm peach on the light card instead of a flat dark red.
  cardActive: {
    borderColor: 'rgba(194,74,56,0.22)',
  },
  cardActiveGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  // Web: inset 2px 0 0 var(--accent) via box-shadow - rendered as a sibling element
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
    backgroundColor: c.accent,
    shadowColor:     c.accent,
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

  // Activity dot - small circle next to the flag. 7px so it stays
  // proportional to the smaller compact-card type rhythm.
  activityDot: {
    width:           7,
    height:          7,
    borderRadius:    3.5,
    backgroundColor: c.border,
    flexShrink:      0,
  },
  activityDotLive: {
    backgroundColor: c.green,
    shadowColor:     c.green,
    shadowOffset:    { width: 0, height: 0 },
    shadowOpacity:   0.6,
    shadowRadius:    4,
    elevation:       2,
  },

  // Flag - matches Now's `cardIcon` (16px / lh 18) so cards look uniform.
  flag: {
    fontSize:   16,
    lineHeight: 18,
    flexShrink: 0,
  },

  // City name - matches Now's `cardTitle` (md / 700 / lh 19).
  cityName: {
    flex:       1,
    fontSize:   FontSizes.md,
    fontWeight: '700',
    color:      c.text,
    lineHeight: 19,
    letterSpacing: -0.1,
  },
  cityNameActive: {},

  // "you're here" badge - kept compact to fit on the title row without
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
    color:         c.accent,
    letterSpacing: 0.1,
  },

  // Stats row - runs full-width compact, matching Now's metaLine font sizing
  // (xs / 600). Smaller gap than before since we no longer indent under the
  // flag (paddingLeft removed).
  statsRow: {
    flexDirection: 'row',
    alignItems:    'center',
    flexWrap:      'wrap',
    gap:           10,
  },
  statOnline: { fontSize: FontSizes.xs, fontWeight: '700', color: c.green },
  // Challenges = the headline feature → accent colour so it leads the eye.
  statChallenges: { fontSize: FontSizes.xs, fontWeight: '800', color: c.accent },
  statMembers: { fontSize: FontSizes.xs, fontWeight: '600', color: c.muted },
  statEvents: { fontSize: FontSizes.xs, fontWeight: '600', color: c.text },
  statTopics: { fontSize: FontSizes.xs, fontWeight: '600', color: '#60a5fa' },
  statMsgs:   { fontSize: FontSizes.xs, fontWeight: '600', color: c.muted },
});
