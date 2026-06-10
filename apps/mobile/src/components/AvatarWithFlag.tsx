import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Colors } from '@/constants';
import { countryToFlag } from '@/lib/countryFlag';
import { avatarColor } from '@/lib/avatarColors';

/**
 * Circle avatar with an optional country-flag badge in the bottom-right.
 * Built for the versus layout on challenge cards but designed to be reused
 * on leaderboard rows, profile headers, and channel headers later.
 *
 * Behaviour:
 *   - photoUrl present → render the image, no fallback.
 *   - photoUrl missing → flat-color disc + first initial of displayName.
 *     Color is deterministic via avatarColor() so the same user always
 *     gets the same disc across the app.
 *   - countryCode present + valid (ISO-2) → small circular flag overlays
 *     the bottom-right corner with a thin background ring detaching it
 *     from the avatar behind. Pass null/undefined for non-international
 *     surfaces and the flag is suppressed entirely.
 *
 * Sizes are passed as props so the same component renders 80px versus
 * avatars and 40px row avatars. The flag follows the main size at a
 * fixed ratio (≈ 1/3) so the proportion reads correctly at any scale.
 */

export interface AvatarWithFlagProps {
  /** Stable identifier - drives the deterministic fallback color. */
  userId?: string | null;
  /** Display name - falls back to "?" if missing. First char only when
   *  rendering the initial. */
  displayName?: string | null;
  /** Thumbnail URL. When null/undefined the fallback initial is drawn. */
  photoUrl?: string | null;
  /** ISO-2 country code (e.g. "VN"). Anything else suppresses the flag.
   *  Pass the user's CURRENT-city country here - the flag is identity,
   *  not target / completion location. */
  countryCode?: string | null;
  /** Avatar diameter in px. Default 72 - matches the versus-layout
   *  spec (70-80 px). Flag overlay scales proportionally. */
  size?: number;
}

export function AvatarWithFlag({
  userId,
  displayName,
  photoUrl,
  countryCode,
  size = 72,
}: AvatarWithFlagProps) {
  const flag    = countryCode ? countryToFlag(countryCode) : '';
  const initial = (displayName ?? '?').slice(0, 1).toUpperCase();
  const fallbackBg = avatarColor(userId ?? displayName ?? '?');

  // Flag sits at the bottom-right, overlapping the avatar's edge. Sizes
  // scale together so a smaller avatar still gets a proportionate flag.
  const flagSize   = Math.round(size * 0.36);
  const flagOffset = -Math.round(flagSize * 0.18);

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      {photoUrl ? (
        <Image
          source={{ uri: photoUrl }}
          style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
          cachePolicy="memory-disk"
          contentFit="cover"
          transition={120}
        />
      ) : (
        <View
          style={[
            styles.avatar,
            styles.fallback,
            { width: size, height: size, borderRadius: size / 2, backgroundColor: fallbackBg },
          ]}
        >
          <Text style={[styles.initial, { fontSize: Math.round(size * 0.4) }]}>{initial}</Text>
        </View>
      )}

      {flag ? (
        <View
          style={[
            styles.flagRing,
            {
              width:        flagSize,
              height:       flagSize,
              borderRadius: flagSize / 2,
              right:        flagOffset,
              bottom:       flagOffset,
            },
          ]}
        >
          <Text style={[styles.flag, { fontSize: Math.round(flagSize * 0.78), lineHeight: flagSize }]}>
            {flag}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
  },
  avatar: {
    overflow: 'hidden',
  },
  fallback: {
    alignItems:     'center',
    justifyContent: 'center',
  },
  initial: {
    color:      '#fff',
    fontWeight: '700',
  },
  // The flag floats over the avatar with a small ring of the page-bg
  // color so it visually detaches from the avatar behind it. The text
  // emoji glyph fills the disc.
  flagRing: {
    position:       'absolute',
    alignItems:     'center',
    justifyContent: 'center',
    overflow:       'hidden',
    backgroundColor: Colors.bg2,
    borderWidth:    2,
    borderColor:    Colors.bg2,
  },
  flag: {
    textAlign: 'center',
  },
});
