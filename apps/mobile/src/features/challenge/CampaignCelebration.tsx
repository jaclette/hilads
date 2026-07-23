/**
 * One-shot celebration overlay shown when a user opens a Hilads CAMPAIGN
 * challenge (2× points) - especially when arriving from a campaign push.
 *
 * Emoji confetti rains down + a gold "⚡ 2× POINTS" badge pops in, holds, and
 * fades. Purely transform/opacity animations on the native driver (no layout
 * props, no external lib) so it stays smooth and can't wedge the screen.
 * pointerEvents="none" so it never blocks taps underneath.
 */
import { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, Text, View } from 'react-native';
import { Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const EMOJIS = ['⚡', '🎉', '🏆', '✨', '🔥', '⭐', '🥳'];
const PIECES = 18;

export function CampaignCelebration({ onDone }: { onDone: () => void }) {
  const styles = useThemedStyles(makeStyles);

  const badge = useRef(new Animated.Value(0)).current; // scale + opacity

  // Stable per-piece config (positions/timings fixed for the run's lifetime).
  const pieces = useRef(
    Array.from({ length: PIECES }, (_, i) => ({
      x:     Math.random() * SCREEN_W,
      emoji: EMOJIS[i % EMOJIS.length],
      drive: new Animated.Value(0),
      spin:  Math.random() * 2 - 1,            // -1..1 → rotation direction/amount
      delay: Math.random() * 260,
      dur:   1500 + Math.random() * 1000,
      size:  20 + Math.random() * 16,
    })),
  ).current;

  useEffect(() => {
    const confetti = pieces.map(p =>
      Animated.timing(p.drive, {
        toValue: 1, duration: p.dur, delay: p.delay,
        easing: Easing.out(Easing.quad), useNativeDriver: true,
      }),
    );
    const badgeSeq = Animated.sequence([
      Animated.spring(badge, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }),
      Animated.delay(1500),
      Animated.timing(badge, { toValue: 0, duration: 350, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]);

    const anim = Animated.parallel([...confetti, badgeSeq]);
    anim.start(({ finished }) => { if (finished) onDone(); });
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.overlay} pointerEvents="none">
      {pieces.map((p, i) => {
        const translateY = p.drive.interpolate({ inputRange: [0, 1], outputRange: [-48, SCREEN_H * 0.7] });
        const opacity    = p.drive.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 1, 0] });
        const rotate     = p.drive.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${Math.round(p.spin * 360)}deg`] });
        return (
          <Animated.Text
            key={i}
            style={[styles.piece, { left: p.x, fontSize: p.size, opacity, transform: [{ translateY }, { rotate }] }]}
          >
            {p.emoji}
          </Animated.Text>
        );
      })}

      <View style={styles.badgeWrap} pointerEvents="none">
        <Animated.View
          style={[
            styles.badge,
            { opacity: badge, transform: [{ scale: badge.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] },
          ]}
        >
          <Text style={styles.badgeText}>⚡ 2× POINTS!</Text>
        </Animated.View>
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 50 },
  piece:   { position: 'absolute', top: 0 },
  badgeWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  badge: {
    backgroundColor: '#fbbf24',
    paddingHorizontal: 22, paddingVertical: 12, borderRadius: Radius.full,
    shadowColor: '#fbbf24', shadowOpacity: 0.6, shadowRadius: 16, shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  badgeText: { fontSize: 22, fontWeight: '900', color: '#1a1205', letterSpacing: 0.4 },
});
