/**
 * BrandLockup - the brand block in the app header.
 *
 *   [ orange "Hi" square ]   Hilads
 *                            Become local. Anywhere.
 *
 * The square is the existing <HiladsIcon/> (the brand mark). Beside it we
 * stack the brand NAME "Hilads" (bright, distinct type - it's the brand)
 * over the tagline, so the name is finally visible in the UI. The tagline is
 * optional so the same block can be reused elsewhere (e.g. the ME screen).
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  TUNING - everything you'll want to iterate on lives in LOCKUP below.
 *  Change a value, hot-reload, eyeball it.
 * ─────────────────────────────────────────────────────────────────────────
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { HiladsIcon } from '@/components/HiladsIcon';
import { type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

/**
 * ✏️  TUNE ME. Single source of truth for the brand block's look.
 */
export const LOCKUP = {
  /** Size (px) of the orange "Hi" square. 36 == current header logo. */
  iconSize: 36,

  /** Gap (px) between the square and the text column. */
  gap: 9,

  // ── "Hilads" brand name ────────────────────────────────────────────────
  /** Name size. Bigger than the tagline so it leads the eye. */
  nameFontSize: 17,
  /**
   * Name weight - heavier than the thin tagline so it reads as the brand.
   *   '600' = semibold · '700' = bold (default) · '800' = extra-bold
   */
  nameFontWeight: '700' as '400' | '500' | '600' | '700' | '800' | '900',
  /**
   * Name font family. Distinct "brand" type. Quick-swap options:
   *   A) undefined  → System default + heavy weight (default, zero setup)
   *   B) Platform.select({ ios: 'AvenirNext-Bold', android: 'sans-serif-medium' })
   *   C) a custom brand font via expo-font (best match, needs the asset)
   */
  nameFontFamily: undefined as string | undefined,
  /** Name tracking. */
  nameLetterSpacing: 0.2,
  /** Name colour. Full-opacity warm-white = visible. colors.accent = orange. */
  // nameColor is applied per-theme in the component (colors.text).

  // ── "Become local. Anywhere." tagline (line under the name) ─────────────
  /** Render the tagline under the name. */
  taglineFontSize: 11,
  taglineLineHeight: 14,
  // taglineColor is applied per-theme in the component (colors.overlayStrong).
  taglineFontWeight: '400' as '400' | '500' | '600' | '700',
  taglineLetterSpacing: 0.2,
  /** Cap so a long locale can't blow up the header; raise if the line clips. */
  taglineMaxWidth: 180,

  // ── Glow behind the square only (text stays crisp) ──────────────────────
  glow: {
    color:   '#C24A38',
    opacity: 0.55,
    radius:  14,
  },
} as const;

interface Props {
  /** Override the square size for non-header placements. */
  iconSize?: number;
  /** Cast the brand glow behind the square (header default). */
  glow?: boolean;
  /** Tagline text under the name. Omit to render the name alone. */
  tagline?: string;
  /** Extra container style (margins, etc.). */
  style?: object;
}

export function BrandLockup({ iconSize, glow = false, tagline, style }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const sqSize = iconSize ?? LOCKUP.iconSize;

  // Glow wraps ONLY the square so the text doesn't pick up a red halo.
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

      <View style={styles.textCol}>
        <Text
          style={{
            fontSize:      LOCKUP.nameFontSize,
            fontWeight:    LOCKUP.nameFontWeight,
            fontFamily:    LOCKUP.nameFontFamily,
            letterSpacing: LOCKUP.nameLetterSpacing,
            color:         colors.text,
            includeFontPadding: false,
          }}
          allowFontScaling={false}
        >
          Hilads
        </Text>

        {tagline ? (
          <Text
            style={{
              fontSize:      LOCKUP.taglineFontSize,
              lineHeight:    LOCKUP.taglineLineHeight,
              color:         colors.overlayStrong,
              fontWeight:    LOCKUP.taglineFontWeight,
              letterSpacing: LOCKUP.taglineLetterSpacing,
              maxWidth:      LOCKUP.taglineMaxWidth,
            }}
            allowFontScaling={false}
          >
            {tagline}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems:    'center',
  },
  textCol: {
    justifyContent: 'center',
  },
});
