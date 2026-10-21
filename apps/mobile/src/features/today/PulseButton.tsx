import { useEffect, useState } from 'react';
import { AppState, Pressable, Text, View, StyleSheet } from 'react-native';
import Animated, {
  Easing, cancelAnimation, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue,
  withDelay, withRepeat, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { useIsFocused } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { FontSizes } from '@/constants';
import { TANGERINE, TANGERINE_TEXT } from '@/ui/joy';

const CYCLE_MS      = 1600;   // one ring's expansion
const FAST_CYCLE_MS = 1200;   // the last 3 hours before the next drop
const GROW_X = 0.08;          // the ring ends 8% wider ...
const GROW_Y = 0.5;           // ... and 50% taller than the button

/** The button on the hero's photo (SPEC 9.3): white, or the "sun orange" option. */
const TONES = {
  white: { bg: '#FFFFFF', ring: 'rgba(255,255,255,0.75)' },
  sun:   { bg: '#FF7A3D', ring: '#FF7A3D' },
} as const;
export type PulseTone = keyof typeof TONES;
const INK = '#2A1C13';

/**
 * Today's "I'm in" (SPEC 9.3): the hero's camera button (white, ink label,
 * tangerine camera icon) with a continuous pulse, two white rings (75%) in relay
 * expanding from its edge while fading
 * (1.6 s, the second 0.8 s later; 1.2 s in the last 3 hours). The pulse runs
 * only while `visible` (the card on screen), the tab is focused and the app is
 * in the foreground. A press gives light haptics, scales the button to 0.97
 * and grows a tangerine disc from it before `onPress` opens the camera. The OS
 * "reduce motion" setting turns all of it off: a static button.
 */
export function PulseButton({ label, onPress, fast, visible, intercept, tone = 'white' }: {
  label: string; onPress: () => void; fast: boolean; visible: boolean; tone?: PulseTone;
  /** Called on press first: true = handled elsewhere (the how-it-works sheet), no transition. */
  intercept?: () => boolean;
}) {
  const { bg, ring } = TONES[tone];
  const reduceMotion = useReducedMotion();
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => setForeground(s === 'active'));
    return () => sub.remove();
  }, []);

  const ring1 = useSharedValue(0);
  const ring2 = useSharedValue(0);
  const press = useSharedValue(1);
  const reveal = useSharedValue(0);
  const running = visible && focused && foreground && !reduceMotion;
  const cycle = fast ? FAST_CYCLE_MS : CYCLE_MS;

  useEffect(() => {
    if (!running) {
      cancelAnimation(ring1); cancelAnimation(ring2);
      ring1.value = 0; ring2.value = 0;
      return;
    }
    const loop = () => withRepeat(withTiming(1, { duration: cycle, easing: Easing.out(Easing.quad) }), -1, false);
    ring1.value = 0; ring2.value = 0;
    ring1.value = loop();
    ring2.value = withDelay(cycle / 2, loop());
    return () => { cancelAnimation(ring1); cancelAnimation(ring2); };
  }, [running, cycle, ring1, ring2]);

  // Back from the camera: the disc is gone, the button full size.
  useEffect(() => { if (focused) { reveal.value = 0; press.value = 1; } }, [focused, reveal, press]);

  const ring1Style = useAnimatedStyle(() => ringFrame(ring1));
  const ring2Style = useAnimatedStyle(() => ringFrame(ring2));
  const buttonStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  const revealStyle = useAnimatedStyle(() => ({
    opacity: reveal.value === 0 ? 0 : 1,
    transform: [{ scale: reveal.value * 24 }],
  }));

  const go = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (intercept?.()) return;
    if (reduceMotion) { onPress(); return; }
    // The camera opens "from the button": a tangerine disc grows out of it first.
    reveal.value = withTiming(1, { duration: 240, easing: Easing.in(Easing.quad) }, done => { if (done) runOnJS(onPress)(); });
  };

  return (
    <View style={styles.wrap}>
      {!reduceMotion && <Animated.View pointerEvents="none" style={[styles.ring, { borderColor: ring }, ring1Style]} />}
      {!reduceMotion && <Animated.View pointerEvents="none" style={[styles.ring, { borderColor: ring }, ring2Style]} />}
      <Animated.View style={buttonStyle}>
        <Pressable
          onPressIn={() => { if (!reduceMotion) press.value = withTiming(0.97, { duration: 90 }); }}
          onPressOut={() => { if (!reduceMotion) press.value = withTiming(1, { duration: 140 }); }}
          onPress={go}
          style={[styles.button, { backgroundColor: bg }]}
          accessibilityRole="button"
          accessibilityLabel={label}
          testID="today-play"
        >
          <Ionicons name="camera-outline" size={20} color={tone === 'white' ? TANGERINE_TEXT : INK} />
          <Text style={styles.label} numberOfLines={1}>{label}</Text>
        </Pressable>
      </Animated.View>
      {!reduceMotion && <Animated.View pointerEvents="none" style={[styles.reveal, { backgroundColor: TANGERINE }, revealStyle]} />}
    </View>
  );
}

/** A ring at progress p (0 → 1): from the button's edge, outward, fading. */
function ringFrame(p: SharedValue<number>) {
  'worklet';
  return {
    opacity: p.value === 0 ? 0 : 1 - p.value,
    transform: [{ scaleX: 1 + GROW_X * p.value }, { scaleY: 1 + GROW_Y * p.value }],
  };
}

const HEIGHT = 52;
const RADIUS = 16;

const styles = StyleSheet.create({
  wrap:   { height: HEIGHT, justifyContent: 'center' },
  ring:   { ...StyleSheet.absoluteFillObject, borderWidth: 2, borderRadius: RADIUS },
  button: { height: HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: RADIUS, paddingHorizontal: 16 },
  label:  { fontSize: FontSizes.md, fontWeight: '800', color: INK },
  // The disc the camera "opens from": centred on the button, grown by scale.
  reveal: { position: 'absolute', alignSelf: 'center', width: HEIGHT, height: HEIGHT, borderRadius: HEIGHT / 2, zIndex: 2 },
});
