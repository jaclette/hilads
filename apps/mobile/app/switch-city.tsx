/**
 * Switch-city screen - full-page list of cities with search + ranking filters.
 *
 * Non-tab route: opened from the City Channel header (tap the city name) and
 * from "Browse cities" fallbacks on other screens. Previously lived at
 * (tabs)/cities.tsx as a visible bottom tab - moved here when that slot was
 * repurposed for the "My city" tab pointing at the City Channel.
 *
 * Structure: back header ("Switch city"; first launch: large title, no back),
 * the search pill, ranking filter chips, "Back to my location", then city
 * cards (activity dot, flag, name, "You're here", stats).
 */

import { useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, RefreshControl,
  Animated,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/context/AppContext';
import { localizeCityName } from '@/i18n/cityName';
import { fetchChannels, joinChannel } from '@/api/channels';
import { socket } from '@/lib/socket';
import { saveIdentity } from '@/lib/identity';
import { track } from '@/services/analytics';
import type { City } from '@/types';
import { FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Button, Card, Chip, ListRow, RowGroup, Screen, ScreenHeader, TextField } from '@/ui';

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
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} accessibilityRole="button"
                      accessibilityState={{ selected: isActive }} style={styles.cardTouch}>
      <Card style={[styles.card, isActive && styles.cardActive]}>
        <View style={styles.cardTop}>
          <ActivityDot live={live} />
          {!!flag && <Text style={styles.flag}>{flag}</Text>}
          <Text style={styles.cityName} numberOfLines={2}>{localizeCityName(city.name)}</Text>
          {isActive && <Chip label={t('youreHere')} />}
        </View>
        {/* Challenges first, then presence (≥2 online → "X online", else "X members"), events, hangouts, msgs. */}
        <View style={styles.statsRow}>
          {(city.challengeCount ?? 0) > 0 && <Text style={styles.statStrong}>{t('challenges', { count: city.challengeCount })}</Text>}
          {(city.onlineCount ?? 0) >= 2 ? (
            <Text style={styles.statOnline}>{t('online', { count: city.onlineCount })}</Text>
          ) : (city.memberCount ?? 0) > 0 ? (
            <Text style={styles.stat}>{t('members', { count: city.memberCount })}</Text>
          ) : null}
          {(city.eventCount ?? 0) > 0 && <Text style={styles.stat}>{t('events', { count: city.eventCount })}</Text>}
          {(city.topicCount ?? 0) > 0 && <Text style={styles.stat}>{t('hangout', { count: city.topicCount })}</Text>}
          {(city.messageCount ?? 0) > 0 && <Text style={styles.stat}>{t('msgs', { count: city.messageCount })}</Text>}
        </View>
      </Card>
    </TouchableOpacity>
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
    // replace (not push) - back shouldn't return here. First launch lands
    // on Today, the home (V3-11); a later switch returns to the city chat.
    router.replace((isFirstTime ? '/(tabs)/today' : '/(tabs)/chat') as never);
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

  const goBack = () => {
    // Often opened with router.replace (no history to pop). Fall back:
    // history → back; no city yet → Today; already in a city → the city chat.
    if (router.canGoBack()) { router.back(); return; }
    if (!activeCity) {
      setJoined(false);
      router.replace('/(tabs)/today' as never);
    } else {
      router.replace('/(tabs)/chat');
    }
  };

  return (
    <Screen>
      {/* First launch: no back (the user must pick to proceed) and a "start here" headline. */}
      {isFirstTime
        ? <ScreenHeader variant="tab" title={t('firstTimeTitle')} />
        : <ScreenHeader title={t('title')} onBack={goBack} />}

      <View style={styles.search}>
        <TextField
          variant="search"
          placeholder={t('searchPlaceholder')}
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          clearLabel={t('clear', { ns: 'common', defaultValue: 'Clear' })}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* Ranking filters - hidden during search. */}
      {!query.trim() && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} style={styles.filtersWrap}>
          {([
            { id: 'active', labelKey: 'filterActive' },
            { id: 'challenges', labelKey: 'filterChallenges' },
            { id: 'events', labelKey: 'filterEvents' },
            { id: 'online', labelKey: 'filterOnline' },
          ] as const).map(f => (
            <Chip key={f.id} variant="filter" label={t(f.labelKey)} selected={filter === f.id}
                  onPress={() => { if (filter !== f.id) changeFilter(f.id); }} />
          ))}
        </ScrollView>
      )}

      {/* Back to my location - only when the detected city isn't the active one. */}
      {detectedCity && detectedCity.channelId !== activeCity?.channelId && (
        <RowGroup style={styles.backToLocation}>
          <ListRow icon="locate-outline" title={t('backToLocation')} value={localizeCityName(detectedCity.name)}
                   onPress={() => switchToCity(detectedCity)} />
        </RowGroup>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>{t('loadError')}</Text>
          <Button variant="secondary" label={t('retry', { ns: 'common' })} onPress={() => load(filter)} style={styles.retry} />
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
              tintColor={colors.primary}
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
    </Screen>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  flex1:          { flex: 1 },
  search:         { paddingHorizontal: Spacing.md, paddingTop: 4 },
  filtersWrap:    { flexGrow: 0 },
  filters:        { gap: 8, paddingHorizontal: Spacing.md, paddingVertical: 10 },
  backToLocation: { marginHorizontal: Spacing.md, marginBottom: 4 },
  center:         { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg, gap: Spacing.md },
  emptyText:      { fontSize: FontSizes.sm, fontWeight: '400', color: c.muted, textAlign: 'center' },
  retry:          { minWidth: 140 },
  sectionLabel:   { fontSize: FontSizes.md, fontWeight: '800', color: c.text, paddingTop: 6, paddingBottom: 8 },
  listContent:    { paddingHorizontal: Spacing.md, paddingBottom: Spacing.xl },
  cardTouch:      { marginBottom: 10 },
  card:           { paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  cardActive:     { borderColor: c.primary },
  cardTop:        { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flag:           { fontSize: 18 },
  cityName:       { flex: 1, fontSize: 15, fontWeight: '700', color: c.text },
  statsRow:       { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 2, paddingLeft: 16 },
  stat:           { fontSize: FontSizes.xs, fontWeight: '600', color: c.muted },
  statStrong:     { fontSize: FontSizes.xs, fontWeight: '700', color: c.primaryText },
  statOnline:     { fontSize: FontSizes.xs, fontWeight: '700', color: c.green },
  activityDot:    { width: 8, height: 8, borderRadius: Radius.full, backgroundColor: c.line },
  activityDotLive:{ backgroundColor: c.green },
});
