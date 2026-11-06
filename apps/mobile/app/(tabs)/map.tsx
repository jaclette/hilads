import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Keyboard, ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { BackgroundLayer, Camera, CircleLayer, FillLayer, Images, LineLayer, MapView, MarkerView, ShapeSource, SymbolLayer, type MapState } from '@rnmapbox/maps';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useIsFocused } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
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
import { MAP_FLAGS } from '@/features/map/mapFlags';
import { MapSheet, SHEET_PEEK, type MapSheetHandle } from '@/features/map/MapSheet';
import { ScopeSelector } from '@/features/shell/ScopeSelector';
import { shortCityName } from '@/i18n/cityName';
import type { DailyThemeKey } from '@/types';
import { Avatar, Chip, CityFlag, IconButton, TextField } from '@/ui';
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
// A photo pin: the round cover (a 72 pt image, drawn at 30 pt) inside an 18 pt ring of its theme's color.
const PHOTO_RING = 18;
const PHOTO_ICON_SIZE = 0.42;
/** The event's filter (Halloween first): the spots of special-day photos, as pumpkin pins. */
const SPECIAL = 'special';
const PUMPKIN = EVENT_CARD.halloween.accent;
/** The "Today" pins breathe: their halo grows and fades every 1.2 s. */
const PULSE_MS = 1200;
// Plans show from this zoom, where clusters have mostly broken up (they never cover a cluster).
const PLAN_MIN_ZOOM = 14;
// Collision boxes (transparent): pins, plan cards and the selected spot block the labels' placement,
// so a label never covers them (Mapbox only knows its symbols; circles and RN markers it can't see).
const BLOCKERS = {
  blockDot: require('../../assets/map/block-dot.png'),
  blockPhoto: require('../../assets/map/block-photo.png'),
  blockPlan: require('../../assets/map/block-plan.png'),
  blockPlanSide: require('../../assets/map/block-plan-side.png'),
  blockSelected: require('../../assets/map/block-selected.png'),
};
// The World view's city bubbles, as map layers (were up to 150 marker views, each a native
// view moved on every camera frame): a pill ring in the theme's primary, the pill in the card
// color, and inside it the flag and the spot count. The pills are white and recolored (sdf);
// they stretch in the middle (3x pixels) to fit the text.
const BUBBLE_IMAGES = {
  // Only @3x files: the image always resolves at scale 3, so the stretch columns (image pixels) hold on every phone.
  bubbleRing: { image: require('../../assets/map/bubble-pill-34.png'), sdf: true, stretchX: [[50, 55]] as [number, number][] },
  bubbleFill: { image: require('../../assets/map/bubble-pill-30.png'), sdf: true, stretchX: [[44, 49]] as [number, number][] },
};
const BUBBLE_FONT = ['DIN Pro Bold', 'Arial Unicode MS Bold'];
const BUBBLE_TEXT = ['case', ['!=', ['get', 'flag'], ''],
  ['format', ['image', ['get', 'flag']], { 'vertical-align': 'center' }, '  ', {}, ['to-string', ['get', 'spots']], {}],
  ['to-string', ['get', 'spots']]] as never;
type PlanSide = 'top' | 'bottom' | 'right' | 'left';
// Where a plan card goes, first that hides no pin: above its point, below, right, left (px boxes from the point).
const PLAN_BOXES: [PlanSide, [number, number, number, number]][] = [
  ['top', [-75, -66, 75, 0]], ['bottom', [-75, 0, 75, 66]], ['right', [0, -29, 158, 29]], ['left', [-158, -29, 0, 29]],
];
/** The side of a plan card that covers none of the spots' pins at this zoom (above when all are taken). */
function planSide(plan: { lat: number; lng: number }, spots: { lat: number; lng: number }[], zoom: number): PlanSide {
  const w = 512 * 2 ** zoom;
  const px = (lng: number, lat: number) => {
    const s = Math.sin((lat * Math.PI) / 180);
    return [((lng + 180) / 360) * w, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * w];
  };
  const [x0, y0] = px(plan.lng, plan.lat);
  const near = spots.map(s => { const [x, y] = px(s.lng, s.lat); return [x - x0, y - y0]; })
    .filter(([dx, dy]) => Math.abs(dx) < 200 && Math.abs(dy) < 120 && Math.hypot(dx, dy) > 8);   // a pin on the plan's own point stays under its stem
  const pad = PHOTO_RING;
  for (const [side, [x1, y1, x2, y2]] of PLAN_BOXES) {
    if (!near.some(([dx, dy]) => dx > x1 - pad && dx < x2 + pad && dy > y1 - pad && dy < y2 + pad)) return side;
  }
  return 'top';
}
/** The Hilads palette over the standard Mapbox style (until a Studio style is set): warm land, soft water and parks, fewer POIs. */
const PALETTE = {
  light: { land: '#FBF1E6', water: '#BFE3F2', park: '#DDF0D3' },
  dark:  { land: '#1E1712', water: '#17303D', park: '#1E2A1C' },
};
const DEFAULT_STYLE = !process.env.EXPO_PUBLIC_MAPBOX_STYLE_LIGHT;

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
  const { city, account } = useApp();
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
  const sheet = useRef<MapSheetHandle>(null);
  // The sheet's measured peek: the floating buttons sit just above it.
  const [peekH, setPeekH] = useState(SHEET_PEEK);
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
    if (grown || spots.length === 0) return;
    const id = setTimeout(() => setGrown(true), reduceMotion ? 0 : 50);
    return () => clearTimeout(id);
  }, [spots.length, grown, reduceMotion]);

  // The pins drop in again when the filters change.
  const firstFilter = useRef(true);
  useEffect(() => {
    if (firstFilter.current) { firstFilter.current = false; return; }
    setGrown(false);
    const id = setTimeout(() => setGrown(true), reduceMotion ? 0 : 120);
    return () => clearTimeout(id);
  }, [themeFilter, todayOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  // map_viewed once per focus, with where it was opened from.
  useFocusEffect(useCallback(() => {
    track('map_viewed', { source: params.source ?? (params.spot ? 'spot_link' : 'tab'), scope, city: city?.name ?? null });
  }, [params.source, params.spot, scope, city?.name]));

  // My position, only when location is already allowed (the map never asks by itself).
  useFocusEffect(useCallback(() => {
    Location.getForegroundPermissionsAsync().then(async p => {
      if (!p.granted) return;
      const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 });
      // Same place (within ~10 m) as last time: keep the same value, so coming back to the map
      // doesn't re-render it and re-sort the list for nothing.
      if (last) setMe(prev => (prev && Math.abs(prev[0] - last.coords.longitude) < 1e-4 && Math.abs(prev[1] - last.coords.latitude) < 1e-4
        ? prev : [last.coords.longitude, last.coords.latitude]));
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

  // The bubbles' source: one point per city (flag image name, spot count), and the flags it uses.
  const bubbleShape = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: bubbles.map(b => {
      const cc = (b.city.country ?? '').toUpperCase();
      return {
        type: 'Feature', id: String(b.city.id), geometry: { type: 'Point', coordinates: [b.city.lng, b.city.lat] },
        properties: { id: b.city.id, spots: b.spots, flag: MAP_FLAGS[cc] ? `flag-${cc}` : '' },
      };
    }),
  }), [bubbles]);
  const bubbleImages = useMemo(() => ({
    ...BUBBLE_IMAGES,
    ...Object.fromEntries([...new Set(bubbles.map(b => (b.city.country ?? '').toUpperCase()))]
      .filter(cc => MAP_FLAGS[cc]).map(cc => [`flag-${cc}`, { image: MAP_FLAGS[cc] }])),
  }), [bubbles]);
  // Map layers can't be focused by VoiceOver / TalkBack: with a screen reader on, the World
  // view's cities are also listed in the sheet, as buttons.
  const screenReader = useScreenReader();
  const onBubblePress = (e: { features: GeoJSON.Feature[] }) => {
    const id = e.features[0]?.properties?.id;
    const b = bubbles.find(x => x.city.id === id);
    if (b) openBubble(b);
  };

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
    sheet.current?.snapTo(1);   // its card leads the sheet, at half
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
  const showPlans = zoom >= PLAN_MIN_ZOOM;
  // Zoom changes by fractions: the sides follow it in steps of a quarter level.
  const zoomStep = Math.round(zoom * 4) / 4;
  const planSides = useMemo(() => new Map(plans.slice(0, 30).map(p => [`${p.id}@${p.startsAt}`, planSide(p, shown, zoomStep)])), [plans, shown, zoomStep]);
  const blockers = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: [
      ...(showPlans ? plans.slice(0, 30).map(p => {
        const side = planSides.get(`${p.id}@${p.startsAt}`) ?? 'top';
        const anchor = side === 'top' ? 'bottom' : side === 'bottom' ? 'top' : side === 'right' ? 'left' : 'right';
        return { type: 'Feature' as const, id: `plan-${p.id}-${p.startsAt}`, geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
                 properties: { img: side === 'top' || side === 'bottom' ? 'blockPlan' : 'blockPlanSide', anchor } };
      }) : []),
      ...(selected ? [{ type: 'Feature' as const, id: 'selected', geometry: { type: 'Point' as const, coordinates: [selected.lng, selected.lat] },
                        properties: { img: 'blockSelected', anchor: 'bottom' } }] : []),
    ],
  }), [plans, planSides, showPlans, selected]);
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
  // Zoomed into a place with no spot (the city has some): "Nothing here yet. Be the pioneer 📍".
  const emptyArea = loaded && scope === 'city' && !cityEmpty && !worldView && shown.length === 0 && results === null;

  // 🎲 Surprise me: fly to a random good spot of the area (a photo and some likes first) and open its card.
  const surprise = () => {
    const pool = shown.filter(x => x.id !== selected?.id);
    const good = pool.filter(x => (x.cover.photoUrl || x.cover.thumbUrl) && x.votes > 0);
    const list = good.length ? good : pool;
    if (!list.length) return;
    const pick = list[Math.floor(Math.random() * list.length)];
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    track('map_surprise', { spot: pick.id });
    select(pick, 'surprise', true);
  };

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
        {/* Me: my avatar with a soft pulse (V6), instead of the blue dot. */}
        {me && (
          <MarkerView coordinate={me} anchor={{ x: 0.5, y: 0.5 }} allowOverlap>
            <MeMarker photo={account?.thumbAvatarUrl ?? account?.profile_photo_url ?? null} name={account?.display_name ?? ''} pulse={!reduceMotion} />
          </MarkerView>
        )}
        {/* The Hilads palette over the standard style: warm land, soft water and parks. */}
        {DEFAULT_STYLE && <BackgroundLayer id="land" existing style={{ backgroundColor: PALETTE[uiTheme === 'dark' ? 'dark' : 'light'].land }} />}
        {DEFAULT_STYLE && <FillLayer id="water" existing style={{ fillColor: PALETTE[uiTheme === 'dark' ? 'dark' : 'light'].water }} />}
        {DEFAULT_STYLE && <FillLayer id="landuse" existing style={{ fillColor: PALETTE[uiTheme === 'dark' ? 'dark' : 'light'].park, fillOpacity: 0.9 }} />}

        <ShapeSource id="spots" ref={sourceRef} shape={shape} cluster clusterRadius={44} clusterMaxZoomLevel={15} hitbox={PIN_HITBOX} onPress={onSourcePress}
                     clusterProperties={CLUSTER_PROPS}>
          {/* Clusters look like a little stack: a second disc peeking out behind. */}
          <CircleLayer id="spot-clusters-back" filter={['has', 'point_count']} style={{
            circleColor: CLUSTER_COLOR as never, circleOpacity: 0.45, circleRadius: grown ? 20 : 0, circleTranslate: [6, -6],
            circleRadiusTransition: { duration: 350, delay: 0 }, circleStrokeColor: '#FFFFFF', circleStrokeWidth: 2,
          }} />
          <CircleLayer id="spot-clusters" filter={['has', 'point_count']} style={{
            circleColor: CLUSTER_COLOR as never, circleRadius: grown ? 20 : 0, circleRadiusTransition: { duration: 350, delay: 0 },
            circleStrokeColor: '#FFFFFF', circleStrokeWidth: 2.5,
          }} />
          {/* Today's photos: a soft halo that breathes under the pin. */}
          <TodayHalo color={pinColor(todayTheme ?? 'taste')} grown={grown} run={!reduceMotion} />
          <SymbolLayer id="spot-cluster-count" filter={['has', 'point_count']} style={{
            textField: ['get', 'point_count_abbreviated'], textColor: '#FFFFFF', textSize: 15, textAllowOverlap: true, textIgnorePlacement: true,
          }} />
          <CircleLayer id="spot-pins" filter={['!', ['has', 'point_count']]} style={{
            // A pin wears its theme's color; a Hilads pick stays gold with its star.
            circleColor: ['case', ['get', 'pick'], colors.gold, ['match', ['get', 'theme'],
              ...PLACE_THEMES.flatMap(k => [k, pinColor(k)]), SPECIAL, PUMPKIN, colors.primary]] as never,
            // A spot with a photo: a bigger ring in its theme's color around the round photo (mini polaroid).
            circleRadius: grown ? ['case', ['!=', ['get', 'img'], ''], PHOTO_RING, PIN_RADIUS] as never : 0,
            circleRadiusTransition: { duration: 350, delay: 0 },
            circleStrokeColor: ['case', ['==', ['get', 'theme'], SPECIAL], '#4A1F5E', '#FFFFFF'] as never, circleStrokeWidth: 2.5,
          }} />
          {/* The round photo inside its ring, at every zoom. */}
          <SymbolLayer id="spot-photos" filter={['all', ['!', ['has', 'point_count']], ['!=', ['get', 'img'], '']]} style={{
            iconImage: ['get', 'img'], iconSize: grown ? PHOTO_ICON_SIZE : 0.01, iconAllowOverlap: true, iconIgnorePlacement: true,
          }} />
          {/* A Hilads pick: a little ⭐ (on the photo's corner when it has one). */}
          <SymbolLayer id="spot-pick-stars" filter={['all', ['!', ['has', 'point_count']], ['get', 'pick']]} style={{
            textField: ['case', ['!=', ['get', 'img'], ''], '⭐', '★'] as never, textColor: '#FFFFFF', textSize: 13,
            textOffset: ['case', ['!=', ['get', 'img'], ''], ['literal', [1.1, -1.1]], ['literal', [0, 0]]] as never,
            textAllowOverlap: true, textIgnorePlacement: true,
          }} />
          {/* A spot with a photo: its label on the ring's right. */}
          <SymbolLayer id="spot-labels-photo" filter={['all', ['!', ['has', 'point_count']], ['!=', ['get', 'img'], '']]} minZoomLevel={LABEL_MIN_ZOOM} style={{
            textField: ['get', 'label'], textSize: 12, textColor: colors.text, textHaloColor: colors.bg2, textHaloWidth: 1.5,
            textAnchor: 'left', textOffset: [1.9, 0], textJustify: 'left', textMaxWidth: 20,
            textAllowOverlap: false, symbolSortKey: ['get', 'rank'],
          }} />
          <SymbolLayer id="spot-labels" filter={['all', ['!', ['has', 'point_count']], ['==', ['get', 'img'], '']]} minZoomLevel={LABEL_MIN_ZOOM} style={{
            textField: ['get', 'label'], textSize: 12, textColor: colors.text, textHaloColor: colors.bg2, textHaloWidth: 1.5,
            textVariableAnchor: ['left', 'right'], textRadialOffset: 1.3, textJustify: 'auto', textMaxWidth: 20,
            textAllowOverlap: false, textIgnorePlacement: false, symbolSortKey: ['get', 'rank'],
          }} />
          {/* Above the labels, so placed first: each pin's box (always shown, invisible) keeps labels off it. */}
          <SymbolLayer id="spot-blockers" filter={['!', ['has', 'point_count']]} minZoomLevel={LABEL_MIN_ZOOM} style={{
            iconImage: ['case', ['!=', ['get', 'img'], ''], 'blockPhoto', 'blockDot'] as never, iconAllowOverlap: true, iconIgnorePlacement: false,
          }} />
        </ShapeSource>
        <Images images={{ ...pinImages, ...BLOCKERS }} />

        {/* The plan cards' and the selected spot's boxes: labels never go under them (plans and the selection win). */}
        <ShapeSource id="label-blockers" shape={blockers}>
          <SymbolLayer id="label-blockers" minZoomLevel={LABEL_MIN_ZOOM} style={{
            iconImage: ['get', 'img'], iconAnchor: ['get', 'anchor'] as never, iconAllowOverlap: true, iconIgnorePlacement: false,
          }} />
        </ShapeSource>

        {/* Plans from PLAN_MIN_ZOOM, where they no longer sit on top of clusters; each on the side that hides no pin. */}
        {showPlans && plans.slice(0, 30).map(p => <PlanMarker key={`${p.id}@${p.startsAt}`} plan={p} side={planSides.get(`${p.id}@${p.startsAt}`) ?? 'top'} />)}

        {/* World view: the base style's labels and borders hidden, one bubble per city. */}
        {/* (Points of interest stay hidden on the standard style: the spots are the map's places.) */}
        {WORLD_HIDDEN_LAYERS.map(id => id.includes('boundary')
          ? <LineLayer key={id} id={id} existing style={{ visibility: worldView ? 'none' : 'visible' }} />
          : <SymbolLayer key={id} id={id} existing style={{ visibility: worldView || (DEFAULT_STYLE && id === 'poi-label') ? 'none' : 'visible' }} />)}
        {worldView && (
          <>
            <Images images={bubbleImages} />
            <ShapeSource id="city-bubbles" shape={bubbleShape} hitbox={{ width: 24, height: 24 }} onPress={onBubblePress}>
              <SymbolLayer id="city-bubble-ring" style={{
                iconImage: 'bubbleRing', iconColor: colors.primary, iconTextFit: 'width', iconTextFitPadding: [0, 12, 0, 12],
                textField: BUBBLE_TEXT, textFont: BUBBLE_FONT, textSize: 14, textOpacity: 0,
                iconAllowOverlap: true, textAllowOverlap: true, iconIgnorePlacement: true, textIgnorePlacement: true, symbolSortKey: ['get', 'spots'],
              }} />
              <SymbolLayer id="city-bubble" style={{
                iconImage: 'bubbleFill', iconColor: colors.bg2, iconTextFit: 'width', iconTextFitPadding: [0, 10, 0, 10],
                textField: BUBBLE_TEXT, textFont: BUBBLE_FONT, textSize: 14, textColor: colors.text,
                iconAllowOverlap: true, textAllowOverlap: true, iconIgnorePlacement: true, textIgnorePlacement: true, symbolSortKey: ['get', 'spots'],
              }} />
            </ShapeSource>
          </>
        )}

        {selected && (
          <MarkerView coordinate={[selected.lng, selected.lat]} anchor={{ x: 0.5, y: 1 }} allowOverlap>
            <View style={styles.selectedWrap} pointerEvents="none">
              <Text style={styles.selectedLabel} numberOfLines={1}>{pinLabel(selected.name, selected.priceRange, i18n.language)}</Text>
              <BouncePin key={selected.id}>
                <View style={styles.selectedPin}>
                  <ThemeIcon theme={selected.themes[0] ?? 'taste'} size={22} color="#FFFFFF" />
                </View>
              </BouncePin>
            </View>
          </MarkerView>
        )}
      </MapView>

      {/* A seasonal event's live day: the night sky (moon, bats) over the map. */}
      <SeasonalMapSky top={topH} />

      {/* Top overlay: the Map's subtitle (no title bar over the map), search + theme chips. */}
      <View style={[styles.top, { paddingTop: insets.top + 10 }]} pointerEvents="box-none"
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
        {results !== null && (
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

      {/* Above the sheet: a notice, 🎲 Surprise me and locate-me. */}
      <View style={[styles.floating, { bottom: peekH + 12 }]} pointerEvents="box-none">
        {notice && <Text style={styles.notice}>{notice}</Text>}
        <View style={styles.floatRow} pointerEvents="box-none">
          {!worldView && shown.length > 0 && (
            <TouchableOpacity style={styles.surprise} onPress={surprise} activeOpacity={0.85} accessibilityRole="button" testID="map-surprise">
              <Text style={styles.surpriseText}>🎲 {t('map.surprise')}</Text>
            </TouchableOpacity>
          )}
          <IconButton icon="locate-outline" label={t('map.locate')} onPress={locate} style={styles.locate} />
        </View>
      </View>

      {/* The sticky sheet: the visible area's spots, a selected pin's card first. */}
      <MapSheet
        ref={sheet}
        onPeek={setPeekH}
        spots={listSpots}
        me={me}
        origin={bboxCentre}
        place={scope === 'city' && city?.name ? shortCityName(city.name) : null}
        filterLabel={todayOnly ? t('map.todayChip') : themeFilter === SPECIAL ? t('map.halloween') : themeFilter ? themeName(themeFilter) : null}
        emptyArea={emptyArea}
        onPick={s => select(s, 'map_list', true)}
        selectedCard={selected ? (
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
        ) : null}
        topNote={worldView && screenReader ? <WorldCityList bubbles={bubbles} onOpen={openBubble} />
          : showEmpty ? <EmptyCity today={today.data} /> : emptyArea ? (
          <TouchableOpacity style={styles.pioneer} onPress={() => router.push('/daily/proof' as never)} accessibilityRole="button">
            <Text style={styles.pioneerText}>{t('map.sheet.pioneer')}</Text>
          </TouchableOpacity>
        ) : null}
      />
      <ShareSheet content={share} source="spot_sheet" onClose={() => setShare(null)} />
    </View>
  );
}

/** A Hi plan as a dated pin: "Birdy, now · 10 going", "Birdy, in 2 hours". Caramel; opens the plan. */
function PlanMarker({ plan, side }: { plan: PlanPin; side: PlanSide }) {
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
  const day = start.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
  return (
    // A little calendar page on a stem: the day on top, then the title, the time and who's going.
    // Its stem points at the plan's place from the side that hides no pin (planSide).
    <MarkerView coordinate={[plan.lng, plan.lat]} anchor={PLAN_ANCHOR[side]}>
      <TouchableOpacity style={[styles.planWrap, PLAN_LAYOUT[side]]} onPress={() => router.push(`/event/${plan.id}` as never)} accessibilityRole="button"
                        accessibilityLabel={[t('map.planA11y', { title: plan.title, time }), going].filter(Boolean).join(', ')}>
        <View style={[styles.plan, ongoing && styles.planNow]}>
          <View style={[styles.planTop, ongoing && styles.planTopNow]}>
            <Ionicons name={ongoing ? 'radio-button-on' : 'calendar'} size={11} color="#FFFFFF" />
            <Text style={styles.planDay} numberOfLines={1}>{ongoing ? time : day}</Text>
          </View>
          <Text style={styles.planText} numberOfLines={1}>{plan.title}</Text>
          <Text style={styles.planMeta} numberOfLines={1}>{[ongoing ? null : time, going].filter(Boolean).join(' · ')}</Text>
        </View>
        <View style={[styles.planStem, (side === 'left' || side === 'right') && styles.planStemSide, ongoing && styles.planStemNow]} />
      </TouchableOpacity>
    </MarkerView>
  );
}

const PLAN_ANCHOR: Record<PlanSide, { x: number; y: number }> = { top: { x: 0.5, y: 1 }, bottom: { x: 0.5, y: 0 }, right: { x: 0, y: 0.5 }, left: { x: 1, y: 0.5 } };
// The card, then its stem towards the point: column above, reversed below, row-reversed on the right, row on the left.
const PLAN_LAYOUT: Record<PlanSide, object> = {
  top: { flexDirection: 'column' }, bottom: { flexDirection: 'column-reverse' },
  right: { flexDirection: 'row-reverse', alignItems: 'center' }, left: { flexDirection: 'row', alignItems: 'center' },
};

/** True while VoiceOver / TalkBack is on. */
function useScreenReader(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isScreenReaderEnabled().then(v => { if (alive) setOn(v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setOn);
    return () => { alive = false; sub.remove(); };
  }, []);
  return on;
}

/**
 * The World view's cities as a list of buttons (screen readers: the bubbles are map layers,
 * which can't be focused): flag, name and spot count, most spots first; one opens its city.
 */
function WorldCityList({ bubbles, onOpen }: { bubbles: MapCity[]; onOpen: (b: MapCity) => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  return (
    <View style={styles.worldList}>
      {bubbles.map(b => {
        const name = shortCityName(b.city.name);
        return (
          <TouchableOpacity key={b.city.id} style={styles.worldRow} onPress={() => onOpen(b)} accessibilityRole="button"
                            accessibilityLabel={t('map.cityBubbleA11y', { city: name, count: b.spots })}>
            <CityFlag country={b.city.country} size={20} />
            <Text style={styles.worldName} numberOfLines={1}>{name}</Text>
            <Text style={styles.worldCount}>{b.spots}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/**
 * Today's photos: a soft halo that breathes under the pin (V6). Its own little component, so
 * the breathing (a state flip every PULSE_MS, the map eases the radius and opacity) re-renders
 * this one layer, not the whole map screen; it only runs while the Map tab is shown. Inside the
 * ShapeSource, which hands it its sourceID.
 */
function TodayHalo({ color, grown, run: canRun, sourceID }: { color: string; grown: boolean; run: boolean; sourceID?: string }) {
  // Asked here, not in the map screen: a focus change re-renders this layer only.
  const run = useIsFocused() && canRun;
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (!run) { setPulse(false); return; }
    const id = setInterval(() => setPulse(p => !p), PULSE_MS);
    return () => clearInterval(id);
  }, [run]);
  return (
    <CircleLayer id="spot-today-halo" sourceID={sourceID} filter={['all', ['!', ['has', 'point_count']], ['get', 'today']]} style={{
      circleColor: color, circleRadius: grown ? (pulse ? 30 : 20) : 0,
      circleOpacity: pulse ? 0 : 0.4,
      circleRadiusTransition: { duration: PULSE_MS, delay: 0 }, circleOpacityTransition: { duration: PULSE_MS, delay: 0 },
    }} />
  );
}

/** Me on the map: my avatar, a soft ring breathing around it. */
function MeMarker({ photo, name, pulse: canPulse }: { photo: string | null; name: string; pulse: boolean }) {
  const styles = useThemedStyles(makeStyles);
  // Only while the Map tab is shown (asked here so a focus change re-renders this marker only).
  const pulse = useIsFocused() && canPulse;
  const ring = useSharedValue(0);
  useEffect(() => {
    if (!pulse) { cancelAnimation(ring); ring.value = 0; return; }
    ring.value = withRepeat(withTiming(1, { duration: 1600 }), -1, false);
    return () => cancelAnimation(ring);
  }, [pulse]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useAnimatedStyle(() => ({ opacity: 0.5 * (1 - ring.value), transform: [{ scale: 1 + ring.value * 0.9 }] }));
  return (
    <View style={styles.me} pointerEvents="none">
      <Animated.View style={[styles.meRing, st]} />
      <View style={styles.meAvatar}><Avatar uri={photo} name={name || '🙂'} size={30} /></View>
    </View>
  );
}

/** The selected pin bounces in when a list row or 🎲 picks it. */
function BouncePin({ children }: { children: React.ReactNode }) {
  const y = useSharedValue(-18);
  useEffect(() => { y.value = withSequence(withSpring(0, { damping: 6, stiffness: 220 })); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={st}>{children}</Animated.View>;
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
  loading:       { position: 'absolute', alignSelf: 'center' },
  floating:      { position: 'absolute', left: 8, right: 8, gap: 10 },
  floatRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginRight: 8 },
  locate:        {},
  surprise:      { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 16, borderRadius: Radius.full,
                   backgroundColor: c.text },
  surpriseText:  { fontSize: FontSizes.sm, fontWeight: '800', color: c.bg },
  worldList:     { paddingHorizontal: Spacing.md, paddingBottom: 8 },
  worldRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line },
  worldName:     { flex: 1, fontSize: 16, fontWeight: '700', color: c.text },
  worldCount:    { fontSize: 15, fontWeight: '800', color: c.muted },
  pioneer:       { marginHorizontal: Spacing.md, marginVertical: 8, padding: 14, borderRadius: Radius.card, backgroundColor: c.primaryTint },
  pioneerText:   { fontSize: FontSizes.sm, fontWeight: '800', color: c.primaryOnTint, textAlign: 'center' },
  me:            { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  meRing:        { position: 'absolute', width: 40, height: 40, borderRadius: 20, backgroundColor: c.primary },
  meAvatar:      { borderRadius: 19, borderWidth: 3, borderColor: '#FFFFFF', backgroundColor: c.bg2 },
  notice:        { alignSelf: 'center', fontSize: FontSizes.xs, color: c.text, backgroundColor: c.bg2, borderRadius: 16,
                   paddingHorizontal: 14, paddingVertical: 8, overflow: 'hidden', borderWidth: 1, borderColor: c.line },
  selectedWrap:  { alignItems: 'center', gap: 6 },
  selectedLabel: { maxWidth: 220, fontSize: FontSizes.xs, fontWeight: '700', color: c.text, backgroundColor: c.bg2, borderRadius: 12,
                   borderWidth: 1.5, borderColor: c.line, paddingHorizontal: 12, paddingVertical: 6, overflow: 'hidden' },
  selectedPin:   { width: 50, height: 50, borderRadius: Radius.full, backgroundColor: c.primary, borderWidth: 4, borderColor: c.primaryTint,
                   alignItems: 'center', justifyContent: 'center' },
  planWrap:      { alignItems: 'center' },
  plan:          { minWidth: 96, maxWidth: 170, borderRadius: 12, borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: c.bg2, overflow: 'hidden' },
  planNow:       { borderColor: c.primary },
  planTop:       { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: c.caramel },
  planTopNow:    { backgroundColor: c.primary },
  planDay:       { fontSize: 11, fontWeight: '800', color: '#FFFFFF' },
  planText:      { fontSize: FontSizes.xs, fontWeight: '800', color: c.text, paddingHorizontal: 8, paddingTop: 3 },
  planMeta:      { fontSize: 11, fontWeight: '700', color: c.muted, paddingHorizontal: 8, paddingBottom: 4 },
  planStem:      { width: 2, height: 8, backgroundColor: c.caramel },
  planStemSide:  { width: 8, height: 2 },
  planStemNow:   { backgroundColor: c.primary },
});
