import { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Easing } from 'react-native';
import { Colors } from '@/constants';

/**
 * Placeholder for the "no taker yet" right-hand slot on a challenge card's
 * versus layout. Dashed orange ring at the size of the challenger's avatar
 * with a centered + glyph, breathing on a 2.4s loop to invite a take-on.
 *
 * The pulse is intentionally subtle - opacity 0.85 → 1.0, scale 1.00 → 1.05
 * - so a long feed of open challenges doesn't strobe. `animated={false}`
 * stops the loop entirely (callers drive this from FlatList's
 * onViewableItemsChanged so off-screen cards don't pulse).
 *
 * Tap goes straight to the onPress handler so a user can take on a
 * challenge without first opening its detail page. The whole card
 * remains tappable too; this slot just shortcuts to /accept.
 */

export interface OpenChallengeSlotProps {
  /** Slot diameter - matches the avatar size on the same card. */
  size?: number;
  /** When false, the resting pulse stops on the current frame. Use this
   *  with FlatList viewability so the loop doesn't redraw off-screen. */
  animated?: boolean;
  /** Optional tap target. When provided the slot becomes a button (the
   *  card itself is still tappable too - see the card's wrapper). */
  onPress?: () => void;
  /** A11y label for screen readers ("Take this challenge on"). */
  accessibilityLabel?: string;
}

export function OpenChallengeSlot({
  size = 72,
  animated = true,
  onPress,
  accessibilityLabel,
}: OpenChallengeSlotProps) {
  // Driver feeds both the opacity tween and the scale tween. Native
  // driver - no JS heap pressure during the loop, key for keeping the
  // feed buttery on entry-level Android.
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animated) {
      pulse.stopAnimation();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue:  1,
          duration: 1200,
          easing:   Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue:  0,
          duration: 1200,
          easing:   Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animated, pulse]);

  const scale   = pulse.interpolate({ inputRange: [0, 1], outputRange: [1.0, 1.05] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.0] });

  const plusFontSize = Math.round(size * 0.42);

  const slot = (
    <Animated.View
      style={[
        styles.slot,
        {
          width:        size,
          height:       size,
          borderRadius: size / 2,
          transform:    [{ scale }],
          opacity,
        },
      ]}
    >
      <Text style={[styles.plus, { fontSize: plusFontSize, lineHeight: plusFontSize + 2 }]}>+</Text>
    </Animated.View>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      >
        {slot}
      </TouchableOpacity>
    );
  }
  return slot;
}

const styles = StyleSheet.create({
  // Dashed orange ring. RN's borderStyle: 'dashed' on iOS is reliable on
  // circular borders only when borderWidth is consistent on all sides
  // (which is the case here) and the radius matches half the size.
  slot: {
    borderWidth:     2,
    borderStyle:     'dashed',
    borderColor:     'rgba(255,122,60,0.45)',
    backgroundColor: 'rgba(255,122,60,0.05)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  plus: {
    color:        'rgba(255,122,60,0.70)',
    fontWeight:   '300',  // thinner stroke reads as a "+" not a "plus button"
    textAlign:    'center',
    includeFontPadding: false,
  },
});
