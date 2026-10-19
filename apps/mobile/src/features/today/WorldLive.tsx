import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Text, View, StyleSheet } from 'react-native';
import { type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { shortCityName } from '@/i18n/cityName';
import { CityFlag } from '@/ui';

const RING_MS = 1800;
const TICK_MS = 2200;

export type TickerEntry = { cityId: number; city: string; country: string | null; answer: string };

/**
 * True while the world block may move: the card is on screen, the app is in
 * the foreground and the OS "reduce motion" setting is off. `reduced` alone
 * says whether reduce motion is on (the static fallback).
 */
export function useLiveMotion(visible: boolean): { live: boolean; reduced: boolean } {
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);
  return { live: visible && active && !reduced, reduced };
}

/** The "live" dot: a primary dot with a soft ring expanding every 1.8 s (no ring with reduce motion or off screen). */
export function LiveDot({ live }: { live: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const ring = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!live) { ring.stopAnimation(); ring.setValue(0); return; }
    const loop = Animated.loop(Animated.timing(ring, { toValue: 1, duration: RING_MS, easing: Easing.out(Easing.ease), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [live, ring]);
  return (
    <View style={styles.dotWrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {live && (
        <Animated.View style={[styles.ring, {
          opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
          transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
        }]} />
      )}
      <View style={styles.dot} />
    </View>
  );
}

/**
 * The world's answers as a live feed: the flags of up to 5 countries, and
 * "[city] · [answer]" sliding up every 2.2 s through the cities that answered
 * (other cities first), the current city's flag scaled up and the others
 * dimmed. A city that newly answered (a refresh) joins the stack with a small
 * bounce and comes next. Static with reduce motion: the first three answers.
 */
export function WorldTicker({ entries, flags, live, reduced, staticLine }: {
  entries: TickerEntry[];
  flags: string[];
  live: boolean;
  reduced: boolean;
  /** Reduce motion: "5 countries · Salud! · Prost! · Kanpai!" */
  staticLine: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const [index, setIndex] = useState(0);
  const slide = useRef(new Animated.Value(1)).current;
  const seen = useRef<Set<number> | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);   // the country that just joined (bounce)
  const bounce = useRef(new Animated.Value(1)).current;
  const stack = [...new Set(flags.filter(Boolean))].slice(0, 5);

  // A city that newly answered: its flag bounces in, and it comes next in the ticker.
  useEffect(() => {
    const ids = new Set(entries.map(e => e.cityId));
    if (seen.current) {
      const added = entries.find(e => !seen.current!.has(e.cityId));
      if (added) {
        setIndex(entries.indexOf(added));
        if (added.country) {
          setFresh(added.country);
          bounce.setValue(0.4);
          Animated.spring(bounce, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }).start(() => setFresh(null));
        }
      }
    }
    seen.current = ids;
  }, [entries, bounce]);

  // Every 2.2 s, the next city slides up (only while live).
  useEffect(() => {
    if (!live || entries.length < 2) return;
    const id = setInterval(() => {
      setIndex(i => (i + 1) % entries.length);
      slide.setValue(0);
      Animated.timing(slide, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, TICK_MS);
    return () => clearInterval(id);
  }, [live, entries.length, slide]);

  const current = entries.length > 0 ? entries[index % entries.length] : null;
  const showTicker = !reduced && !!current;

  return (
    <View style={styles.row}>
      <View style={styles.flags} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {stack.map((c, i) => {
          const on = showTicker && current?.country === c;
          return (
            <Animated.View key={c} style={[styles.flagRing, i > 0 && styles.flagOverlap, { zIndex: on ? 9 : 5 - i },
                                           showTicker && !on && styles.flagDim,
                                           { transform: [{ scale: fresh === c ? bounce : on ? 1.15 : 1 }] }]}>
              <CityFlag country={c} size={20} />
            </Animated.View>
          );
        })}
      </View>
      <View style={styles.lineBox}>
        {showTicker ? (
          <Animated.Text key={`${current!.cityId}:${index}`} numberOfLines={1} style={[styles.line, {
            opacity: slide,
            transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
          }]}>
            <Text style={styles.city}>{shortCityName(current!.city)}</Text>{` · ${current!.answer}`}
          </Animated.Text>
        ) : (
          <Text style={styles.line} numberOfLines={1}>{staticLine}</Text>
        )}
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  dotWrap:     { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  dot:         { width: 7, height: 7, borderRadius: 4, backgroundColor: c.primary },
  ring:        { position: 'absolute', width: 7, height: 7, borderRadius: 4, backgroundColor: c.primary },
  row:         { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  flags:       { flexDirection: 'row', alignItems: 'center' },
  flagRing:    { borderRadius: 4, borderWidth: 1.5, borderColor: c.stepBg, overflow: 'hidden' },
  flagOverlap: { marginLeft: -7 },
  flagDim:     { opacity: 0.45 },
  lineBox:     { flex: 1, minWidth: 0, height: 20, justifyContent: 'center', overflow: 'hidden' },
  line:        { fontSize: 13, fontWeight: '600', color: c.muted },
  city:        { fontSize: 13, fontWeight: '800', color: c.text },
});
