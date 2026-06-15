/**
 * BrandLockup - horizontal "Hilads" wordmark.
 *
 *   [ orange "Hi" square ] + "lads"  →  reads as one word: "Hilads"
 *
 * The square is the existing <HiladsIcon/> (geometric H + ¡ letterform in
 * white on the brand orange gradient). We append the text "lads" right after
 * it so the brand NAME is finally visible in the UI (it appeared nowhere
 * before - only the mark + tagline).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  TUNING - everything you'll want to iterate on lives in LOCKUP below.
 *  Change a value, hot-reload, eyeball it. Nothing else is hard-coded.
 * ─────────────────────────────────────────────────────────────────────────
 */

import React from 'react';
import { View, Text, Platform, StyleSheet } from 'react-native';
import { HiladsIcon } from '@/components/HiladsIcon';
import { Colors } from '@/constants';

/**
 * ✏️  TUNE ME. Single source of truth for the lockup's look.
 */
export const LOCKUP = {
  /** Size (px) of the orange "Hi" square. 36 == current header logo. */
  iconSize: 36,

  /** "lads" font size. ~0.72× iconSize visually matches the "Hi" cap-height. */
  ladsFontSize: 26,

  /**
   * "lads" weight. The mark's bars are chunky/geometric, so go heavy.
   *   '700' = bold · '800' = extra-bold (default) · '900' = black
   */
  ladsFontWeight: '800' as
    '400' | '500' | '600' | '700' | '800' | '900',

  /**
   * "lads" font family. Three quick-swap options:
   *   A) undefined         → System default + heavy weight (default, zero setup)
   *   B) iOS 'Avenir Next' geometric / Android 'sans-serif-black' (heavier feel)
   *        Platform.select({ ios: 'AvenirNext-Heavy', android: 'sans-serif-black' })
   *   C) a custom brand font loaded via expo-font (best match, needs the asset)
   *        e.g. 'Poppins_800ExtraBold' once added to the font map
   */
  ladsFontFamily: undefined as string | undefined,

  /** Tracking on "lads". Slightly tight reads more like one word. */
  ladsLetterSpacing: 0.3,

  /** Horizontal gap (px) between the square and "lads". Small = tighter word. */
  gap: 1,

  /**
   * Vertical nudge (px) applied to "lads" only. +down / -up. Use this to sit
   * the text's optical centre on the square's centre after a size change.
   */
  ladsVerticalOffset: 0,

  /**
   * "lads" colour. Defaults to the brand warm-white (matches the rest of the
   * header text). For an EXACT match to the white glyphs inside the square use
   * Colors.white ('#ffffff'); for an all-orange wordmark use Colors.accent.
   */
  ladsColor: Colors.text,

  /** Warm glow behind the square only (text stays crisp). Tunable. */
  glow: {
    color:   '#C24A38',
    opacity: 0.55,
    radius:  14,
  },
} as const;

interface Props {
  /** Override the square size for non-header placements (keeps text in ratio). */
  iconSize?: number;
  /** Cast the brand glow behind the square (header default). */
  glow?: boolean;
  /** Extra container style (margins, etc.). */
  style?: object;
}

export function BrandLockup({ iconSize, glow = false, style }: Props) {
  const sqSize   = iconSize ?? LOCKUP.iconSize;
  // Keep "lads" proportional if the caller resizes the square.
  const fontSize = LOCKUP.ladsFontSize * (sqSize / LOCKUP.iconSize);

  // Glow wraps ONLY the square so "lads" doesn't pick up a red halo.
  const glowStyle = glow ? {
    shadowColor:   LOCKUP.glow.color,
    shadowOffset:  { width: 0, height: 0 },
    shadowOpacity: LOCKUP.glow.opacity,
    shadowRadius:  LOCKUP.glow.radius,
    elevation:     10,
  } : null;

  return (
    <View
      style={[styles.row, { gap: LOCKUP.gap }, style]}
      accessibilityRole="header"
      accessibilityLabel="Hilads"
    >
      <View style={glowStyle}>
        <HiladsIcon size={sqSize} />
      </View>
      <Text
        style={[
          styles.lads,
          {
            fontSize,
            fontWeight:    LOCKUP.ladsFontWeight,
            fontFamily:    LOCKUP.ladsFontFamily,
            letterSpacing: LOCKUP.ladsLetterSpacing,
            color:         LOCKUP.ladsColor,
            marginTop:     LOCKUP.ladsVerticalOffset,
          },
        ]}
        allowFontScaling={false}
      >
        lads
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems:    'center',
  },
  lads: {
    // Strip Android's extra glyph padding so the baseline aligns tightly with
    // the square; harmless on iOS.
    includeFontPadding: false,
    padding: 0,
  },
});
