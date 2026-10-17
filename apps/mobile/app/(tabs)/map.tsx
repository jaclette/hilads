import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, ScrollView, Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Camera, CircleLayer, LocationPuck, MapView, MarkerView, ShapeSource, SymbolLayer, type MapState } from '@rnmapbox/maps';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { useScope } from '@/context/ScopeContext';
import { track } from '@/services/analytics';
import { useDailyToday } from '@/hooks/useDaily';
import { requestFeatureLocation } from '@/lib/geoFeature';
import { CITY_ZOOM, MAP_STYLE, MIN_ZOOM, setupMapbox } from '@/lib/mapbox';
import { directionsUrl, openMapsUrl } from '@/lib/directions';
import { fetchMap, fetchSpot, searchSpots, type Bbox, type PlanPin, type Spot } from '@/api/spots';
import { THEME_KEYS, THEME_NAMES } from '@/features/daily/themes';
import { THEME_ICON } from '@/features/today/format';
import { SpotSheet } from '@/features/map/SpotSheet';
import { EmptyCity } from '@/features/map/EmptyCity';
import type { DailyThemeKey } from '@/types';

const PLACE_THEMES = THEME_KEYS.filter(k => k !== 'language');
const IDLE_DEBOUNCE_MS = 400;

/** Great-circle distance in meters (for the selected spot's sheet). */
function meters(a: [number, number], b: [number, number]): number {
  const r = 6371000, rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * MAP (SPEC 9.5, map.html): the spots locals chose, never a third-party
 * catalog. Clustered spot pins, Hi plans as dated pins (city scope), my
 * position when location is allowed, a search over spot names and dish tags,
 * theme chips (today's flagged), the selected spot's card, locate-me, and an
 * empty-city card. Readable without an account. ?spot=<id> selects a spot.
 */
export default function MapScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors, theme: uiTheme } = useTheme();
  const { t } = useTranslation('daily');
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ spot?: string; source?: string }>();
  const { city } = useApp();
  const { scope } = useScope();
  const today = useDailyToday(city?.channelId);
  const hasToken = useMemo(() => setupMapbox(), []);

  const cameraRef = useRef<Camera>(null);
  const sourceRef = useRef<ShapeSource>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBbox  = useRef<Bbox | null>(null);
  const centered  = useRef(false);

  const [themeFilter, setThemeFilter] = useState<DailyThemeKey | null>(null);
  const [spots, setSpots]       = useState<Spot[]>([]);
  const [plans, setPlans]       = useState<PlanPin[]>([]);
  const [center, setCenter]     = useState<[number, number] | null>(null);
  const [loaded, setLoaded]     = useState(false);
  const [cityEmpty, setCityEmpty] = useState(false);
  const [selected, setSelected] = useState<Spot | null>(null);
  const [me, setMe]             = useState<[number, number] | null>(null);
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState<Spot[] | null>(null);
  const [notice, setNotice]     = useState<string | null>(null);

  const cityId = city?.channelId ?? null;
  const todayTheme = today.data?.challenge?.theme?.key ?? null;

  // map_viewed once per focus, with where it was opened from.
  useFocusEffect(useCallback(() => {
    track('map_viewed', { source: params.source ?? (params.spot ? 'spot_link' : 'tab'), scope, city: city?.name ?? null });
  }, [params.source, params.spot, scope, city?.name]));

  // My position, only when location is already allowed (the map never asks by itself).
  useFocusEffect(useCallback(() => {
    Location.getForegroundPermissionsAsync().then(async p => {
      if (!p.granted) return;
      const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 });
      if (last) setMe([last.coords.longitude, last.coords.latitude]);
    }).catch(() => {});
  }, []));

  // The city's spots and centre (first load, city or theme change).
  useEffect(() => {
    let alive = true;
    setLoaded(false);
    fetchMap({ cityId, theme: themeFilter }).then(d => {
      if (!alive) return;
      if (d.city) setCenter([d.city.lng, d.city.lat]);
      setCityEmpty(themeFilter === null && d.spots.length === 0);
      if (!lastBbox.current) { setSpots(d.spots); setPlans(scope === 'city' ? d.plans : []); }
      setLoaded(true);
    }).catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [cityId, themeFilter, scope]);

  // Centre once: on me when known, else on the city.
  useEffect(() => {
    if (centered.current || !cameraRef.current) return;
    const target = me ?? center;
    if (!target) return;
    centered.current = true;
    cameraRef.current.setCamera({ centerCoordinate: target, zoomLevel: CITY_ZOOM, animationDuration: 0 });
  }, [me, center]);

  const loadArea = useCallback((bbox: Bbox) => {
    fetchMap({ bbox, cityId: scope === 'city' ? cityId : null, theme: themeFilter })
      .then(d => { setSpots(d.spots); setPlans(scope === 'city' ? d.plans : []); })
      .catch(() => {});
  }, [cityId, scope, themeFilter]);

  // Reload the area when the theme or scope changes.
  useEffect(() => { if (lastBbox.current) loadArea(lastBbox.current); }, [loadArea]);

  const onIdle = useCallback((state: MapState) => {
    const { ne, sw } = state.properties.bounds;
    const bbox: Bbox = [sw[0], sw[1], ne[0], ne[1]];
    lastBbox.current = bbox;
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => loadArea(bbox), IDLE_DEBOUNCE_MS);
  }, [loadArea]);

  const select = useCallback((spot: Spot, source: string, fly = false) => {
    setSelected(spot);
    track('spot_opened', { source, spot: spot.id, view: 'sheet' });
    if (fly) cameraRef.current?.setCamera({ centerCoordinate: [spot.lng, spot.lat], zoomLevel: Math.max(CITY_ZOOM + 1, 15), animationDuration: 600 });
  }, []);

  // ?spot=<id> (from Today or a spot screen): select it and fly to it, once per id.
  const handledSpot = useRef<string | null>(null);
  useEffect(() => {
    const id = params.spot;
    if (!id || handledSpot.current === id) return;
    handledSpot.current = id;
    centered.current = true;
    const known = spots.find(x => x.id === id);
    if (known) { select(known, params.source ?? 'link', true); return; }
    fetchSpot(id).then(d => select(d.spot, params.source ?? 'link', true)).catch(() => {});
  }, [params.spot, params.source, spots, select]);

  // Search, debounced.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults(null); return; }
    const id = setTimeout(() => {
      searchSpots(q, { cityId: scope === 'city' ? cityId : null, bbox: scope === 'world' ? lastBbox.current : null })
        .then(r => setResults(r.items)).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(id);
  }, [query, cityId, scope]);

  const pickTheme = (k: DailyThemeKey | null) => {
    setThemeFilter(k);
    setSelected(null);
    track('map_filter_used', { theme: k ?? 'all', is_today: k !== null && k === todayTheme });
  };

  const locate = async () => {
    const res = await requestFeatureLocation('map_locate');
    if (!res.ok || !res.coords) {
      setNotice(res.permanentlyDenied || res.reason === 'denied' ? t('map.locationDenied') : t('map.locationFailed'));
      setTimeout(() => setNotice(null), 4000);
      return;
    }
    const pos: [number, number] = [res.coords.lng, res.coords.lat];
    setMe(pos);
    cameraRef.current?.setCamera({ centerCoordinate: pos, zoomLevel: Math.max(CITY_ZOOM, 14), animationDuration: 600 });
  };

  const onSourcePress = async (e: { features: GeoJSON.Feature[] }) => {
    const f = e.features[0];
    if (!f || f.geometry.type !== 'Point') return;
    const coords = f.geometry.coordinates as [number, number];
    if (f.properties?.cluster) {
      try {
        const zoom = await sourceRef.current?.getClusterExpansionZoom(f);
        cameraRef.current?.setCamera({ centerCoordinate: coords, zoomLevel: (zoom ?? CITY_ZOOM) + 0.5, animationDuration: 500 });
      } catch { /* ignore */ }
      return;
    }
    const s = spots.find(x => x.id === f.properties?.id);
    if (s) select(s, 'map_pin');
  };

  const shape = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: spots.filter(s => s.id !== selected?.id).map(s => ({
      type: 'Feature', id: s.id, properties: { id: s.id },
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
    })),
  }), [spots, selected?.id]);

  if (!hasToken) {
    return <View style={[styles.container, styles.center]}><Text style={styles.muted}>{t('map.noToken')}</Text></View>;
  }

  const showEmpty = loaded && cityEmpty && scope === 'city' && !selected && spots.length === 0;

  return (
    <View style={styles.container}>
      <MapView
        style={StyleSheet.absoluteFill}
        styleURL={uiTheme === 'dark' ? MAP_STYLE.dark : MAP_STYLE.light}
        scaleBarEnabled={false}
        compassEnabled={false}
        logoPosition={{ bottom: 8, left: 10 }}
        attributionPosition={{ bottom: 8, left: 96 }}
        onMapIdle={onIdle}
        onPress={() => { Keyboard.dismiss(); setSelected(null); }}
      >
        <Camera ref={cameraRef} minZoomLevel={MIN_ZOOM} defaultSettings={{ centerCoordinate: center ?? [106.7009, 10.7769], zoomLevel: CITY_ZOOM }} />
        {me && <LocationPuck visible puckBearingEnabled={false} pulsing={{ isEnabled: false }} />}

        <ShapeSource id="spots" ref={sourceRef} shape={shape} cluster clusterRadius={44} clusterMaxZoomLevel={15} onPress={onSourcePress}>
          <CircleLayer id="spot-clusters" filter={['has', 'point_count']} style={{
            circleColor: colors.primaryOnTint, circleRadius: 20, circleStrokeColor: '#FFFFFF', circleStrokeWidth: 2.5,
          }} />
          <SymbolLayer id="spot-cluster-count" filter={['has', 'point_count']} style={{
            textField: ['get', 'point_count_abbreviated'], textColor: '#FFFFFF', textSize: 15, textAllowOverlap: true, textIgnorePlacement: true,
          }} />
          <CircleLayer id="spot-pins" filter={['!', ['has', 'point_count']]} style={{
            circleColor: colors.primary, circleRadius: 11, circleStrokeColor: '#FFFFFF', circleStrokeWidth: 2.5,
          }} />
        </ShapeSource>

        {plans.slice(0, 30).map(p => <PlanMarker key={`${p.id}@${p.startsAt}`} plan={p} />)}

        {selected && (
          <MarkerView coordinate={[selected.lng, selected.lat]} anchor={{ x: 0.5, y: 1 }} allowOverlap>
            <View style={styles.selectedWrap} pointerEvents="none">
              <Text style={styles.selectedLabel} numberOfLines={1}>{selected.name}</Text>
              <View style={styles.selectedPin}>
                <Ionicons name={THEME_ICON[selected.themes[0] ?? 'street_food']} size={22} color="#FFFFFF" />
              </View>
            </View>
          </MarkerView>
        )}
      </MapView>

      {/* Top overlay: search + theme chips. */}
      <View style={[styles.top, { paddingTop: insets.top + 10 }]} pointerEvents="box-none">
        <View style={styles.search}>
          <Ionicons name="search-outline" size={20} color={colors.muted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder={t('map.search')}
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            accessibilityLabel={t('map.searchA11y')}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('map.clearSearch')}>
              <Ionicons name="close-circle" size={20} color={colors.muted} />
            </TouchableOpacity>
          )}
        </View>
        {results !== null && (
          <View style={styles.results}>
            {results.length === 0 ? <Text style={styles.resultEmpty}>{t('map.noResults')}</Text> : results.slice(0, 6).map(s => (
              <TouchableOpacity key={s.id} style={styles.result} accessibilityRole="button"
                                onPress={() => { Keyboard.dismiss(); setQuery(''); setResults(null); select(s, 'search', true); }}>
                <Ionicons name={THEME_ICON[s.themes[0] ?? 'street_food']} size={18} color={colors.primaryText} />
                <View style={styles.resultBody}>
                  <Text style={styles.resultName} numberOfLines={1}>{s.name}</Text>
                  {s.tags.length > 0 && <Text style={styles.resultTags} numberOfLines={1}>{s.tags.join(' · ')}</Text>}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
          <Chip label={t('map.all')} active={themeFilter === null} onPress={() => pickTheme(null)} />
          {PLACE_THEMES.map(k => (
            <Chip key={k} label={THEME_NAMES[k]} active={themeFilter === k} today={k === todayTheme ? t('map.today') : null} onPress={() => pickTheme(k)} />
          ))}
        </ScrollView>
      </View>

      {!loaded && <View style={[styles.loading, { top: insets.top + 120 }]}><ActivityIndicator color={colors.primary} /></View>}

      {/* Bottom: notice, locate-me, then the selected spot or the empty city. */}
      <View style={styles.bottom} pointerEvents="box-none">
        {notice && <Text style={styles.notice}>{notice}</Text>}
        <TouchableOpacity style={styles.locate} onPress={locate} accessibilityRole="button" accessibilityLabel={t('map.locate')}>
          <Ionicons name="locate-outline" size={22} color={colors.text} />
        </TouchableOpacity>
        {selected ? (
          <SpotSheet
            spot={selected}
            distanceM={me ? meters(me, [selected.lng, selected.lat]) : null}
            onOpen={() => { track('spot_opened', { source: 'map_sheet', spot: selected.id, view: 'screen' }); router.push(`/spot/${selected.id}` as never); }}
            onDirections={() => openMapsUrl(directionsUrl(selected.lat, selected.lng, selected.name))}
            onClose={() => setSelected(null)}
          />
        ) : showEmpty ? (
          <EmptyCity today={today.data} />
        ) : null}
      </View>
    </View>
  );
}

function Chip({ label, active, today, onPress }: { label: string; active: boolean; today?: string | null; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity style={[styles.chip, active && styles.chipOn]} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }}>
      <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
      {!!today && <Text style={[styles.chipToday, active && styles.chipTodayOn]}>{today}</Text>}
    </TouchableOpacity>
  );
}

/** A Hi plan as a dated pin: "Birdy, 6 PM" in caramel. Opens the plan. */
function PlanMarker({ plan }: { plan: PlanPin }) {
  const styles = useThemedStyles(makeStyles);
  const { i18n, t } = useTranslation('daily');
  const router = useRouter();
  const start = new Date(plan.startsAt * 1000);
  const sameDay = start.toDateString() === new Date().toDateString();
  const time = start.toLocaleString(i18n.language, sameDay ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return (
    <MarkerView coordinate={[plan.lng, plan.lat]} anchor={{ x: 0.5, y: 0.5 }}>
      <TouchableOpacity style={styles.plan} onPress={() => router.push(`/event/${plan.id}` as never)} accessibilityRole="button"
                        accessibilityLabel={t('map.planA11y', { title: plan.title, time })}>
        <Ionicons name="calendar-outline" size={14} color="#FFFFFF" />
        <Text style={styles.planText} numberOfLines={1}>{plan.title}, {time}</Text>
      </TouchableOpacity>
    </MarkerView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container:     { flex: 1, backgroundColor: c.bg },
  center:        { alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  muted:         { fontSize: FontSizes.md, color: c.muted, textAlign: 'center' },
  top:           { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: Spacing.md, gap: 10 },
  search:        { flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingHorizontal: 16, borderRadius: Radius.full,
                   borderWidth: 1.5, borderColor: c.line, backgroundColor: c.bg2 },
  searchInput:   { flex: 1, fontSize: 15, fontWeight: '500', color: c.text, paddingVertical: 0 },
  results:       { backgroundColor: c.bg2, borderRadius: 18, borderWidth: 1.5, borderColor: c.line, paddingVertical: 4 },
  result:        { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 14 },
  resultBody:    { flex: 1 },
  resultName:    { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  resultTags:    { fontSize: 12, color: c.muted },
  resultEmpty:   { fontSize: FontSizes.sm, color: c.muted, padding: 14 },
  chips:         { gap: 8, paddingRight: Spacing.md },
  chip:          { height: 38, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: Radius.full,
                   borderWidth: 1.5, borderColor: c.line, backgroundColor: c.bg2 },
  chipOn:        { backgroundColor: c.primary, borderColor: c.primary },
  chipText:      { fontSize: FontSizes.sm, fontWeight: '600', color: c.text },
  chipTextOn:    { fontWeight: '700', color: c.white },
  chipToday:     { fontSize: 11, fontWeight: '700', color: c.primaryOnTint, backgroundColor: c.primaryTint, borderRadius: Radius.full,
                   paddingHorizontal: 7, paddingVertical: 2, overflow: 'hidden' },
  chipTodayOn:   { color: c.primary, backgroundColor: c.white },
  loading:       { position: 'absolute', alignSelf: 'center' },
  bottom:        { position: 'absolute', left: 8, right: 8, bottom: 12, gap: 10 },
  locate:        { alignSelf: 'flex-end', marginRight: 8, width: 44, height: 44, borderRadius: Radius.full, borderWidth: 1.5,
                   borderColor: c.line, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' },
  notice:        { alignSelf: 'center', fontSize: FontSizes.xs, color: c.text, backgroundColor: c.bg2, borderRadius: Radius.full,
                   paddingHorizontal: 14, paddingVertical: 8, overflow: 'hidden', borderWidth: 1, borderColor: c.line },
  selectedWrap:  { alignItems: 'center', gap: 6 },
  selectedLabel: { maxWidth: 220, fontSize: FontSizes.xs, fontWeight: '700', color: c.text, backgroundColor: c.bg2, borderRadius: 12,
                   borderWidth: 1.5, borderColor: c.line, paddingHorizontal: 12, paddingVertical: 6, overflow: 'hidden' },
  selectedPin:   { width: 50, height: 50, borderRadius: Radius.full, backgroundColor: c.primary, borderWidth: 4, borderColor: c.primaryTint,
                   alignItems: 'center', justifyContent: 'center' },
  plan:          { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingLeft: 10, paddingRight: 12, maxWidth: 200,
                   borderRadius: Radius.full, borderWidth: 2.5, borderColor: '#FFFFFF', backgroundColor: c.caramel },
  planText:      { fontSize: FontSizes.xs, fontWeight: '700', color: '#FFFFFF' },
});
