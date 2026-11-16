import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Motion } from '@/constants';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * The one press feedback (design pass): every tappable card, tile, row and button scales to 0.97
 * on the UI thread and gives a light selection haptic. Reduce motion: no scale, a slight dim instead.
 * `haptic={false}` for rapid repeats (a carousel's dots).
 */
export function Tappable({ children, style, onPress, haptic = true, disabled, ...rest }: Omit<PressableProps, 'style' | 'children'> & {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  haptic?: boolean;
}) {
  const reduce = useReducedMotion();
  const pressed = useSharedValue(0);
  const anim = useAnimatedStyle(() => reduce
    ? { opacity: 1 - pressed.value * 0.15 }
    : { transform: [{ scale: 1 - pressed.value * (1 - Motion.pressScale) }] });
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      style={[style, anim]}
      onPressIn={(e) => { pressed.value = withTiming(1, { duration: Motion.fast }); rest.onPressIn?.(e); }}
      onPressOut={(e) => { pressed.value = withSpring(0, Motion.spring); rest.onPressOut?.(e); }}
      onPress={(e) => {
        if (haptic) Haptics.selectionAsync().catch(() => {});
        onPress?.(e);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}
