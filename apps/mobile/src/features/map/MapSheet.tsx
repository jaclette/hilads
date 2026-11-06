import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, Text, View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import BottomSheet, { BottomSheetFlatList, type BottomSheetBackgroundProps } from '@gorhom/bottom-sheet';
import Animated, { cancelAnimation, Extrapolation, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
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

/** Peek height before the head is measured: the scalloped edge, the handle and the ticket row. */
export const SHEET_PEEK = 112;
// The ticket's scalloped top edge: bumps of this radius, every SCALLOP_STEP px.
const SCALLOP_R = 8;
const SCALLOP_STEP = 22;
// The handle: under the scallops, a thick pill in the theme color (paddingTop + pill + paddingBottom).
const HANDLE = SCALLOP_R + 8 + 6 + 6;
const TILT = ['-8deg', '5deg', '12deg'];
const HINT_KEY = 'hilads_map_sheet_hint_seen';

export type MapSheetHandle = { snapTo: (index: 0 | 1 | 2) => void };

/**
 * The map's sticky bottom sheet (V6, replaces the List button): peek (a
 * playful ticket about the visible area), half (the list) and full. It lists the spots of
 * the visible area with the active filters, sorted Nearest · Most liked ·
 * Newest; a selected pin's card leads it (the sheet rises to half). The first
 * visit shows a "swipe up" hint.
 * The peek (V6.2) is a ticket: opaque cream (bg) with a scalloped top edge and
 * a soft shadow over the map, a thick theme-colored handle, a mini stack of the
 * three nearest spots' photos as tilted polaroids, "📍 [6] spots to explore"
 * (the number in an orange pill, rolling to its new value when the area or the
 * filters change, the photos crossfading), "Nearest 120 m away · swipe up 👆"
 * ("No spots here yet, be the pioneer 📍" when empty) and an up chevron that
 * bounces every few seconds until the sheet is opened once. A tap on it opens
 * the sheet to half.
 * The sheet lives in the Map screen, which ends above the tab bar (the bar is
 * in the layout, its safe area included), so it never goes under it. The peek
 * is measured: the handle and the ticket row (wrapped when a language needs
 * it), nothing more, so nothing shows half cut at its edge
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
  const peek = headH > 0 ? Math.ceil(HANDLE + headH) : SHEET_PEEK;
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

  // The ticket: "📍 [6] spots to explore", the number in its pill (§ marks where it goes in each language).
  const count = spots.length;
  const [before, after = ''] = t('map.sheet.peekTitle', { count, num: '§' }).split('§');
  const nearest = me && data.length && !emptyArea ? meters(me, [data[0].lng, data[0].lat]) : null;
  const sub = emptyArea || count === 0 ? t('map.sheet.peekEmpty')
    : [filterLabel, nearest !== null ? t('map.sheet.peekNearest', { distance: distance(nearest) }) : null, t('map.sheet.peekSwipe')].filter(Boolean).join(' · ');
  // Nearest first, those with a photo: the polaroids.
  const near = useMemo(() => sortSpots(spots, 'near', me ?? origin).filter(s => s.cover.thumbUrl || s.cover.photoUrl).slice(0, 3), [spots, me, origin]);

  return (
    <BottomSheet
      ref={sheet}
      index={0}
      snapPoints={snapPoints}
      onChange={onChange}
      animatedIndex={index}
      enablePanDownToClose={false}
      backgroundComponent={TicketBackground}
      handleComponent={TicketHandle}
      enableDynamicSizing={false}
    >
      <Pressable onLayout={onHead} onPress={atPeek ? openHalf : undefined} disabled={!atPeek} style={styles.head} testID="map-sheet"
                 accessibilityRole="button" accessibilityLabel={`${before}${emptyArea ? 0 : count}${after}${place ? ` (${place})` : ''}. ${sub}`} accessibilityHint={t('map.sheet.hint')}>
        <Polaroids spots={near} />
        <View style={styles.headText}>
          <View style={styles.titleRow}>
            {!!before.trim() && <Text style={styles.title}>{before.trim()}</Text>}
            <RollingCount n={emptyArea ? 0 : count} reduced={reduced} />
            {!!after.trim() && <Text style={[styles.title, styles.titleAfter]} numberOfLines={2}>{after.trim()}</Text>}
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
  );
});

/** The ticket's ground: opaque cream with a scalloped top edge and a soft shadow over the map. */
function TicketBackground({ style }: BottomSheetBackgroundProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const [w, setW] = useState(0);
  const bumps = Math.ceil(w / SCALLOP_STEP) + 1;
  return (
    <Animated.View pointerEvents="none" style={[style, styles.shadow]} onLayout={e => setW(e.nativeEvent.layout.width)}>
      <Svg width={w} height={SCALLOP_R * 2} style={styles.scallops}>
        {Array.from({ length: bumps }, (_, i) => (
          <Circle key={i} cx={SCALLOP_STEP / 2 + i * SCALLOP_STEP} cy={SCALLOP_R} r={SCALLOP_R} fill={colors.bg} />
        ))}
      </Svg>
      <View style={styles.ground} />
    </Animated.View>
  );
}

/** The handle: a thick pill in the theme color, under the scallops. */
function TicketHandle() {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.handleBox}><View style={styles.handle} /></View>;
}

/** The three nearest spots' photos as a mini stack of tilted polaroids (crossfading when they change). */
function Polaroids({ spots }: { spots: Spot[] }) {
  const styles = useThemedStyles(makeStyles);
  if (!spots.length) return <View style={styles.pinTile}><Text style={styles.pinEmoji}>📍</Text></View>;
  return (
    <View style={[styles.stack, { width: 48 + (spots.length - 1) * 16 }]} accessible={false}>
      {spots.map((s, i) => (
        <View key={i} style={[styles.polaroid, { left: i * 16, zIndex: 3 - i, transform: [{ rotate: TILT[i] }] }]}>
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

/** The up chevron: a gentle bounce every few seconds until the sheet has been opened once. */
function Bounce({ active, reduced }: { active: boolean; reduced: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const y = useSharedValue(0);
  useEffect(() => {
    if (!active || reduced) { cancelAnimation(y); y.value = withTiming(0, { duration: 150 }); return; }
    y.value = withRepeat(withSequence(
      withDelay(2600, withTiming(-7, { duration: 200 })), withTiming(0, { duration: 220 }),
      withTiming(-3, { duration: 140 }), withTiming(0, { duration: 160 }),
    ), -1);
  }, [active, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <Animated.View style={[styles.chevron, st]}>
      <Ionicons name="chevron-up" size={20} color={colors.primaryOnTint} />
    </Animated.View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  shadow:      { ...Platform.select({ ios: { shadowColor: '#2A1C13', shadowOpacity: 0.22, shadowRadius: 14, shadowOffset: { width: 0, height: -4 } }, default: {} }) },
  scallops:    { position: 'absolute', top: 0, left: 0 },
  ground:      { position: 'absolute', top: SCALLOP_R, left: 0, right: 0, bottom: 0, backgroundColor: c.bg, ...Platform.select({ android: { elevation: 14 }, default: {} }) },
  handleBox:   { paddingTop: SCALLOP_R + 8, paddingBottom: 6, alignItems: 'center' },
  handle:      { width: 52, height: 6, borderRadius: 3, backgroundColor: c.primary },
  head:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 10, paddingTop: 4, paddingBottom: 14 },
  headText:    { flex: 1, minWidth: 0, gap: 3 },
  titleRow:    { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 6, rowGap: 2 },
  title:       { fontSize: 19, lineHeight: 24, fontWeight: '900', color: c.text },
  titleAfter:  { flexShrink: 1 },
  sub:         { fontSize: 13, lineHeight: 18, fontWeight: '700', color: c.muted },
  pill:        { minWidth: 30, height: 26, paddingHorizontal: 9, borderRadius: 13, backgroundColor: c.cta, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  pillText:    { fontSize: 16, lineHeight: 20, fontWeight: '900', color: c.onCta, textAlign: 'center' },
  pillSizer:   { opacity: 0 },
  pillNum:     { position: 'absolute', left: 0, right: 0, top: 3 },
  stack:       { height: 54 },
  polaroid:    { position: 'absolute', top: 2, width: 46, padding: 3, paddingBottom: 9, borderRadius: 4, backgroundColor: c.bg2,
                 shadowColor: '#2A1C13', shadowOpacity: 0.18, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  polaroidImg: { width: 40, height: 40, borderRadius: 2, backgroundColor: c.bg3 },
  pinTile:     { width: 48, height: 48, borderRadius: 14, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  pinEmoji:    { fontSize: 24 },
  chevron:     { width: 36, height: 36, borderRadius: 18, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  list:        { paddingBottom: 40 },
});
