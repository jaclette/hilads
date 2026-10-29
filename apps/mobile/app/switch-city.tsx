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
 *
 * The search covers every city in the world (V5-01, GET /cities/search): a pick
 * that isn't a Hilads city yet creates it, a suburb lands in its main city
 * ("plays in New York"). mode=here ("Not in Saigon? Change" on Today): the
 * pick also sets where I am - an account's city (POST /me/city), a guest's on
 * the device - with "Use my location" first.
 */

import { useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, RefreshControl,
  Animated, Alert,
} from 'react-native';
import * as Location from 'expo-location';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/context/AppContext';
import { useScope } from '@/context/ScopeContext';
import { localizeCityName } from '@/i18n/cityName';
import {
  fetchChannels, joinChannel, searchCities, pickCity, setMyCity, resolveLocation, isNoCity,
  type CitySearchResult,
} from '@/api/channels';
import { ApiError } from '@/api/client';
import { requestFeatureLocation } from '@/lib/geoFeature';
import { markGpsCity } from '@/lib/gpsCityCorrection';
import { socket } from '@/lib/socket';
import { saveIdentity } from '@/lib/identity';
import { track } from '@/services/analytics';
import type { City } from '@/types';
import { FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Card, Chip, CityFlag, ListRow, RowGroup, Screen, ScreenHeader, TextField, WakingUp } from '@/ui';
import { readOffline, writeOffline } from '@/lib/offlineCache';
import { KeyboardArea } from '@/ui/keyboard';

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
  // Active city always counts as live - user is there, at least 1 person online
  const live = isActive || (city.onlineCount ?? 0) > 0;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} accessibilityRole="button"
                      accessibilityState={{ selected: isActive }} style={styles.cardTouch}>
      <Card style={[styles.card, isActive && styles.cardActive]}>
        <View style={styles.cardTop}>
          <ActivityDot live={live} />
          <CityFlag country={city.country} />
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

// ── World search result: flag, name, where a pick plays ───────────────────────

function SearchResultRow({ item, onPress }: { item: CitySearchResult; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('cities');
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} accessibilityRole="button" style={styles.cardTouch}>
      <Card style={styles.card}>
        <View style={styles.cardTop}>
          <CityFlag country={item.country} />
          <Text style={styles.cityName} numberOfLines={2}>{item.name}</Text>
        </View>
        {!!item.playsIn && <Text style={[styles.stat, styles.playsIn]}>{t('playsIn', { city: item.playsIn.name })}</Text>}
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
  const { firstTime, mode } = useLocalSearchParams<{ firstTime?: string; mode?: string }>();
  const isFirstTime = firstTime === '1';
  // "Not in Saigon? Change": the pick sets where I am, not only what I browse.
  const isHere = mode === 'here';
  const { city: activeCity, setCity, identity, sessionId, setIdentity, account, detectedCity, setDetectedCity, setJoined } = useApp();
  const { setScope } = useScope();
  const nickname = account?.display_name ?? identity?.nickname ?? '';
  // Guards a double-tap / rapid re-pick from firing the switch sequence twice
  // (setCity + joinChannel + WS join + navigate) before navigation settles.
  const switchingRef = useRef(false);
  const [cities,        setCities]        = useState<City[]>([]);  // ranked top-10 (filter mode)
  const [results,       setResults]       = useState<CitySearchResult[] | null>(null); // world search (null = not searching)
  const [busy,          setBusy]          = useState(false);         // a pick / locate in flight
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [error,         setError]         = useState(false);
  const [query,         setQuery]         = useState('');
  const [filter,        setFilter]        = useState<'active' | 'challenges' | 'events' | 'online'>('active');

  async function load(sort: string, isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else if (cities.length === 0 && !error) setLoading(true);   // "waking up" stays up while it retries
    try {
      const ranked = await fetchChannels(sort);
      setCities(ranked);
      setError(false);
      writeOffline(`cities:${sort}`, ranked);
    } catch {
      // Unreachable (a deploy, no network): the last list loaded on this phone, else "waking up".
      const cached = await readOffline<City[]>(`cities:${sort}`);
      if (cached?.length) setCities(cached);
      else setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // World search (every GeoNames city, our aliases too), debounced; under 2 letters, the ranked list.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults(null); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchCities(q).then(r => { if (!cancelled) setResults(r); }).catch(() => { if (!cancelled) setResults([]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  useEffect(() => { load(filter); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function changeFilter(f: 'active' | 'challenges' | 'events' | 'online') {
    setFilter(f);
    load(f);
  }

  /** A world search pick: the Hilads city it plays in (created at its first pick), then as a list pick. */
  async function pickResult(item: CitySearchResult) {
    if (busy) return;
    setBusy(true);
    try {
      const c = await pickCity(item.geonameId);
      track('city_search_pick', { geonameId: item.geonameId, cityId: c.channelId, created: item.channelId == null });
      await choose(c);
    } catch {
      Alert.alert(t('loadError'));
    } finally {
      setBusy(false);
    }
  }

  /** mode=here: this is where I am (account: /me/city; guest: the device), then I browse it. */
  async function choose(item: City) {
    if (!isHere) { switchToCity(item); return; }
    try {
      if (account) await setMyCity({ channelId: item.channelId });
      else { setDetectedCity(item); markGpsCity(item.channelId); }
      track('here_set', { cityId: item.channelId, how: 'pick' });
      switchToCity(item);
    } catch (err) {
      const limit = err instanceof ApiError && err.body?.code === 'city_change_limit';
      Alert.alert(limit ? t('changeLimit') : t('loadError'));
    }
  }

  /** mode=here "Use my location": GPS sets where I am (an explicit ask: no "Switch?" sheet). */
  async function useMyLocation() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await requestFeatureLocation('challenge_proof', { correct: false });
      if (!r.ok || !r.coords) { Alert.alert(t('locationNeeded')); return; }
      const geo = await Location.reverseGeocodeAsync({ latitude: r.coords.lat, longitude: r.coords.lng }).catch(() => null);
      const c = await resolveLocation(r.coords.lat, r.coords.lng, geo?.[0]?.isoCountryCode ?? null);
      markGpsCity(c.channelId);
      setDetectedCity(c);
      if (account && c.switchFrom) await setMyCity({ channelId: c.channelId });
      track('here_set', { cityId: c.channelId, how: 'gps' });
      switchToCity(c);
    } catch (err) {
      Alert.alert(isNoCity(err) ? t('noCityNearby') : t('loadError'));
    } finally {
      setBusy(false);
    }
  }

  function switchToCity(item: City) {
    if (switchingRef.current) return; // ignore rapid double-taps
    switchingRef.current = true;
    setCity(item);
    // Picking a city from World shows that city.
    setScope('city');
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
    // mode=here: back to Today, which reloads for the new city.
    if (isHere && router.canGoBack()) { router.back(); return; }
    // replace (not push) - back shouldn't return here. First launch lands
    // on Today, the home (V3-11); a later switch returns to the city chat.
    router.replace((isFirstTime ? '/(tabs)/today' : '/(tabs)/chat') as never);
  }

  // Section label - "Top cities right now" when any city has activity, else "Cities"
  const hasActivity  = cities.some(c => (c.onlineCount ?? 0) > 0);
  const sectionLabel = query.trim() ? null : (hasActivity ? t('topCities') : t('cities'));

  // Backend-ranked top-10, pin active city first (searching shows `results` instead).
  const displayList = (() => {
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
        : <ScreenHeader title={isHere ? t('hereTitle') : t('title')} onBack={goBack} />}

      <View style={styles.search}>
        <TextField
          variant="search"
          placeholder={t('searchPlaceholder')}
          value={query}
          testID="city-search"
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          clearLabel={t('clear', { ns: 'common', defaultValue: 'Clear' })}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {/* Where I am: GPS first, then the search or a city below. */}
      {isHere && !query.trim() && (
        <RowGroup style={styles.backToLocation}>
          <ListRow icon="locate-outline" title={t('useMyLocation')} onPress={useMyLocation} />
        </RowGroup>
      )}

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
      {!isHere && !query.trim() && detectedCity && detectedCity.channelId !== activeCity?.channelId && (
        <RowGroup style={styles.backToLocation}>
          <ListRow icon="locate-outline" title={t('backToLocation')} value={localizeCityName(detectedCity.name)}
                   onPress={() => switchToCity(detectedCity)} />
        </RowGroup>
      )}

      {/* The list ends at the keyboard while searching: every result stays reachable. */}
      <KeyboardArea>
      {loading || busy || (query.trim().length >= 2 && results === null) ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : results !== null ? (
        <FlatList
          data={results}
          keyExtractor={(r) => String(r.geonameId)}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => <SearchResultRow item={item} onPress={() => pickResult(item)} />}
          contentContainerStyle={results.length === 0 ? styles.flex1 : styles.listContent}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>{t('noResults', { query })}</Text>
            </View>
          }
        />
      ) : error ? (
        <View style={styles.center}>
          <WakingUp onRetry={() => load(filter)} />
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
              onPress={() => choose(item)}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(filter, true)}
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={sectionLabel && query.trim().length < 2 ? (
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
      </KeyboardArea>
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
  sectionLabel:   { fontSize: FontSizes.md, fontWeight: '800', color: c.text, paddingTop: 6, paddingBottom: 8 },
  listContent:    { paddingHorizontal: Spacing.md, paddingBottom: Spacing.xl },
  cardTouch:      { marginBottom: 10 },
  card:           { paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  cardActive:     { borderColor: c.primary },
  cardTop:        { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cityName:       { flex: 1, fontSize: 15, fontWeight: '700', color: c.text },
  statsRow:       { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 2, paddingLeft: 16 },
  stat:           { fontSize: FontSizes.xs, fontWeight: '600', color: c.muted },
  statStrong:     { fontSize: FontSizes.xs, fontWeight: '700', color: c.primaryText },
  statOnline:     { fontSize: FontSizes.xs, fontWeight: '700', color: c.green },
  playsIn:        { paddingLeft: 26 },
  activityDot:    { width: 8, height: 8, borderRadius: Radius.full, backgroundColor: c.line },
  activityDotLive:{ backgroundColor: c.green },
});
