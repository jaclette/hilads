import { Text, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { avatarColor } from '@/lib/avatarColors';

/**
 * Round avatar: the photo, else the initial on a tinted ground (`tint`) or on
 * the person's own color (`color`). `ring` adds the primary ring (Passport).
 */
export function Avatar({ uri, name, size, fallback = 'tint', ring = false }: {
  uri?: string | null;
  name: string;
  size: number;
  fallback?: 'tint' | 'color';
  ring?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const box = { width: size, height: size };
  const tint = fallback === 'tint';
  if (uri) {
    return <Image source={{ uri }} style={[styles.round, box, tint && styles.tint, ring && styles.ring]} contentFit="cover" />;
  }
  const initial = (name.replace('@', '') || '?')[0].toUpperCase();
  const textSize = size >= 56 ? styles.lg : size >= 36 ? styles.md : styles.sm;
  return (
    <View style={[styles.round, styles.center, box, tint ? styles.tint : { backgroundColor: avatarColor(name) }, ring && styles.ring]}>
      <Text style={[textSize, tint ? styles.onTint : styles.onColor]}>{initial}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  round:   { borderRadius: Radius.full },
  center:  { alignItems: 'center', justifyContent: 'center' },
  tint:    { backgroundColor: c.primaryTint },
  ring:    { borderWidth: 2.5, borderColor: c.primary },
  // Each size carries its weight: src/scaling.ts gives a size-only text style the Regular family.
  lg:      { fontSize: 24, fontWeight: '800' },
  md:      { fontSize: FontSizes.sm, fontWeight: '800' },
  sm:      { fontSize: FontSizes.xs, fontWeight: '800' },
  onTint:  { color: c.primaryOnTint },
  onColor: { color: c.white },
});
