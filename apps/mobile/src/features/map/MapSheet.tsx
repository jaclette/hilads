import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { track } from '@/services/analytics';
import type { Spot } from '@/api/spots';
import { SortChips, SpotRow, sortSpots, type SpotSort } from './SpotList';

/** Peek height: the handle and one line ("23 spots in Saigon · nearest first"). */
export const SHEET_PEEK = 112;
const HINT_KEY = 'hilads_map_sheet_hint_seen';

export type MapSheetHandle = { snapTo: (index: 0 | 1 | 2) => void };

/**
 * The map's sticky bottom sheet (V6, replaces the List button): peek (a line
 * about the visible area), half (the list) and full. It lists the spots of
 * the visible area with the active filters, sorted Nearest · Most liked ·
 * Newest; a selected pin's card leads it (the sheet rises to half). The first
 * visit shows a "swipe up" hint.
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
}>(function MapSheet({ spots, me, origin, place, filterLabel, selectedCard, topNote, emptyArea, onPick }, ref) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const sheet = useRef<BottomSheet>(null);
  const [sort, setSort] = useState<SpotSort>('near');
  const [hint, setHint] = useState(false);
  const snapPoints = useMemo(() => [SHEET_PEEK, '50%', '92%'], []);
  const data = useMemo(() => sortSpots(spots, sort, me ?? origin), [spots, sort, me, origin]);

  useImperativeHandle(ref, () => ({ snapTo: i => sheet.current?.snapToIndex(i) }), []);
  useEffect(() => { AsyncStorage.getItem(HINT_KEY).then(v => setHint(v !== '1')).catch(() => {}); }, []);
  const onChange = useCallback((i: number) => {
    track('map_sheet_snap', { index: i });
    if (i > 0 && hint) { setHint(false); AsyncStorage.setItem(HINT_KEY, '1').catch(() => {}); }
  }, [hint]);

  const sortLabel = t(sort === 'near' ? 'map.sheet.byNear' : sort === 'liked' ? 'map.sheet.byLiked' : 'map.sheet.byNew');
  const headline = emptyArea ? t('map.sheet.emptyArea')
    : place ? t('map.sheet.count', { count: spots.length, city: place }) : t('map.sheet.countHere', { count: spots.length });

  return (
    <BottomSheet
      ref={sheet}
      index={0}
      snapPoints={snapPoints}
      onChange={onChange}
      enablePanDownToClose={false}
      backgroundStyle={styles.bg}
      handleIndicatorStyle={{ backgroundColor: colors.line, width: 44 }}
      enableDynamicSizing={false}
    >
      <View style={styles.head} testID="map-sheet">
        <Text style={styles.headline} numberOfLines={1}>{headline}</Text>
        <Text style={styles.sub} numberOfLines={1}>{[filterLabel, emptyArea ? null : sortLabel].filter(Boolean).join(' · ')}</Text>
        {hint && <SwipeHint label={t('map.sheet.hint')} />}
      </View>
      <BottomSheetFlatList
        data={data}
        keyExtractor={(s: Spot) => s.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListHeaderComponent={<View>{selectedCard}{topNote}{data.length > 1 && <SortChips sort={sort} onSort={setSort} />}</View>}
        renderItem={({ item }: { item: Spot }) => <SpotRow spot={item} me={me} onPick={onPick} />}
      />
    </BottomSheet>
  );
});

/** "⬆ Swipe up for the list": a little bounce, once per device. */
function SwipeHint({ label }: { label: string }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const y = useSharedValue(0);
  useEffect(() => {
    if (!reduced) y.value = withRepeat(withSequence(withTiming(-4, { duration: 450 }), withTiming(0, { duration: 450 })), 4);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <Animated.View style={[styles.hint, st]}>
      <Ionicons name="chevron-up" size={14} color={colors.primaryOnTint} />
      <Text style={styles.hintText}>{label}</Text>
    </Animated.View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  bg:       { backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  head:     { paddingHorizontal: 18, paddingBottom: 8, gap: 2 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '800', color: c.text },
  sub:      { fontSize: 13, lineHeight: 17, fontWeight: '600', color: c.muted },
  list:     { paddingBottom: 40 },
  hint:     { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 10, height: 26,
              borderRadius: 13, backgroundColor: c.primaryTint },
  hintText: { fontSize: 12, fontWeight: '800', color: c.primaryOnTint },
});
