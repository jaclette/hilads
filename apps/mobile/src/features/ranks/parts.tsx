import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming, Easing } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { Space, Radius, Type, Elevation, Gutter, IconSize, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Confetti, tint } from '@/ui/joy';
import { Crown } from '@/ui/Crown';
import { Tappable } from '@/ui/Tappable';
import i18n from '@/i18n';
import { ordinal } from '@/lib/ordinal';

/** A podium place's medal color (1 gold, 2 silver, 3 bronze): the saturated medal fills, ink (`onMedal`) on top. */
export function medalColor(c: ThemeColors, rank: number): string {
  return [c.medalGold, c.medalSilver, c.medalBronze][rank - 1] ?? c.medalGold;
}

/** A number counting up from 0 (once), plain with "reduce motion". */
export function CountUp({ value, format, style }: { value: number; format?: (n: number) => string; style?: object }) {
  const reduced = useReducedMotion();
  const [n, setN] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced) { setN(value); return; }
    const start = Date.now();
    const dur = 700;
    let raf = 0;
    const step = () => {
      const p = Math.min(1, (Date.now() - start) / dur);
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  return <Text style={style}>{format ? format(n) : n}</Text>;
}

/** ▲2 (green), ▼1, "new", or nothing when unchanged (or no movement for the period). */
export function Movement({ rank, prevRank, show }: { rank: number; prevRank: number | null; show: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  if (!show) return null;
  if (prevRank === null) return <View style={styles.newChip}><Text style={styles.newText}>{t('ranks.new')}</Text></View>;
  const d = prevRank - rank;
  if (d === 0) return <Text style={[styles.move, { color: colors.muted }]}>–</Text>;
  return <Text style={[styles.move, { color: d > 0 ? colors.green : colors.red }]}>{d > 0 ? `▲${d}` : `▼${-d}`}</Text>;
}

/** `heart`: the value is a like count, drawn with the heart icon (never the ❤️ emoji). */
export type PodiumItem = { key: string; rank: number; label: string; lead: ReactNode; value: number; format: (n: number) => string; onPress?: () => void; heart?: boolean;
  /** The value as a screen reader says it ("14 likes", "120 points"); else the formatted value. */
  spoken?: string };
/**
 * An empty podium place, per rank: an invitation ("Your photo here? 📸" → the camera; "🎯 Who
 * takes #3? Invite a friend" → the share sheet) or, for a past period, just "Nobody took this
 * spot" (no onPress).
 */
export type PodiumGhost = (rank: number) => { label: string; icon: React.ComponentProps<typeof Ionicons>['name']; onPress?: () => void };

// Confetti once per session, the first time a podium shows.
let celebrated = false;

/**
 * The top 3 on gold, silver and bronze blocks of different heights (2-1-3),
 * a crown on #1; the blocks rise in, the numbers count up, and the first
 * podium of the session gets a little confetti. With fewer than 3, the missing
 * places are dashed ghost blocks (`ghost`): never a lone block in empty space.
 */
export function Podium({ items, ghost }: { items: PodiumItem[]; ghost?: PodiumGhost }) {
  const styles = useThemedStyles(makeStyles);
  const [party] = useState(() => { const first = !celebrated && items.length > 0; if (first) celebrated = true; return first; });
  const order = [items[1], items[0], items[2]];
  return (
    <View style={styles.podium} testID="ranks-podium">
      {order.map((it, i) => (it ? <PodiumStep key={it.key} item={it} delay={[120, 0, 240][i]} />
        : ghost ? <GhostStep key={`ghost-${i}`} rank={[2, 1, 3][i]} ghost={ghost} />
        : <View key={`empty-${i}`} style={styles.step} />))}
      <Confetti run={party} count={30} />
    </View>
  );
}

const HEIGHTS = [104, 78, 60];

function PodiumStep({ item, delay }: { item: PodiumItem; delay: number }) {
  const styles = useThemedStyles(makeStyles);
  const reduced = useReducedMotion();
  const grow = useSharedValue(reduced ? 1 : 0);
  useEffect(() => { if (!reduced) grow.value = withDelay(delay, withSpring(1, { damping: 12, stiffness: 120 })); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const block = useAnimatedStyle(() => ({ height: HEIGHTS[item.rank - 1] * grow.value }));
  const lead = useAnimatedStyle(() => ({ opacity: grow.value, transform: [{ scale: 0.7 + 0.3 * grow.value }] }));
  const { colors } = useTheme();
  const color = medalColor(colors, item.rank);
  return (
    <Tappable style={styles.step} onPress={item.onPress} disabled={!item.onPress} accessibilityRole="button"
              accessibilityLabel={`${ordinal(item.rank, i18n.language)}, ${item.label}, ${item.spoken ?? item.format(item.value)}`}>
      <Animated.View style={[styles.lead, lead]}>
        {item.rank === 1 && <View style={styles.crown}><Crown size={30} fill={colors.medalGold} stroke={colors.onMedal} /></View>}
        {item.lead}
      </Animated.View>
      <Text style={styles.podiumName} numberOfLines={1}>{item.label}</Text>
      <View style={styles.valueRow}>
        {item.heart && <Ionicons name="heart" size={IconSize.sm} color={colors.primary} />}
        <CountUp value={item.value} format={item.format} style={styles.podiumValue} />
      </View>
      <Animated.View style={[styles.block, { backgroundColor: color }, block]}>
        <Text style={styles.blockRank}>{item.rank}</Text>
      </Animated.View>
    </Tappable>
  );
}

/** A missing podium place: a dashed block in its medal color, a camera, "Your photo here? 📸". */
function GhostStep({ rank, ghost: make }: { rank: number; ghost: PodiumGhost }) {
  const styles = useThemedStyles(makeStyles);
  const ghost = make(rank);
  const { colors } = useTheme();
  const color = medalColor(colors, rank);
  return (
    <Tappable style={styles.step} onPress={ghost.onPress} disabled={!ghost.onPress} accessibilityRole={ghost.onPress ? 'button' : 'text'}
              accessibilityLabel={`${ordinal(rank, i18n.language)} ${ghost.label}`} testID={`ranks-ghost-${rank}`}>
      <View style={styles.lead}>
        <View style={[styles.ghostLead, { borderColor: color, backgroundColor: tint(color, 0.14) }]}>
          <Ionicons name={ghost.icon} size={24} color={color} />
        </View>
      </View>
      <Text style={[styles.ghostLabel, !ghost.onPress && styles.ghostMuted]} numberOfLines={3}>{ghost.label}</Text>
      <View style={[styles.ghostBlock, { height: HEIGHTS[rank - 1], borderColor: color, backgroundColor: tint(color, 0.12) }]}>
        <Text style={styles.ghostRank}>{rank}</Text>
      </View>
    </Tappable>
  );
}

/** A row from 4th place: rank, leading visual, name and sub line, movement, value pill. `mine`: highlighted. */
export function RankRow({ rank, lead, title, sub, movement, value, spoken, mine, onPress, extra }: {
  rank: number; lead: ReactNode; title: string; sub?: ReactNode; movement?: ReactNode; value: string; mine?: boolean; onPress?: () => void; extra?: ReactNode;
  /** The value as a screen reader says it ("120 points"); else `value`. */
  spoken?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Tappable onPress={onPress} disabled={!onPress} style={[styles.row, mine && styles.rowMine]} accessibilityRole="button"
              accessibilityLabel={`${ordinal(rank, i18n.language)}, ${title}, ${spoken ?? value}`}>
      <Text style={styles.rank}>{rank}</Text>
      {lead}
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        {!!sub && <View style={styles.rowSub}>{sub}</View>}
        {extra}
      </View>
      {movement}
      <View style={styles.pill}><Text style={styles.pillText} numberOfLines={1}>{value}</Text></View>
    </Tappable>
  );
}

/**
 * The sticky "You" bar at the bottom: where you stand and who's next; a tap scrolls to your row.
 * The shared floating bar (design pass, BottomBar): inside the gutter, tangerine and ink in both themes.
 */
export function YouBar({ text, onPress }: { text: string; onPress?: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const y = useSharedValue(reduced ? 0 : 80);
  useEffect(() => { if (!reduced) y.value = withTiming(0, { duration: 350, easing: Easing.out(Easing.back(1.4)) }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <Animated.View style={[styles.youWrap, st]} pointerEvents="box-none">
      <Tappable onPress={onPress} style={styles.you} accessibilityRole="button" testID="ranks-you">
        <Text style={styles.youText} numberOfLines={2}>{text}</Text>
        {!!onPress && <Ionicons name="arrow-down" size={IconSize.md} color={colors.onCta} />}
      </Tappable>
    </Animated.View>
  );
}

/** A bar that fills to `ratio` (0..1) when it appears: the city race. */
export function RaceBar({ ratio, color, delay = 0 }: { ratio: number; color: string; delay?: number }) {
  const styles = useThemedStyles(makeStyles);
  const reduced = useReducedMotion();
  const w = useSharedValue(reduced ? ratio : 0);
  const last = useRef(ratio);
  useEffect(() => {
    w.value = reduced ? ratio : withDelay(last.current === ratio ? delay : 0, withTiming(ratio, { duration: 800, easing: Easing.out(Easing.cubic) }));
    last.current = ratio;
  }, [ratio]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = useAnimatedStyle(() => ({ width: `${Math.max(4, w.value * 100)}%` }));
  return <View style={styles.track}><Animated.View style={[styles.fill, { backgroundColor: color }, st]} /></View>;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  // Inside the gutter (design pass): the podium never runs edge to edge.
  podium:      { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: Space.sm, paddingTop: Space.md, paddingBottom: Space.xs, paddingHorizontal: Gutter },
  step:        { flex: 1, alignItems: 'center', maxWidth: 130 },
  lead:        { alignItems: 'center', marginBottom: Space.sm },
  crown:       { marginBottom: -2, zIndex: 1 },
  podiumName:  { ...Type.caption, fontWeight: '800', color: c.text, maxWidth: '100%' },
  valueRow:    { flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginBottom: Space.sm },
  podiumValue: { ...Type.caption, color: c.muted },
  block:       { width: '100%', borderTopLeftRadius: Radius.card, borderTopRightRadius: Radius.card, alignItems: 'center', paddingTop: Space.sm, overflow: 'hidden' },
  blockRank:   { ...Type.display, color: c.onMedal },
  ghostLead:   { width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  ghostLabel:  { ...Type.caption, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: Space.sm, minHeight: 34 },
  ghostMuted:  { color: c.muted, fontWeight: '700' },
  ghostBlock:  { width: '100%', borderTopLeftRadius: Radius.card, borderTopRightRadius: Radius.card, borderWidth: 2, borderStyle: 'dashed', alignItems: 'center', paddingTop: Space.sm },
  ghostRank:   { ...Type.display, color: c.muted },
  row:         { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.md, paddingHorizontal: Space.sm, borderRadius: Radius.card },
  rowMine:     { backgroundColor: c.selected },
  rank:        { width: 28, ...Type.label, color: c.muted, textAlign: 'center' },
  rowBody:     { flex: 1, gap: Space.xxs },
  rowTitle:    { ...Type.body, fontWeight: '800', color: c.text },
  rowSub:      { flexDirection: 'row', alignItems: 'center', gap: Space.sm, flexWrap: 'wrap' },
  // The one score pill: neutral, the value in ink (the heart, where there is one, is an icon in primary).
  pill:        { paddingHorizontal: Space.md, height: 28, borderRadius: Radius.control, backgroundColor: c.bg3, alignItems: 'center', justifyContent: 'center' },
  pillText:    { ...Type.caption, fontWeight: '800', color: c.text },
  move:        { ...Type.caption, fontWeight: '800', minWidth: 28, textAlign: 'right' },
  newChip:     { paddingHorizontal: Space.sm, height: 20, borderRadius: Radius.control, backgroundColor: c.selected, justifyContent: 'center' },
  newText:     { ...Type.caption, fontWeight: '800', color: c.onSelected },
  youWrap:     { position: 'absolute', left: Gutter, right: Gutter, bottom: Space.lg },
  you:         { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: Space.xl, paddingVertical: Space.md,
                 borderRadius: Radius.control, backgroundColor: c.cta, ...Elevation(c, 'float') },
  youText:     { flex: 1, ...Type.body, fontWeight: '800', color: c.onCta },
  track:       { height: 8, borderRadius: 4, backgroundColor: c.bg3, overflow: 'hidden', marginTop: Space.xs },
  fill:        { height: 8, borderRadius: 4 },
});
