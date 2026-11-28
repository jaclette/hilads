import { Text, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { thumbUrl } from '@/lib/imageThumb';
import { THEME_COLORS, tint } from './joy';

/** The avatar sizes: a tile or row footer, a list row, a profile head. */
export const AvatarSize = { sm: 24, md: 40, lg: 72 } as const;

// The theme color pairs an initial can wear (one per person, stable): never two peaches.
const PAIRS = ['hidden_gem', 'taste', 'get_around', 'local_find', 'night_out', 'sip'] as const;

function pairFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return THEME_COLORS[PAIRS[Math.abs(h) % PAIRS.length]];
}

/**
 * Round avatar (design pass): the photo, else ONE fallback everywhere: the initial in a theme's
 * color on that color's soft tint, stable per person. `ring` adds the primary ring (Passport).
 * `fallback` is kept for older callers; both values draw the same fallback now.
 * An uploaded photo shows at its ≤400 px size (never the original, up to 1600 px).
 */
export function Avatar({ uri, name, size, ring = false }: {
  uri?: string | null;
  name: string;
  size: number;
  fallback?: 'tint' | 'color';
  ring?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const { theme } = useTheme();
  const box = { width: size, height: size };
  if (uri) {
    return <Image source={{ uri: thumbUrl(uri) ?? uri }} style={[styles.round, box, styles.photo, ring && styles.ring]} contentFit="cover" cachePolicy="memory-disk" />;
  }
  const clean = name.replace('@', '').trim() || '?';
  const pair = pairFor(clean.toLowerCase());
  const ink = theme === 'dark' ? pair.textDark : pair.textLight;
  return (
    <View style={[styles.round, styles.center, box, { backgroundColor: tint(pair.fill, theme === 'dark' ? 0.22 : 0.26) }, ring && styles.ring]}>
      {/* Sized from the box (both inline, so scaling.ts leaves the pair proportional); weight kept with it. */}
      {/* The circle has a fixed size, so its letter does too: system font scaling would clip it (Android 200%). */}
      <Text style={[styles.initial, { fontSize: Math.round(size * 0.44), color: ink }]} allowFontScaling={false}>{clean[0].toUpperCase()}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  round:   { borderRadius: Radius.full },
  center:  { alignItems: 'center', justifyContent: 'center' },
  photo:   { backgroundColor: c.bg3 },
  ring:    { borderWidth: 2.5, borderColor: c.primary },
  initial: { fontWeight: '800' },
});
