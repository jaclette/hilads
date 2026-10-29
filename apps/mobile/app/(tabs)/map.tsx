import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Camera, CircleLayer, Images, LineLayer, LocationPuck, MapView, MarkerView, ShapeSource, SymbolLayer, type MapState } from '@rnmapbox/maps';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { SeasonalMapSky } from '@/features/event/SeasonalArt';
import { useEventFeature } from '@/features/event/seasonal';
import { EVENT_CARD } from '@/features/event/EventFrame';
import { useApp } from '@/context/AppContext';
import { useScope, type Scope } from '@/context/ScopeContext';
import { track } from '@/services/analytics';
import { useDailyToday } from '@/hooks/useDaily';
import { requestFeatureLocation } from '@/lib/geoFeature';
import { CITY_ZOOM, MAP_STYLE, MIN_ZOOM, WORLD_HIDDEN_LAYERS, WORLD_MIN_ZOOM, WORLD_ZOOM, setupMapbox } from '@/lib/mapbox';
import { openDirections } from '@/lib/directions';
import { fetchMap, fetchMapCities, fetchSpot, searchSpots, type Bbox, type MapCity, type PlanPin, type Spot } from '@/api/spots';
import { THEME_KEYS, isPlaceTheme, themeName } from '@/features/daily/themes';
import { meters, pinLabel } from '@/features/today/format';
import { ThemeIcon } from '@/ui/ThemeIcon';
import { themeColor } from '@/ui/joy';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { SpotSheet } from '@/features/map/SpotSheet';
import { ShareSheet } from '@/features/share/ShareSheet';
import { spotShare, type ShareContent } from '@/features/share/content';
import { EmptyCity } from '@/features/map/EmptyCity';
import { SpotList, type SpotSort } from '@/features/map/SpotList';
import { ScopeSelector } from '@/features/shell/ScopeSelector';
import { shortCityName } from '@/i18n/cityName';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DailyThemeKey } from '@/types';
import { Chip, CityFlag, IconButton, TextField } from '@/ui';
import { useBackClose } from '@/lib/useBackClose';

const PLACE_THEMES = THEME_KEYS.filter(k => isPlaceTheme(k));
const IDLE_DEBOUNCE_MS = 400;
// Farther than this from the city's centre, my position is not "in" the city (Spots::AWAY_M).
const CITY_RADIUS_M = 30_000;
// Pin labels from this zoom (the city view), where they stay readable; Mapbox
// hides the ones that would collide, the pins stay.
const LABEL_MIN_ZOOM = 13.5;
// Tap target around a pin, in points (SPEC: 44 minimum).
const PIN_HITBOX = { width: 44, height: 44 };
/** A pin's color: its theme's (the ring color when the fill is too pale on the map), as on the filter chips. */
const pinColor = (k: string) => { const c = themeColor(k); return c.line ?? c.fill; };
/** Clusters count their spots per theme and wear the color of the theme they have most of. */
const CLUSTER_PROPS = Object.fromEntries(THEME_KEYS.filter(k => isPlaceTheme(k)).map(k => [k, ['+', ['case', ['==', ['get', 'theme'], k], 1, 0]]]));
const CLUSTER_COLOR = ['case',
  ...THEME_KEYS.filter(k => isPlaceTheme(k)).flatMap(k => [
    ['all', ...THEME_KEYS.filter(j => isPlaceTheme(j) && j !== k).map(j => ['>=', ['get', k], ['get', j]])], pinColor(k),
  ]),
  '#C9501A'];
const PIN_RADIUS = 11;
/** The event's filter (Halloween first): the spots of special-day photos, as pumpkin pins. */
const SPECIAL = 'special';
const PUMPKIN = EVENT_CARD.halloween.accent;
/** The "Today" pins breathe: their halo grows and fades every 1.2 s. */
const PULSE_MS = 1200;
// The last view (map or list), remembered on the device.
const VIEW_KEY = 'hilads_map_view';

/** [sw, ne] around some spots, or null without any. */
function spotsFrame(spots: Spot[]): [[number, number], [number, number]] | null {
  if (spots.length === 0) return null;
  const lngs = spots.map(s => s.lng), lats = spots.map(s => s.lat);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}


/**
 * MAP (SPEC 9.5, map.html): the spots locals chose, never a third-party
 * catalog. The scope selector next to the search (the same as Today's: a city
 * centres the map on it, World zooms out to one bubble per city, flag and spot
 * count, a bubble opens its city), clustered spot pins, Hi plans as dated pins
 * (city scope), my position when location is allowed, a search over spot
 * names and dish tags, theme chips (today's flagged), the selected spot's
 * card, locate-me (back to my position and my city), and an empty-city card.
 * Readable without an account. ?spot=<id> selects a spot.
 */
export default function MapScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors, theme: uiTheme } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ spot?: string; source?: string; theme?: string }>();
  const { city } = useApp();
  const { scope, setScope } = useScope();
  const today = useDailyToday(city?.channelId);
  const hasToken = useMemo(() => setupMapbox(), []);

  const cameraRef = useRef<Camera>(null);
  const sourceRef = useRef<ShapeSource>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBbox  = useRef<Bbox | null>(null);
  const centered  = useRef(false);

  const [themeFilter, setThemeFilter] = useState<DailyThemeKey | typeof SPECIAL | null>(null);
  const mapEvent = useEventFeature('mapPins');
  const pumpkins = mapEvent?.key === 'halloween';
  // The event ended (or its map switch went off) while its filter was on: back to all.
  useEffect(() => { if (!pumpkins && themeFilter === SPECIAL) setThemeFilter(null); }, [pumpkins, themeFilter]);
  // "Today": only the spots of today's challenge photos (a chip before the themes).
  const [todayOnly, setTodayOnly] = useState(false);
  const reduceMotion = useReducedMotion();
  const [pulse, setPulse] = useState(false);
  // The pins grow in once, when the first spots arrive.
  const [grown, setGrown] = useState(false);
  // ?theme=<key> (the challenge screen's "Places pinned"): open on that theme's spots.
  useEffect(() => {
    const k = params.theme as DailyThemeKey | undefined;
    if (k && PLACE_THEMES.includes(k)) setThemeFilter(k);
  }, [params.theme]);
  const [spots, setSpots]       = useState<Spot[]>([]);
  const [plans, setPlans]       = useState<PlanPin[]>([]);
  const [center, setCenter]     = useState<[number, number] | null>(null);
  // The city's spots as [sw, ne] (first load): where to look without my position.
  const [cityFrame, setCityFrame] = useState<[[number, number], [number, number]] | null>(null);
  const [loaded, setLoaded]     = useState(false);
  const [cityEmpty, setCityEmpty] = useState(false);
  const [selected, setSelected] = useState<Spot | null>(null);
  // The selected spot's card is a layer over the map: Android back closes it first.
  useBackClose(selected !== null, () => setSelected(null));
  const [share, setShare]       = useState<ShareContent | null>(null);
  const [me, setMe]             = useState<[number, number] | null>(null);
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState<Spot[] | null>(null);
  const [notice, setNotice]     = useState<string | null>(null);
  const [view, setView]         = useState<'map' | 'list'>('map');
  const [sort, setSort]         = useState<SpotSort>('near');
  const [topH, setTopH]         = useState(0);
  const [zoom, setZoom]         = useState(CITY_ZOOM);
  const [bubbles, setBubbles]   = useState<MapCity[]>([]);
  // A scope change made by locate-me: the camera goes to me, not to the city.
  const scopeByLocate = useRef(false);
  // World scope zoomed out: city bubbles instead of pins, no base labels or borders.
  const worldView = scope === 'world' && zoom < MIN_ZOOM;

  const cityId = city?.channelId ?? null;
  const todayTheme = today.data?.challenge?.theme?.key ?? null;
  const todayDate = today.data?.challenge?.date ?? null;
  useEffect(() => {
    if (!todayOnly || reduceMotion) { setPulse(false); return; }
    const id = setInterval(() => setPulse(p => !p), PULSE_MS);
    return () => clearInterval(id);
  }, [todayOnly, reduceMotion]);
  useEffect(() => {
    if (grown || spots.length === 0) return;
    const id = setTimeout(() => setGrown(true), reduceMotion ? 0 : 50);
    return () => clearTimeout(id);
  }, [spots.length, grown, reduceMotion]);

  useEffect(() => {
    AsyncStorage.getItem(VIEW_KEY).then(v => { if (v === 'list' || v === 'map') setView(v); }).catch(() => {});
  }, []);
  const toggleView = () => {
    const next = view === 'map' ? 'list' : 'map';
    setView(next);
    setSelected(null);
    track('map_view_switched', { view: next });
    AsyncStorage.setItem(VIEW_KEY, next).catch(() => {});
  };

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
      if (themeFilter === null) setCityFrame(spotsFrame(d.spots));
      setCityEmpty(themeFilter === null && d.spots.length === 0);
      if (!lastBbox.current) { setSpots(d.spots); setPlans(scope === 'city' ? d.plans : []); }
      setLoaded(true);
    }).catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [cityId, themeFilter, scope]);

  // The city on the map: its spots, else its centre.
  const flyToCity = useCallback((duration = 800) => {
    if (cityFrame && !(cityFrame[0][0] === cityFrame[1][0] && cityFrame[0][1] === cityFrame[1][1])) {
      cameraRef.current?.fitBounds(cityFrame[1], cityFrame[0], [insets.top + 150, 48, 220, 48], duration);
    } else if (cityFrame || center) {
      cameraRef.current?.setCamera({ centerCoordinate: cityFrame ? cityFrame[0] : center!, zoomLevel: CITY_ZOOM, animationDuration: duration });
    }
  }, [cityFrame, center, insets.top]);

  // Centre once: on me when I am in the city, else on the city's spots (a
  // city's stored centre can be kilometres from them), else on the city.
  useEffect(() => {
    if (centered.current || !cameraRef.current) return;
    if (scope === 'world') {
      centered.current = true;
      cameraRef.current.setCamera({ centerCoordinate: [(center ?? me ?? [106.7, 10.8])[0], 20], zoomLevel: WORLD_ZOOM, animationDuration: 0 });
      return;
    }
    if (!me && !center) return;
    if (cityId && !loaded) return;   // wait for the city (centre and spots): am I in it?
    const meHere = me && center && meters(me, center) <= CITY_RADIUS_M ? me : null;
    centered.current = true;
    if (meHere) {
      cameraRef.current.setCamera({ centerCoordinate: meHere, zoomLevel: CITY_ZOOM, animationDuration: 0 });
      return;
    }
    // A short animation: a 0 ms fitBounds before the map's first layout is dropped.
    flyToCity(300);
  }, [me, center, insets.top, scope, cityId, loaded, flyToCity]);


  // A scope change (here or in another tab): a city centres the map on it, World zooms out.
  const lastScope = useRef<Scope>(scope);
  useEffect(() => {
    if (lastScope.current === scope) return;
    lastScope.current = scope;
    setSelected(null);
    if (scopeByLocate.current) { scopeByLocate.current = false; return; }
    if (scope === 'world') {
      // Around my city's longitude, where its bubble and its neighbours are.
      cameraRef.current?.setCamera({ centerCoordinate: [center?.[0] ?? 0, 20], zoomLevel: WORLD_ZOOM, animationDuration: 900 });
    } else {
      flyToCity();
    }
  }, [scope, center, flyToCity]);

  // World: one bubble per city with spots (in the theme).
  useEffect(() => {
    if (scope !== 'world') return;
    let alive = true;
    fetchMapCities(themeFilter).then(r => { if (alive) setBubbles(r.items); }).catch(() => {});
    return () => { alive = false; };
  }, [scope, themeFilter]);

  // A bubble opens its city: framed on its spots (its stored centre can be kilometres away).
  const openBubble = (b: MapCity) => {
    track('map_city_bubble_tapped', { city: b.city.name, spots: b.spots });
    fetchMap({ cityId: b.city.id, theme: themeFilter }).then(d => {
      const frame = spotsFrame(d.spots);
      if (frame && !(frame[0][0] === frame[1][0] && frame[0][1] === frame[1][1])) {
        cameraRef.current?.fitBounds(frame[1], frame[0], [insets.top + 150, 48, 220, 48], 1200);
      } else {
        cameraRef.current?.setCamera({ centerCoordinate: frame ? frame[0] : [b.city.lng, b.city.lat], zoomLevel: CITY_ZOOM + (frame ? 1 : 0), animationDuration: 1200 });
      }
    }).catch(() => cameraRef.current?.setCamera({ centerCoordinate: [b.city.lng, b.city.lat], zoomLevel: CITY_ZOOM, animationDuration: 1200 }));
  };

  const loadArea = useCallback((bbox: Bbox) => {
    // The whole world: the bubbles say it, no pins to load.
    if (scope === 'world' && bbox[2] - bbox[0] > 40) return;
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
    setZoom(state.properties.zoom);
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

  const pickTheme = (k: DailyThemeKey | typeof SPECIAL | null) => {
    setThemeFilter(k);
    setTodayOnly(false);
    setSelected(null);
    track('map_filter_used', { theme: k ?? 'all', is_today: k !== null && k === todayTheme });
  };

  // Back to my position and my city (World scope switches to the city).
  const pickToday = () => {
    setThemeFilter(null);
    setTodayOnly(true);
    setSelected(null);
    track('map_filter_used', { theme: 'today', is_today: true });
  };

  const locate = async () => {
    const res = await requestFeatureLocation('map_locate');
    if (!res.ok || !res.coords) {
      setNotice(res.permanentlyDenied || res.reason === 'denied' ? t('map.locationDenied') : t('map.locationFailed'));
      setTimeout(() => setNotice(null), 4000);
      if (scope === 'world' && city) setScope('city');
      return;
    }
    const pos: [number, number] = [res.coords.lng, res.coords.lat];
    setMe(pos);
    if (scope === 'world' && city) { scopeByLocate.current = true; setScope('city'); }
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

  // Today's spots: a photo of today's challenge (the spot's latest challenge is today's).
  const isToday = (s: Spot) => !!todayDate && s.lastProofDate === todayDate;
  const shown = todayOnly ? spots.filter(isToday) : spots;
  const shape = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: worldView ? [] : shown.filter(s => s.id !== selected?.id).map(s => ({
      type: 'Feature', id: s.id,
      // rank: lower is placed first when labels collide (most proofs, then votes).
      // pick: a Hilads pick (editorial) gets its own pin: gold with a star.
      // img: the cover's round photo, shown before the label.
      // theme: the pin's color (the filter's theme, else the spot's first); today: a photo of today's challenge.
      properties: { id: s.id, label: pinLabel(s.name, s.priceRange, i18n.language), rank: -(s.proofCount * 1000 + s.votes), pick: !!s.pick,
                    img: s.cover.pinUrl ? `pin-${s.id}` : '', theme: themeFilter ?? s.themes[0] ?? 'taste', today: isToday(s) },
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
    })),
  }), [spots, selected?.id, i18n.language, worldView, todayOnly, todayDate, themeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // The pin photos (216 px PNGs, drawn at 72 pt).
  const pinImages = useMemo(() => Object.fromEntries(
    spots.filter(s => s.cover.pinUrl).map(s => [`pin-${s.id}`, { url: `${s.cover.pinUrl}&s=216`, scale: 3 }]),
  ), [spots]);

  if (!hasToken) {
    return <View style={[styles.container, styles.center]}><Text style={styles.muted}>{t('map.noToken')}</Text></View>;
  }

  const showEmpty = loaded && cityEmpty && scope === 'city' && !selected && spots.length === 0;
  // The list shares the map's state: the search hits (in the theme) or the area's spots.
  const listSpots = results !== null ? results.filter(s => themeFilter === null || themeFilter === SPECIAL || s.themes.includes(themeFilter)) : shown;
  const bboxCentre: [number, number] | null = lastBbox.current
    ? [(lastBbox.current[0] + lastBbox.current[2]) / 2, (lastBbox.current[1] + lastBbox.current[3]) / 2] : center;

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
        <Camera ref={cameraRef} minZoomLevel={scope === 'world' ? WORLD_MIN_ZOOM : MIN_ZOOM} defaultSettings={{ centerCoordinate: center ?? [106.7009, 10.7769], zoomLevel: CITY_ZOOM }} />
        {me && <LocationPuck visible puckBearingEnabled={false} pulsing={{ isEnabled: false }} />}

        <ShapeSource id="spots" ref={sourceRef} shape={shape} cluster clusterRadius={44} clusterMaxZoomLevel={15} hitbox={PIN_HITBOX} onPress={onSourcePress}
                     clusterProperties={CLUSTER_PROPS}>
          <CircleLayer id="spot-clusters" filter={['has', 'point_count']} style={{
            circleColor: CLUSTER_COLOR as never, circleRadius: grown ? 20 : 0, circleRadiusTransition: { duration: 350, delay: 0 },
            circleStrokeColor: '#FFFFFF', circleStrokeWidth: 2.5,
          }} />
          {/* Today's photos: a soft halo that breathes under the pin. */}
          <CircleLayer id="spot-today-halo" filter={['all', ['!', ['has', 'point_count']], ['get', 'today']]} style={{
            circleColor: pinColor(todayTheme ?? 'taste'), circleRadius: todayOnly ? (pulse ? 24 : 15) : 0,
            circleOpacity: todayOnly ? (pulse ? 0 : 0.45) : 0,
            circleRadiusTransition: { duration: PULSE_MS, delay: 0 }, circleOpacityTransition: { duration: PULSE_MS, delay: 0 },
          }} />
          <SymbolLayer id="spot-cluster-count" filter={['has', 'point_count']} style={{
            textField: ['get', 'point_count_abbreviated'], textColor: '#FFFFFF', textSize: 15, textAllowOverlap: true, textIgnorePlacement: true,
          }} />
          <CircleLayer id="spot-pins" filter={['!', ['has', 'point_count']]} style={{
            // A pin wears its theme's color; a Hilads pick stays gold with its star.
            circleColor: ['case', ['get', 'pick'], colors.gold, ['match', ['get', 'theme'],
              ...PLACE_THEMES.flatMap(k => [k, pinColor(k)]), SPECIAL, PUMPKIN, colors.primary]] as never,
            circleRadius: grown ? PIN_RADIUS : 0, circleRadiusTransition: { duration: 350, delay: 0 },
            circleStrokeColor: ['case', ['==', ['get', 'theme'], SPECIAL], '#4A1F5E', '#FFFFFF'] as never, circleStrokeWidth: 2.5,
          }} />
          <SymbolLayer id="spot-pick-stars" filter={['all', ['!', ['has', 'point_count']], ['get', 'pick']]} style={{
            textField: '★', textColor: '#FFFFFF', textSize: 13, textAllowOverlap: true, textIgnorePlacement: true,
          }} />
          {/* A spot with a photo: the round photo, then its label, on the pin's right. */}
          <SymbolLayer id="spot-labels-photo" filter={['all', ['!', ['has', 'point_count']], ['!=', ['get', 'img'], '']]} minZoomLevel={LABEL_MIN_ZOOM} style={{
            iconImage: ['get', 'img'], iconAnchor: 'left', iconOffset: [16, 0],
            textField: ['get', 'label'], textSize: 12, textColor: colors.text, textHaloColor: colors.bg2, textHaloWidth: 1.5,
            textAnchor: 'left', textOffset: [7.8, 0], textJustify: 'left', textMaxWidth: 20,
            textAllowOverlap: false, iconAllowOverlap: false, symbolSortKey: ['get', 'rank'],
          }} />
          <SymbolLayer id="spot-labels" filter={['all', ['!', ['has', 'point_count']], ['==', ['get', 'img'], '']]} minZoomLevel={LABEL_MIN_ZOOM} style={{
            textField: ['get', 'label'], textSize: 12, textColor: colors.text, textHaloColor: colors.bg2, textHaloWidth: 1.5,
            textVariableAnchor: ['left', 'right'], textRadialOffset: 1.3, textJustify: 'auto', textMaxWidth: 20,
            textAllowOverlap: false, textIgnorePlacement: false, symbolSortKey: ['get', 'rank'],
          }} />
        </ShapeSource>
        <Images images={pinImages} />

        {plans.slice(0, 30).map(p => <PlanMarker key={`${p.id}@${p.startsAt}`} plan={p} />)}

        {/* World view: the base style's labels and borders hidden, one bubble per city. */}
        {WORLD_HIDDEN_LAYERS.map(id => id.includes('boundary')
          ? <LineLayer key={id} id={id} existing style={{ visibility: worldView ? 'none' : 'visible' }} />
          : <SymbolLayer key={id} id={id} existing style={{ visibility: worldView ? 'none' : 'visible' }} />)}
        {worldView && bubbles.slice(0, 150).map(b => (
          <MarkerView key={b.city.id} coordinate={[b.city.lng, b.city.lat]} anchor={{ x: 0.5, y: 0.5 }} allowOverlap>
            <TouchableOpacity style={styles.bubble} onPress={() => openBubble(b)} accessibilityRole="button"
                              accessibilityLabel={t('map.cityBubbleA11y', { city: shortCityName(b.city.name), count: b.spots })}>
              <CityFlag country={b.city.country} size={16} />
              <Text style={styles.bubbleText}>{b.spots}</Text>
            </TouchableOpacity>
          </MarkerView>
        ))}

        {selected && (
          <MarkerView coordinate={[selected.lng, selected.lat]} anchor={{ x: 0.5, y: 1 }} allowOverlap>
            <View style={styles.selectedWrap} pointerEvents="none">
              <Text style={styles.selectedLabel} numberOfLines={1}>{pinLabel(selected.name, selected.priceRange, i18n.language)}</Text>
              <View style={styles.selectedPin}>
                <ThemeIcon theme={selected.themes[0] ?? 'taste'} size={22} color="#FFFFFF" />
              </View>
            </View>
          </MarkerView>
        )}
      </MapView>

      {/* List view: over the map, which stays mounted (same area, same state). */}
      {view === 'list' && (
        <SpotList
          spots={listSpots}
          sort={sort}
          onSort={k => { setSort(k); track('map_list_sorted', { sort: k }); }}
          me={me}
          origin={bboxCentre}
          onPick={s => select(s, 'map_list')}
          topInset={topH + 8}
          bottomInset={selected ? 320 : 96}
          empty={showEmpty ? null : <Text style={styles.listEmpty}>{t('map.noResults')}</Text>}
        />
      )}

      {/* A seasonal event's live day: the night sky (moon, bats) over the map. */}
      {view === 'map' && <SeasonalMapSky top={topH} />}

      {/* Top overlay: the Map's subtitle (no title bar over the map), search + theme chips. */}
      <View style={[styles.top, { paddingTop: insets.top + 10 }, view === 'list' && styles.topList]} pointerEvents="box-none"
            onLayout={e => setTopH(e.nativeEvent.layout.height)}>
        <View style={styles.searchRow}>
          <ScopeSelector style={styles.scope} />
          <View style={styles.search}>
            <TextField
              variant="search"
              value={query}
              testID="map-search"
              onChangeText={setQuery}
              placeholder={t('map.search')}
              returnKeyType="search"
              accessibilityLabel={t('map.searchA11y')}
              onClear={() => setQuery('')}
              clearLabel={t('map.clearSearch')}
            />
          </View>
        </View>
        {results !== null && view === 'map' && (
          <View style={styles.results}>
            {results.length === 0 ? <Text style={styles.resultEmpty}>{t('map.noResults')}</Text> : results.slice(0, 6).map(s => (
              <TouchableOpacity key={s.id} style={styles.result} accessibilityRole="button"
                                onPress={() => { Keyboard.dismiss(); setQuery(''); setResults(null); select(s, 'search', true); }}>
                <ThemeIcon theme={s.themes[0] ?? 'taste'} size={18} color={colors.primaryText} />
                <View style={styles.resultBody}>
                  <Text style={styles.resultName} numberOfLines={1}>{s.name}</Text>
                  {s.tags.length > 0 && <Text style={styles.resultTags} numberOfLines={1}>{s.tags.join(' · ')}</Text>}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
          <Chip variant="filter" label={t('map.all')} selected={themeFilter === null && !todayOnly} onPress={() => pickTheme(null)} />
          {!!todayDate && <Chip variant="filter" theme={todayTheme} label={t('map.todayChip')} selected={todayOnly} onPress={pickToday} />}
          {pumpkins && <Chip variant="filter" label={t('map.halloween')} selected={themeFilter === SPECIAL} onPress={() => pickTheme(SPECIAL)} />}
          {PLACE_THEMES.map(k => (
            <Chip key={k} variant="filter" theme={k} label={themeName(k)} selected={themeFilter === k} badge={k === todayTheme ? t('map.today') : null} onPress={() => pickTheme(k)} />
          ))}
        </ScrollView>
      </View>

      {!loaded && <View style={[styles.loading, { top: insets.top + 120 }]}><ActivityIndicator color={colors.primary} /></View>}

      {/* Bottom: notice, locate-me, then the selected spot or the empty city. */}
      <View style={styles.bottom} pointerEvents="box-none">
        {notice && <Text style={styles.notice}>{notice}</Text>}
        {view === 'map' && <IconButton icon="locate-outline" label={t('map.locate')} onPress={locate} style={styles.locate} />}
        <TouchableOpacity style={styles.toggle} onPress={toggleView} activeOpacity={0.85} accessibilityRole="button" testID="map-view-toggle">
          <Ionicons name={view === 'map' ? 'list-outline' : 'map-outline'} size={18} color={colors.bg} />
          <Text style={styles.toggleText}>{view === 'map' ? t('map.list') : t('map.mapView')}</Text>
        </TouchableOpacity>
        {selected ? (
          <SpotSheet
            spot={selected}
            distanceM={me ? meters(me, [selected.lng, selected.lat]) : null}
            onOpen={() => { track('spot_opened', { source: 'map_sheet', spot: selected.id, view: 'screen' }); router.push(`/spot/${selected.id}` as never); }}
            onDirections={() => openDirections(selected.lat, selected.lng)}
            onShare={() => setShare(spotShare(selected))}
            onClose={() => setSelected(null)}
            onPlayToday={selected.themes.includes(todayTheme as DailyThemeKey) && today.data?.challenge?.isActive && !today.data?.myProof
              ? () => { track('map_play_here', { spot: selected.id }); router.push('/daily/proof' as never); } : undefined}
          />
        ) : showEmpty ? (
          <EmptyCity today={today.data} />
        ) : null}
      </View>
      <ShareSheet content={share} source="spot_sheet" onClose={() => setShare(null)} />
    </View>
  );
}

/** A Hi plan as a dated pin: "Birdy, now · 10 going", "Birdy, in 2 hours". Caramel; opens the plan. */
function PlanMarker({ plan }: { plan: PlanPin }) {
  const styles = useThemedStyles(makeStyles);
  const { i18n, t } = useTranslation('daily');
  const router = useRouter();
  const start = new Date(plan.startsAt * 1000);
  const now = Date.now();
  const ongoing = plan.startsAt * 1000 <= now && (plan.endsAt ? plan.endsAt * 1000 > now : true);
  const hours = (plan.startsAt * 1000 - now) / 3_600_000;
  // Soon: relative ("in 2 hours", localized); later: the day and time.
  // Hermes on Android has no Intl.RelativeTimeFormat (new undefined → crash): the time instead.
  const time = ongoing ? t('map.planNow')
    : hours < 6 && typeof Intl.RelativeTimeFormat === 'function' ? new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' }).format(Math.max(1, Math.round(hours * (hours < 1 ? 60 : 1))), hours < 1 ? 'minute' : 'hour')
    : start.toLocaleString(i18n.language, start.toDateString() === new Date().toDateString()
        ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const going = plan.participantCount > 1 ? t('map.planGoing', { count: plan.participantCount }) : null;
  return (
    <MarkerView coordinate={[plan.lng, plan.lat]} anchor={{ x: 0.5, y: 0.5 }}>
      <TouchableOpacity style={[styles.plan, ongoing && styles.planNow]} onPress={() => router.push(`/event/${plan.id}` as never)} accessibilityRole="button"
                        accessibilityLabel={[t('map.planA11y', { title: plan.title, time }), going].filter(Boolean).join(', ')}>
        <Ionicons name={ongoing ? 'radio-button-on' : 'calendar-outline'} size={14} color="#FFFFFF" />
        <Text style={styles.planText} numberOfLines={1}>{plan.title}, {time}{going ? ` · ${going}` : ''}</Text>
      </TouchableOpacity>
    </MarkerView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container:     { flex: 1, backgroundColor: c.bg },
  center:        { alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  muted:         { fontSize: FontSizes.md, color: c.muted, textAlign: 'center' },
  top:           { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: Spacing.md, gap: 10, paddingBottom: 10,
                   backgroundColor: c.bg + 'E6', borderBottomLeftRadius: 22, borderBottomRightRadius: 22 },
  results:       { backgroundColor: c.bg2, borderRadius: 18, borderWidth: 1.5, borderColor: c.line, paddingVertical: 4 },
  result:        { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 14 },
  resultBody:    { flex: 1 },
  resultName:    { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  resultTags:    { fontSize: 12, color: c.muted },
  resultEmpty:   { fontSize: FontSizes.sm, color: c.muted, padding: 14 },
  chips:         { gap: 8, paddingRight: Spacing.md },
  searchRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scope:         { flex: 0, maxWidth: 150, height: 48 },
  search:        { flex: 1 },
  bubble:        { flexDirection: 'row', alignItems: 'center', gap: 5, height: 34, paddingHorizontal: 10, borderRadius: Radius.full,
                   backgroundColor: c.bg2, borderWidth: 2, borderColor: c.primary },
  bubbleText:    { fontSize: FontSizes.sm, fontWeight: '800', color: c.text },
  loading:       { position: 'absolute', alignSelf: 'center' },
  bottom:        { position: 'absolute', left: 8, right: 8, bottom: 12, gap: 10 },
  locate:        { alignSelf: 'flex-end', marginRight: 8 },
  topList:       { backgroundColor: c.bg, paddingBottom: 10 },
  listEmpty:     { fontSize: FontSizes.sm, color: c.muted, textAlign: 'center', padding: Spacing.lg },
  toggle:        { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 18,
                   borderRadius: Radius.full, backgroundColor: c.text },
  toggleText:    { fontSize: FontSizes.sm, fontWeight: '800', color: c.bg },
  notice:        { alignSelf: 'center', fontSize: FontSizes.xs, color: c.text, backgroundColor: c.bg2, borderRadius: 16,
                   paddingHorizontal: 14, paddingVertical: 8, overflow: 'hidden', borderWidth: 1, borderColor: c.line },
  selectedWrap:  { alignItems: 'center', gap: 6 },
  selectedLabel: { maxWidth: 220, fontSize: FontSizes.xs, fontWeight: '700', color: c.text, backgroundColor: c.bg2, borderRadius: 12,
                   borderWidth: 1.5, borderColor: c.line, paddingHorizontal: 12, paddingVertical: 6, overflow: 'hidden' },
  selectedPin:   { width: 50, height: 50, borderRadius: Radius.full, backgroundColor: c.primary, borderWidth: 4, borderColor: c.primaryTint,
                   alignItems: 'center', justifyContent: 'center' },
  plan:          { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingLeft: 10, paddingRight: 12, maxWidth: 240,
                   borderRadius: Radius.full, borderWidth: 2.5, borderColor: '#FFFFFF', backgroundColor: c.caramel },
  planNow:       { backgroundColor: c.primary },
  planText:      { flexShrink: 1, fontSize: FontSizes.xs, fontWeight: '700', color: '#FFFFFF' },
});
