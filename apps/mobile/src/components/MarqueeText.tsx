/**
 * MarqueeText - single-line text that auto-scrolls ONLY when it overflows.
 *
 * Generic, opt-in primitive: any pill/chip can drop it in place of a
 * truncating <Text>. If the text fits its container it renders static with no
 * animation. If it overflows it scrolls horizontally in a seamless loop with
 * soft edge fades. Currently used by the weather pill (chat.tsx); ready for
 * other overflowing pills later.
 *
 * Behaviour:
 *   - Overflow detection: a hidden, unconstrained copy reports the text's
 *     natural width; the container's onLayout reports the available width.
 *     Re-measures on layout / font-scale / text changes.
 *   - Loop: two copies separated by `gap`; translateX 0 → -(textWidth + gap)
 *     at ~`speed` px/s, then Animated.loop resets (invisible - copy 2 sits
 *     exactly where copy 1 began).
 *   - Native driver only (UI thread). No Reanimated dependency.
 *   - Pauses when `active` is false (tab blurred / app backgrounded).
 *   - `reduceMotion`: never animates - renders static + ellipsis (the caller
 *     is responsible for any tap-to-reveal affordance).
 */

import { useEffect, useRef, useState } from 'react';
import {
  View, Text, Animated, Easing, StyleSheet,
  type StyleProp, type TextStyle, type ViewStyle, type LayoutChangeEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface MarqueeTextProps {
  text:           string;
  textStyle?:     StyleProp<TextStyle>;
  /** Container (clip window) style - usually `{ flexShrink: 1 }` so it shares row space. */
  style?:         StyleProp<ViewStyle>;
  /** Pill background as 6-digit hex (e.g. '#1a1a1a') - used to build the edge fade. */
  fadeColor:      string;
  /** Px between the two looping copies. */
  gap?:           number;
  /** Scroll speed in px/sec (duration is derived so speed stays constant). */
  speed?:         number;
  /** Ms to wait before the first scroll so the user can read the start. */
  initialDelay?:  number;
  /** Px width of each edge fade overlay. */
  fadeWidth?:     number;
  /** Animate only when visible (tab focused AND app foregrounded). */
  active?:        boolean;
  /** OS reduce-motion: when true, never animate (static + ellipsis). */
  reduceMotion?:  boolean;
  /** Center the text when it fits (static). The marquee still starts at the left. */
  center?:        boolean;
}

const EPSILON = 1;
// Marginal overflows hit ellipsis instead of triggering a constant scroll —
// without this threshold any locale whose translation crept ~1 px over the
// clip would marquee forever, which read as "flashing" on the challenge-
// intro banner. Real overflows still scroll.
const OVERFLOW_FACTOR = 1.15;
// Ms held at the end of each loop iteration before snapping invisibly back
// to the start. The snap is hidden by the duplicate copy mechanism, but
// the eye still needs a still moment per cycle or the continuous scroll
// reads as flicker.
const END_HOLD_MS = 1500;
// Px past the right edge so the last glyph fully clears the right fade.
const LEAD = 12;

export function MarqueeText({
  text,
  textStyle,
  style,
  fadeColor,
  gap = 40,
  speed = 25,
  initialDelay = 3000,
  fadeWidth = 14,
  active = true,
  reduceMotion = false,
  center = false,
}: MarqueeTextProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const [containerW, setContainerW] = useState(0);
  const [textW, setTextW] = useState(0);

  const overflows     = textW > 0 && containerW > 0 && textW > containerW * OVERFLOW_FACTOR;
  const shouldMarquee = overflows && !reduceMotion;

  const onContainerLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setContainerW(prev => (Math.abs(w - prev) > EPSILON ? w : prev));
  };
  const onMeasureText = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setTextW(prev => (Math.abs(w - prev) > EPSILON ? w : prev));
  };

  // New text → drop the stale measurement so we don't marquee on the wrong width.
  useEffect(() => { setTextW(0); }, [text]);

  // Single-copy snap-back. Each iteration: hold at the start (initialDelay),
  // scroll one copy left so its end clears the right fade, hold at the end
  // (END_HOLD_MS), then Animated.loop resets translateX to 0 — that reset
  // is the snap, mostly masked by the right-edge fade + the next hold.
  // The previous seamless-loop variant kept both text copies on track at
  // once, which was visible on narrow clips and read as a flash.
  useEffect(() => {
    translateX.setValue(0);
    if (!shouldMarquee || !active) return;

    const distance = Math.max(0, textW - containerW + LEAD);
    const duration = (distance / speed) * 1000;

    const starter = Animated.loop(
      Animated.sequence([
        Animated.delay(initialDelay),
        Animated.timing(translateX, {
          toValue:         -distance,
          duration,
          easing:          Easing.linear,
          useNativeDriver: true,
        }),
        Animated.delay(END_HOLD_MS),
      ]),
    );
    starter.start();
    return () => {
      starter.stop();
      translateX.setValue(0);
    };
  }, [shouldMarquee, active, textW, containerW, speed, initialDelay, translateX]);

  const transparent = toTransparent(fadeColor);

  return (
    <View style={[styles.container, style]} onLayout={onContainerLayout}>
      {/* Hidden measuring copy - absolute + unconstrained → reports natural width. */}
      <Text
        style={[textStyle, styles.measure]}
        numberOfLines={1}
        onLayout={onMeasureText}
      >
        {text}
      </Text>

      {shouldMarquee ? (
        <>
          {/* Single copy — no duplicate, no inter-copy gap. The animation
              scrolls this one Text left, holds, then snaps back. */}
          <Animated.View style={[styles.row, { transform: [{ translateX }] }]}>
            <Text style={[textStyle, styles.noShrink]} numberOfLines={1}>{text}</Text>
          </Animated.View>

          <LinearGradient
            colors={[fadeColor, transparent]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={[styles.fade, styles.fadeLeft, { width: fadeWidth }]}
            pointerEvents="none"
          />
          <LinearGradient
            colors={[transparent, fadeColor]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={[styles.fade, styles.fadeRight, { width: fadeWidth }]}
            pointerEvents="none"
          />
        </>
      ) : (
        <Text
          style={[textStyle, center && styles.staticCenter]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {text}
        </Text>
      )}
    </View>
  );
}

/** '#rrggbb' → '#rrggbb00' (same color, alpha 0) for a seamless fade. */
function toTransparent(hex: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex + '00';
  if (/^#[0-9a-fA-F]{8}$/.test(hex)) return hex.slice(0, 7) + '00';
  return 'transparent';
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', flexDirection: 'row', alignItems: 'center' },
  row:       { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  // Marquee copies must keep natural width even if textStyle sets flexShrink.
  noShrink:  { flexShrink: 0, flexGrow: 0 },
  measure:   { position: 'absolute', left: 0, top: 0, opacity: 0 },
  // Static (non-overflowing) text fills the clip window so textAlign can center it.
  staticCenter: { flex: 1, textAlign: 'center' },
  fade:      { position: 'absolute', top: 0, bottom: 0 },
  fadeLeft:  { left: 0 },
  fadeRight: { right: 0 },
});
