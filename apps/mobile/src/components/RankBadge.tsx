import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants';

/**
 * Rank badge for the versus-card avatars. Two tiers:
 *
 *   Tier 1 — podium (#1 / #2 / #3): metallic gradient disc with a
 *   subtle ring + inner highlight. Reads as "this player won the
 *   month."
 *
 *   Tier 2 — top-10 (#4..#10): sober dark disc with a thin
 *   accent-orange border. Reads as "elite group" without competing
 *   visually with the podium.
 *
 * Ranks ≥ 11 (or null) render nothing — the caller passes the rank
 * raw and the component handles the no-show branch. Decorative only;
 * tap pass-through is the parent's responsibility.
 *
 * Visual position: sits astride the top edge of the avatar, tilted
 * ~-10° for a pinned-medal effect. The parent positions it
 * absolutely; this component just renders the disc.
 */

export interface RankBadgeProps {
  /** 1..10 → render. Null / out-of-range → render nothing. */
  rank: number | null | undefined;
  /** Disc diameter. Spec says 22-26px. Defaults to 24. */
  size?: number;
  /** Screen-reader label, e.g. "Rank 1". Optional — when omitted, the
   *  badge is purely visual and the avatar's a11y label carries the
   *  context. */
  accessibilityLabel?: string;
}

// Podium colour stops (start, end). Aligned with the universally-read
// gold/silver/bronze palette so users don't need to learn a new
// vocabulary. End stop is slightly darker so the disc reads as 3D.
const PODIUM_GRADIENTS: Record<1 | 2 | 3, [string, string]> = {
  1: ['#FFE17A', '#C8A02E'], // gold
  2: ['#E9E9E9', '#9C9C9C'], // silver
  3: ['#E0A36F', '#8B5A33'], // bronze
};
const PODIUM_NUMBER_COLOR: Record<1 | 2 | 3, string> = {
  1: '#3B2F00',
  2: '#2A2A2A',
  3: '#3A1F0A',
};

export function RankBadge({ rank, size = 24, accessibilityLabel }: RankBadgeProps) {
  if (rank == null || rank < 1 || rank > 10) return null;
  const isPodium = rank <= 3;
  const fontSize = Math.round(size * (rank === 10 ? 0.42 : 0.50));

  if (isPodium) {
    const tier = rank as 1 | 2 | 3;
    const [start, end] = PODIUM_GRADIENTS[tier];
    return (
      <View
        style={[styles.wrap, { width: size, height: size, borderRadius: size / 2 }]}
        accessibilityLabel={accessibilityLabel}
      >
        <LinearGradient
          colors={[start, end]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={[styles.disc, { borderRadius: size / 2 }]}
        >
          {/* Inner highlight — a soft, almost-white sheen at the top
              left so the disc reads as a polished metal coin instead
              of a flat fill. Pure visual; positioned via a small
              absolute overlay. */}
          <View
            style={[
              styles.podiumSheen,
              {
                top:    size * 0.08,
                left:   size * 0.12,
                width:  size * 0.36,
                height: size * 0.18,
                borderRadius: size * 0.18,
              },
            ]}
            pointerEvents="none"
          />
          <Text style={[styles.number, { fontSize, color: PODIUM_NUMBER_COLOR[tier] }]}>{tier}</Text>
        </LinearGradient>
      </View>
    );
  }

  // Tier 2 — neutral pill. Dark surface + accent-orange thin border,
  // no glow, no gradient. Visually one level "down" from the podium
  // so the eye reads the hierarchy at a glance.
  return (
    <View
      style={[
        styles.wrap,
        styles.neutralDisc,
        {
          width:        size,
          height:       size,
          borderRadius: size / 2,
        },
      ]}
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={[styles.number, { fontSize, color: '#fff' }]}>{rank}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Outer wrap is the consistent stacking context the parent positions
  // absolutely. Tilt sits on this so both tiers rotate the same way.
  wrap: {
    transform:      [{ rotate: '-10deg' }],
    alignItems:     'center',
    justifyContent: 'center',
    overflow:       'hidden',
    shadowColor:    '#000',
    shadowOpacity:  0.35,
    shadowRadius:   3,
    shadowOffset:   { width: 0, height: 1 },
  },
  disc: {
    width:          '100%',
    height:         '100%',
    alignItems:     'center',
    justifyContent: 'center',
  },
  podiumSheen: {
    position:        'absolute',
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  neutralDisc: {
    // bg2 surface keeps the disc readable against light photo avatars
    // too; the orange border doubles as the "elite group" cue.
    backgroundColor: Colors.bg2,
    borderWidth:     1.5,
    borderColor:     'rgba(255,122,60,0.65)',
  },
  number: {
    fontWeight:        '900',
    letterSpacing:     -0.5,
    includeFontPadding: false,
  },
});
