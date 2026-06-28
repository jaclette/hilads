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
 *   - Loop: ONE copy ping-pongs. translateX 0 → -(textWidth - clipWidth + LEAD)
 *     at ~`speed` px/s (reveal the end), holds, then back to 0 (reveal the
 *     start), holds, repeat. Smooth in both directions - no snap, no duplicate.
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
  /** Ms to wait before the first scroll so the user can read the start.
   *  Kept short so a parked card reads as "about to move", not "cut off". */
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
// Tiny jitter buffer so 1-2 px measurement noise doesn't toggle marquee
// on/off across re-renders. Previously 1.15 (15%) to suppress a flashing
// loop on the challenge-intro banner under the OLD seamless-duplicate
// mechanism - but the single-copy snap-back mechanism (current) handles
// small overflows gracefully (long start/end holds dominate the cycle),
// so a 15% buffer just blocks real overflows like the weather pill from
// scrolling at all. 2% catches measurement jitter without false negatives.
const OVERFLOW_FACTOR = 1.02;
// Ms held at each end of the ping-pong (fully-scrolled and back-at-start)
// so the eye gets a still moment to read the start and the end of the title
// before the direction reverses.
const END_HOLD_MS = 1500;
// Px past the right edge so the last glyph fully clears the right fade.
const LEAD = 12;
// Px of travel over which an edge fade fades in/out. Each fade is tied to the
// scroll position so it never covers readable text while parked at an end
// (e.g. the first glyph at the start, the last glyph at the full-scroll end).
const FADE_REVEAL = 10;

export function MarqueeText({
  text,
  textStyle,
  style,
  fadeColor,
  gap = 40,
  speed = 25,
  initialDelay = 1400,
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
  const distance      = Math.max(0, textW - containerW + LEAD);

  // Fades follow the scroll so they never dim readable text at rest. Left fade
  // is off at the start (translateX 0) - nothing has scrolled off the left, so
  // the first glyph must be fully visible - and fades in once we move left.
  // Right fade is the mirror: off at the fully-scrolled end, on otherwise.
  const leftFadeOpacity  = translateX.interpolate({
    inputRange:  [-FADE_REVEAL, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const rightFadeOpacity = translateX.interpolate({
    inputRange:  [-distance, -distance + FADE_REVEAL],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

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

  // Single-copy PING-PONG. After an initial hold so the user can read the
  // start, each loop iteration: scroll one copy left until its end clears the
  // right fade, hold at the end (END_HOLD_MS), scroll smoothly back to the
  // start, hold there (END_HOLD_MS), repeat. The smooth reverse replaces the
  // old snap-back-to-0 reset, which read as the marquee "stopping" and
  // restarting; ping-pong keeps the motion continuous in both directions so
  // the whole title stays readable. Still ONE copy (no duplicate), so it
  // never flashes like the seamless-loop variant did on narrow clips.
  useEffect(() => {
    translateX.setValue(0);
    if (!shouldMarquee || !active) return;

    const distance = Math.max(0, textW - containerW + LEAD);
    const duration = (distance / speed) * 1000;

    const leg = (toValue: number) =>
      Animated.timing(translateX, {
        toValue,
        duration,
        easing:          Easing.linear,
        useNativeDriver: true,
      });

    const starter = Animated.sequence([
      Animated.delay(initialDelay),
      Animated.loop(
        Animated.sequence([
          leg(-distance),            // scroll left → reveal the end
          Animated.delay(END_HOLD_MS),
          leg(0),                    // scroll right → back to the start
          Animated.delay(END_HOLD_MS),
        ]),
      ),
    ]);
    starter.start();
    return () => {
      starter.stop();
      translateX.setValue(0);
    };
  }, [shouldMarquee, active, textW, containerW, speed, initialDelay, translateX]);

  const transparent = toTransparent(fadeColor);

  return (
    <View style={[styles.container, style]} onLayout={onContainerLayout}>
      {/* Hidden measuring copy - absolute + unconstrained → reports natural width.
          Keyed on text AND container width so it remounts (and re-fires
          onLayout) once the real container width is known. Without this, a
          recycled FlatList row can measure before layout settles, report a
          short width, decide "it fits", and render the static ellipsis branch
          forever - the lone card stuck on "...". */}
      <Text
        key={`${text}|${Math.round(containerW)}`}
        style={[textStyle, styles.measure]}
        numberOfLines={1}
        onLayout={onMeasureText}
      >
        {text}
      </Text>

      {shouldMarquee ? (
        <>
          {/* Single copy that ping-pongs. The row is pinned to the full
              measured text width so the inner Text has room to lay out in
              full - without it, numberOfLines={1} truncates the Text to the
              (bounded) container width and adds an ellipsis BEFORE it scrolls,
              so sliding it left only shifts an already-cut string and the end
              never reveals. */}
          <Animated.View style={[styles.row, { width: textW, transform: [{ translateX }] }]}>
            <Text style={[textStyle, styles.noShrink]} numberOfLines={1}>{text}</Text>
          </Animated.View>

          <Animated.View
            style={[styles.fade, styles.fadeLeft, { width: fadeWidth, opacity: leftFadeOpacity }]}
            pointerEvents="none"
          >
            <LinearGradient
              colors={[fadeColor, transparent]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <Animated.View
            style={[styles.fade, styles.fadeRight, { width: fadeWidth, opacity: rightFadeOpacity }]}
            pointerEvents="none"
          >
            <LinearGradient
              colors={[transparent, fadeColor]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
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
