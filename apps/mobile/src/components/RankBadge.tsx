import { View, Text, StyleSheet } from 'react-native';
import { Border, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

/**
 * Rank badge for the versus-card avatars. Two tiers:
 *
 *   Tier 1 - podium (#1 / #2 / #3): token-coloured disc (gold /
 *   sand / caramel) with a ring + inner highlight. Reads as "this
 *   player won the month."
 *
 *   Tier 2 - rank ≥ 4 (no cap): sober card disc with a thin
 *   primary border. Same visual for #4 and #347 - only the
 *   number changes. Reads as "ranked this month" without competing
 *   visually with the podium.
 *
 * Null / non-positive rank → renders nothing. The caller passes the
 * rank raw and the component handles the no-show branch. Decorative
 * only; tap pass-through is the parent's responsibility.
 *
 * Visual position: sits astride the top edge of the avatar, tilted
 * ~-10° for a pinned-medal effect. The parent positions it
 * absolutely; this component just renders the disc.
 */

export interface RankBadgeProps {
  /** ≥ 1 → render. Null / non-positive → render nothing. */
  rank: number | null | undefined;
  /** Disc diameter. Spec says 22-26px. Defaults to 24. */
  size?: number;
  /** Screen-reader label, e.g. "Rank 1". Optional - when omitted, the
   *  badge is purely visual and the avatar's a11y label carries the
   *  context. */
  accessibilityLabel?: string;
}

// Podium tiers (fill, ring, number) mapped onto V3 tokens, keeping the
// universally-read gold / silver / bronze order: gold fill, sand fill
// with a muted ring, caramel (bronze) fill.
const podiumColors = (c: ThemeColors): Record<1 | 2 | 3, { fill: string; ring: string; number: string }> => ({
  1: { fill: c.gold,    ring: c.gold,    number: c.onGold }, // gold
  2: { fill: c.bg3,     ring: c.muted,   number: c.text },   // silver
  3: { fill: c.caramel, ring: c.caramel, number: c.white },  // bronze
});

export function RankBadge({ rank, size = 24, accessibilityLabel }: RankBadgeProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  if (rank == null || rank < 1) return null;
  const isPodium = rank <= 3;
  // Shrink the digit so 2 / 3 / 4-digit ranks all fit in the same disc.
  // Calibrated so #1 fills the disc, #99 stays readable, #999 still
  // fits without overflowing. Beyond 4 digits the badge is cramped but
  // never clipped.
  const digits = String(rank).length;
  const fontRatio =
    digits === 1 ? 0.50 :
    digits === 2 ? 0.42 :
    digits === 3 ? 0.34 :
                   0.28;
  const fontSize = Math.round(size * fontRatio);

  if (isPodium) {
    const tier = rank as 1 | 2 | 3;
    const tierColors = podiumColors(colors)[tier];
    return (
      <View
        style={[styles.wrap, { width: size, height: size, borderRadius: size / 2 }]}
        accessibilityLabel={accessibilityLabel}
      >
        <View
          style={[
            styles.disc,
            styles.podiumDisc,
            { borderRadius: size / 2, backgroundColor: tierColors.fill, borderColor: tierColors.ring },
          ]}
        >
          {/* Inner highlight - a soft, almost-white sheen at the top
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
          <Text style={[styles.number, { fontSize, color: tierColors.number }]}>{tier}</Text>
        </View>
      </View>
    );
  }

  // Tier 2 - neutral pill for #4 through ∞. Same card surface +
  // primary thin border for every non-podium rank - only the
  // number changes - so the hierarchy reads at a glance (gold/silver/
  // bronze stand alone; everyone else shares one visual).
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
      <Text style={[styles.number, { fontSize, color: colors.text }]}>{rank}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  // Outer wrap is the consistent stacking context the parent positions
  // absolutely. Tilt sits on this so both tiers rotate the same way.
  wrap: {
    transform:      [{ rotate: '-10deg' }],
    alignItems:     'center',
    justifyContent: 'center',
    overflow:       'hidden',
    shadowColor:    c.scrim,
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
  podiumDisc: {
    borderWidth:     Border,
  },
  podiumSheen: {
    position:        'absolute',
    backgroundColor: c.photoControl,
  },
  neutralDisc: {
    // bg2 surface keeps the disc readable against light photo avatars
    // too; the primary border doubles as the "elite group" cue.
    backgroundColor: c.bg2,
    borderWidth:     Border,
    borderColor:     c.primary,
  },
  number: {
    fontWeight:        '900',
    letterSpacing:     -0.5,
    includeFontPadding: false,
  },
});
