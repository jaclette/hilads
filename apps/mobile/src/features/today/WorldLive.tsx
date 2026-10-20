import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Text, View, StyleSheet } from 'react-native';
import { type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { shortCityName } from '@/i18n/cityName';
import { AnswerBubble, FlagSticker } from '@/ui/joy';

const RING_MS = 1800;
const TICK_MS = 2200;

/** `bubble`: `answer` is the value given to the day's question (a speech bubble); else a plain line (a place). */
export type TickerEntry = { cityId: number; city: string; country: string | null; answer: string; bubble?: boolean };

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
 * The world's answers as a live feed: the flag stickers of up to 3 countries,
 * and "[city] [answer in a speech bubble]" sliding up every 2.2 s through the cities that answered
 * (other cities first), the current city's flag scaled up and the others
 * dimmed. A city that newly answered (a refresh) joins the stack with a small
 * bounce and comes next. Static with reduce motion: the first three answers.
 */
export function WorldTicker({ entries, flags, live, reduced, staticLine, onDark = false }: {
  entries: TickerEntry[];
  flags: string[];
  live: boolean;
  reduced: boolean;
  /** On a photo (the Today hero): white text with a soft shadow. */
  onDark?: boolean;
  /** Reduce motion: "5 countries · Salud! · Prost! · Kanpai!" */
  staticLine: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const [index, setIndex] = useState(0);
  const slide = useRef(new Animated.Value(1)).current;
  const seen = useRef<Set<number> | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);   // the country that just joined (bounce)
  const bounce = useRef(new Animated.Value(1)).current;
  // Up to 3 stickers (the current city's among them), so the answer's bubble has room.
  const all = [...new Set(flags.filter(Boolean))];
  const cur = current0(entries, index)?.country ?? null;
  const stack = (cur && all.indexOf(cur) >= 3 ? [...all.slice(0, 2), cur] : all.slice(0, 3));

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

  const current = current0(entries, index);
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
              <FlagSticker country={c} size={22} />
            </Animated.View>
          );
        })}
      </View>
      <View style={styles.lineBox}>
        {showTicker ? (
          <Animated.View key={`${current!.cityId}:${index}`} style={[styles.entry, {
            opacity: slide,
            transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
          }]}>
            {current!.bubble ? (
              <>
                <Text style={[styles.city, onDark && styles.onDark]} numberOfLines={1}>{shortCityName(current!.city)}</Text>
                <AnswerBubble text={current!.answer} size="sm" tail="left" onPhoto={onDark} style={styles.bubble} />
              </>
            ) : (
              <Text numberOfLines={1} style={[styles.line, onDark && styles.onDarkMuted]}>
                <Text style={[styles.city, onDark && styles.onDark]}>{shortCityName(current!.city)}</Text>{` · ${current!.answer}`}
              </Text>
            )}
          </Animated.View>
        ) : (
          <Text style={[styles.line, onDark && styles.onDarkMuted]} numberOfLines={1}>{staticLine}</Text>
        )}
      </View>
    </View>
  );
}

function current0(entries: TickerEntry[], index: number): TickerEntry | null {
  return entries.length > 0 ? entries[index % entries.length] : null;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  dotWrap:     { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  dot:         { width: 7, height: 7, borderRadius: 4, backgroundColor: c.cta },
  ring:        { position: 'absolute', width: 7, height: 7, borderRadius: 4, backgroundColor: c.cta },
  row:         { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  flags:       { flexDirection: 'row', alignItems: 'center' },
  flagRing:    { borderRadius: 11 },
  flagOverlap: { marginLeft: -6 },
  flagDim:     { opacity: 0.7 },
  // Tall enough for a small bubble and its tail.
  lineBox:     { flex: 1, minWidth: 0, height: 34, justifyContent: 'center', overflow: 'hidden' },
  entry:       { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  bubble:      { flexShrink: 1, alignSelf: 'center', marginBottom: 3 },
  line:        { fontSize: 13, fontWeight: '600', color: c.muted },
  city:        { flexShrink: 0, maxWidth: '45%', fontSize: 13, fontWeight: '800', color: c.text },
  onDark:      { color: '#FFFFFF', textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  onDarkMuted: { color: 'rgba(255,255,255,0.92)', textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
});
