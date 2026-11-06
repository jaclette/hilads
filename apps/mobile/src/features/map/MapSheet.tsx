import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, Text, View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import BottomSheet, { BottomSheetFlatList, type BottomSheetBackgroundProps } from '@gorhom/bottom-sheet';
import Animated, { cancelAnimation, Easing, Extrapolation, interpolate, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { track } from '@/services/analytics';
import type { Spot } from '@/api/spots';
import { thumbUrl } from '@/lib/imageThumb';
import { distance, meters } from '@/features/today/format';
import { SortChips, SpotRow, sortSpots, type SpotSort } from './SpotList';

/** Peek height before the head is measured: the wave (with the handle on it) and the content row. */
export const SHEET_PEEK = 106;
// The wave across the top (the handle sits on its higher hump): the sheet's handle area.
const WAVE = 34;
const HANDLE_W = 44;
// The polaroid stack (as the mockup): offsets, tilts and the middle one a little higher.
const POL_LEFT = [0, 12, 22];
const POL_TOP = [6, 2, 6];
const TILT = ['-9deg', '3deg', '11deg'];
const HINT_KEY = 'hilads_map_sheet_hint_seen';

export type MapSheetHandle = { snapTo: (index: 0 | 1 | 2) => void };

/**
 * The map's sticky bottom sheet (V6, replaces the List button): peek (a
 * playful ticket about the visible area), half (the list) and full. It lists the spots of
 * the visible area with the active filters, sorted Nearest · Most liked ·
 * Newest; a selected pin's card leads it (the sheet rises to half). The first
 * visit shows a "swipe up" hint.
 * The peek (V6.3) is an orange wave: one smooth asymmetric swell across the
 * width (the white handle on its higher hump), a gradient from the brand orange
 * to terracotta with a soft shadow above it; on it, a mini stack of the three
 * nearest spots' photos as tilted polaroids, "📍 [6] spots to explore" in white
 * on one line (shrinking when a language needs it; the number in a white pill,
 * rolling to its new value when the area or the filters change), "Nearest 120 m
 * away · swipe up 👆" ("No spots here yet, be the pioneer 📍" when empty) and a
 * white chevron. The wave undulates and the chevron bounces until the sheet is
 * opened once (remembered), neither with reduced motion. A tap opens it to half;
 * open, the wave header stays on top and the list keeps the light ground.
 * The sheet lives in the Map screen, which ends above the tab bar (the bar is
 * in the layout, its safe area included), so it never goes under it. The peek
 * is measured: the wave and the content row, nothing more, so nothing shows half cut at its edge
 * on a small phone. The sort chips (one row scrolling sideways) sit under the
 * head and fade in from the half position. onPeek: the peek's height (the
 * floating buttons sit above it).
 */
export const MapSheet = forwardRef<MapSheetHandle, {
  spots: Spot[];
  me: [number, number] | null;
  origin: [number, number] | null;
  place: string | null;
  filterLabel: string | null;
  selectedCard: ReactNode;
  topNote: ReactNode;
  emptyArea: boolean;
  onPick: (s: Spot) => void;
  onPeek?: (height: number) => void;
}>(function MapSheet({ spots, me, origin, place, filterLabel, selectedCard, topNote, emptyArea, onPick, onPeek }, ref) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const sheet = useRef<BottomSheet>(null);
  const [sort, setSort] = useState<SpotSort>('near');
  const [hint, setHint] = useState(false);
  const reduced = useReducedMotion();
  const [headH, setHeadH] = useState(0);
  const peek = headH > 0 ? Math.ceil(WAVE + headH) : SHEET_PEEK;
  const snapPoints = useMemo(() => [peek, '50%', '92%'], [peek]);
  useEffect(() => { onPeek?.(peek); }, [peek, onPeek]);
  const onHead = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setHeadH(prev => (Math.abs(prev - h) < 1 ? prev : h));
  }, []);
  // 0 = peek, 1 = half: the sort chips fade in on the way up (hidden at the peek).
  const index = useSharedValue(0);
  const chipsStyle = useAnimatedStyle(() => ({ opacity: interpolate(index.value, [0.3, 0.9], [0, 1], Extrapolation.CLAMP) }));
  const data = useMemo(() => sortSpots(spots, sort, me ?? origin), [spots, sort, me, origin]);

  useImperativeHandle(ref, () => ({ snapTo: i => sheet.current?.snapToIndex(i) }), []);
  const [atPeek, setAtPeek] = useState(true);
  const openHalf = () => {
    Haptics.selectionAsync().catch(() => {});
    sheet.current?.snapToIndex(1);
  };
  useEffect(() => { AsyncStorage.getItem(HINT_KEY).then(v => setHint(v !== '1')).catch(() => {}); }, []);
  const onChange = useCallback((i: number) => {
    track('map_sheet_snap', { index: i });
    setAtPeek(i === 0);
    if (i > 0 && hint) { setHint(false); AsyncStorage.setItem(HINT_KEY, '1').catch(() => {}); }
  }, [hint]);

  // The title: "📍 [6] spots to explore", the number in its pill (§ marks where it goes in each language).
  const count = spots.length;
  const [before, after = ''] = t('map.sheet.peekTitle', { count, num: '§' }).split('§');
  const nearest = me && data.length && !emptyArea ? meters(me, [data[0].lng, data[0].lat]) : null;
  const sub = emptyArea || count === 0 ? t('map.sheet.peekEmpty')
    : [filterLabel, nearest !== null ? t('map.sheet.peekNearest', { distance: distance(nearest) }) : null, atPeek ? t('map.sheet.peekSwipe') : null].filter(Boolean).join(' · ');
  // Nearest first, those with a photo: the polaroids.
  const near = useMemo(() => sortSpots(spots, 'near', me ?? origin).filter(s => s.cover.thumbUrl || s.cover.photoUrl).slice(0, 3), [spots, me, origin]);

  return (
    <PeekCtx.Provider value={{ headH, waving: hint && atPeek && !reduced }}>
    <BottomSheet
      ref={sheet}
      index={0}
      snapPoints={snapPoints}
      onChange={onChange}
      animatedIndex={index}
      enablePanDownToClose={false}
      backgroundComponent={WaveBackground}
      handleComponent={WaveHandle}
      enableDynamicSizing={false}
    >
      <Pressable onLayout={onHead} onPress={atPeek ? openHalf : undefined} disabled={!atPeek} style={styles.head} testID="map-sheet"
                 accessibilityRole="button" accessibilityLabel={`${before}${emptyArea ? 0 : count}${after}${place ? ` (${place})` : ''}. ${sub}`} accessibilityHint={t('map.sheet.hint')}>
        <Polaroids spots={near} />
        <View style={styles.headText}>
          <View style={styles.titleRow}>
            {!!before.trim() && <Text style={[styles.title, styles.titlePart]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{before.trim()}</Text>}
            <RollingCount n={emptyArea ? 0 : count} reduced={reduced} />
            {!!after.trim() && <Text style={[styles.title, styles.titlePart]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{after.trim()}</Text>}
          </View>
          <Text style={styles.sub} numberOfLines={2}>{sub}</Text>
        </View>
        <Bounce active={hint && atPeek} reduced={reduced} />
      </Pressable>
      {data.length > 1 && (
        <Animated.View style={chipsStyle}>
          <SortChips sort={sort} onSort={setSort} />
        </Animated.View>
      )}
      <BottomSheetFlatList
        data={data}
        keyExtractor={(s: Spot) => s.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListHeaderComponent={<View>{selectedCard}{topNote}</View>}
        renderItem={({ item }: { item: Spot }) => <SpotRow spot={item} me={me} onPick={onPick} />}
      />
    </BottomSheet>
    </PeekCtx.Provider>
  );
});

/** Shared with the sheet's background and handle: the head's height (the orange ends under it) and whether the wave moves. */
const PeekCtx = createContext<{ headH: number; waving: boolean }>({ headH: 0, waving: false });
const AnimatedPath = Animated.createAnimatedComponent(Path);

/**
 * The wave's outline in pixels (reference path in a 360×30 box, scaled to the width and
 * WAVE high): one asymmetric swell, the higher hump at 140/360, the lower one at the right
 * edge, then straight down to `bottom`. `p` (0..1) undulates it a little (the crest and the
 * trough breathe in opposite ways, the control points drift).
 */
function wavePath(w: number, bottom: number, p: number, lift = 0) {
  'worklet';
  const sx = w / 360;
  const sy = WAVE / 30;
  const a = Math.sin(p * Math.PI * 2) * 1.6;
  const d = Math.cos(p * Math.PI * 2) * 5;
  const X = (x: number) => (x * sx).toFixed(1);
  const Y = (y: number) => (y * sy - lift).toFixed(1);
  return `M0 ${Y(24 - a / 2)} C${X(55 + d)} ${Y(26)} ${X(85 + d)} ${Y(2 + a)} ${X(140)} ${Y(3 + a)}`
    + ` C${X(195 - d)} ${Y(4 + a)} ${X(215 - d)} ${Y(20 - a)} ${X(262)} ${Y(19 - a)}`
    + ` C${X(302 + d)} ${Y(18 - a)} ${X(328 + d)} ${Y(9 + a / 2)} ${X(360)} ${Y(12 + a / 2)}`
    + ` L${w.toFixed(1)} ${bottom.toFixed(1)} L0 ${bottom.toFixed(1)}Z`;
}

/**
 * The sheet's ground: the orange wave header (a gradient from the brand orange on the
 * crest to terracotta under the text, a soft shadow above the wave), then the normal
 * light ground for the list when the sheet is open. The wave undulates slowly (5 s loop)
 * until the sheet has been opened once, never with reduced motion.
 */
function WaveBackground({ style }: BottomSheetBackgroundProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { headH, waving } = useContext(PeekCtx);
  const [w, setW] = useState(0);
  const total = WAVE + Math.max(headH, SHEET_PEEK - WAVE);
  const phase = useSharedValue(0);
  useEffect(() => {
    if (!waving) { cancelAnimation(phase); phase.value = withTiming(0, { duration: 400 }); return; }
    phase.value = 0;
    phase.value = withRepeat(withTiming(1, { duration: 5000, easing: Easing.linear }), -1, false);
  }, [waving]); // eslint-disable-line react-hooks/exhaustive-deps
  const wave = useAnimatedProps(() => ({ d: wavePath(w, total, phase.value) }));
  const shadow1 = useAnimatedProps(() => ({ d: wavePath(w, total, phase.value, 2) }));
  const shadow2 = useAnimatedProps(() => ({ d: wavePath(w, total, phase.value, 4) }));
  return (
    <Animated.View pointerEvents="none" style={style} onLayout={e => setW(e.nativeEvent.layout.width)}>
      <View style={[styles.ground, { top: total - 1 }]} />
      {w > 0 && (
        <Svg width={w} height={total} style={styles.wave}>
          <Defs>
            <LinearGradient id="peekWave" x1="0" y1="0" x2="0" y2={total} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={colors.peekTop} />
              <Stop offset={String((WAVE - 6) / total)} stopColor={colors.peekMid} />
              <Stop offset="1" stopColor={colors.peekBottom} />
            </LinearGradient>
          </Defs>
          <AnimatedPath animatedProps={shadow2} fill={colors.peekShadow} opacity={0.5} />
          <AnimatedPath animatedProps={shadow1} fill={colors.peekShadow} />
          <AnimatedPath animatedProps={wave} fill="url(#peekWave)" />
        </Svg>
      )}
    </Animated.View>
  );
}

/** The handle: a white pill on the wave's higher hump. */
function WaveHandle() {
  const styles = useThemedStyles(makeStyles);
  const [w, setW] = useState(0);
  return (
    <View style={styles.handleBox} onLayout={e => setW(e.nativeEvent.layout.width)}>
      {w > 0 && <View style={[styles.handle, { left: Math.round((w * 140) / 360 - HANDLE_W / 2) }]} />}
    </View>
  );
}

/** The three nearest spots' photos as a mini stack of tilted polaroids (crossfading when they change). */
function Polaroids({ spots }: { spots: Spot[] }) {
  const styles = useThemedStyles(makeStyles);
  if (!spots.length) return <View style={styles.pinTile}><Text style={styles.pinEmoji}>📍</Text></View>;
  return (
    <View style={[styles.stack, { width: 40 + POL_LEFT[spots.length - 1] }]} accessible={false}>
      {spots.map((s, i) => (
        <View key={i} style={[styles.polaroid, { left: POL_LEFT[i], top: POL_TOP[i], zIndex: 3 - i, transform: [{ rotate: TILT[i] }] }]}>
          <Image source={{ uri: thumbUrl(s.cover.thumbUrl ?? s.cover.photoUrl) ?? undefined }} style={styles.polaroidImg}
                 contentFit="cover" transition={250} cachePolicy="memory-disk" />
        </View>
      ))}
    </View>
  );
}

// The count rolls like an odometer: the old number goes up and out, the new one comes up from below.
const rollIn = () => {
  'worklet';
  return { initialValues: { opacity: 0, transform: [{ translateY: 16 }] },
           animations: { opacity: withTiming(1, { duration: 220 }), transform: [{ translateY: withTiming(0, { duration: 220 }) }] } };
};
const rollOut = () => {
  'worklet';
  return { initialValues: { opacity: 1, transform: [{ translateY: 0 }] },
           animations: { opacity: withTiming(0, { duration: 220 }), transform: [{ translateY: withTiming(-16, { duration: 220 }) }] } };
};

/** The number in its orange pill, rolling to each new value (still with reduced motion). */
function RollingCount({ n, reduced }: { n: number; reduced: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.pill}>
      {/* Sizes the pill to the number; the animated copies sit over it. */}
      <Text style={[styles.pillText, styles.pillSizer]}>{n}</Text>
      <Animated.Text key={n} entering={reduced ? undefined : rollIn} exiting={reduced ? undefined : rollOut} style={[styles.pillText, styles.pillNum]}>{n}</Animated.Text>
    </View>
  );
}

/** The up chevron (a white circle, terracotta arrow): a bounce every ~2.5 s until the sheet has been opened once. */
function Bounce({ active, reduced }: { active: boolean; reduced: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const y = useSharedValue(0);
  useEffect(() => {
    if (!active || reduced) { cancelAnimation(y); y.value = withTiming(0, { duration: 150 }); return; }
    y.value = withRepeat(withSequence(
      withDelay(1800, withTiming(-7, { duration: 200 })), withTiming(0, { duration: 220 }),
      withTiming(-3, { duration: 140 }), withTiming(0, { duration: 160 }),
    ), -1);
  }, [active, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <Animated.View style={[styles.chevron, st]}>
      <Ionicons name="chevron-up" size={20} color={colors.peekInk} />
    </Animated.View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wave:        { position: 'absolute', top: 0, left: 0 },
  ground:      { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.bg },
  handleBox:   { height: WAVE },
  handle:      { position: 'absolute', top: 11, width: HANDLE_W, height: 5, borderRadius: 3, backgroundColor: c.onPeek },
  head:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 12, paddingTop: 2, paddingBottom: 14 },
  headText:    { flex: 1, minWidth: 0, gap: 3 },
  titleRow:    { flexDirection: 'row', alignItems: 'center', columnGap: 6 },
  title:       { fontSize: 19, lineHeight: 24, fontWeight: '900', color: c.onPeek },
  titlePart:   { flexShrink: 1 },
  sub:         { fontSize: 13, lineHeight: 18, fontWeight: '700', color: c.onPeekMuted },
  pill:        { flexShrink: 0, minWidth: 30, height: 26, paddingHorizontal: 9, borderRadius: 13, backgroundColor: c.onPeek, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  pillText:    { fontSize: 16, lineHeight: 20, fontWeight: '900', color: c.peekInk, textAlign: 'center' },
  pillSizer:   { opacity: 0 },
  pillNum:     { position: 'absolute', left: 0, right: 0, top: 3 },
  stack:       { height: 56 },
  polaroid:    { position: 'absolute', width: 40, padding: 3, paddingBottom: 8, borderRadius: 3, backgroundColor: c.onPeek,
                 shadowColor: '#000000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  polaroidImg: { width: 34, height: 35, borderRadius: 2, backgroundColor: c.bg3 },
  pinTile:     { width: 48, height: 48, borderRadius: 14, backgroundColor: c.onPeek, alignItems: 'center', justifyContent: 'center' },
  pinEmoji:    { fontSize: 24 },
  chevron:     { width: 36, height: 36, borderRadius: 18, backgroundColor: c.onPeek, alignItems: 'center', justifyContent: 'center' },
  list:        { paddingBottom: 40 },
});
