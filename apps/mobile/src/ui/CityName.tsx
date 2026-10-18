import { Text, View, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { Image } from 'expo-image';
import { type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { localizeCityName, shortCityName } from '@/i18n/cityName';
import { FLAGS } from './flags';

/**
 * A city's country flag: a bundled SVG (4:3, about 16 pt wide) with a hairline
 * border so white flags stay visible. It stands for the place, never for a
 * person's nationality, and is decorative: screen readers read the city name
 * next to it. Nothing for a missing or unknown code.
 */
export function CityFlag({ country, size = 16 }: { country: string | null | undefined; size?: number }) {
  const styles = useThemedStyles(makeStyles);
  const source = country ? FLAGS[country.toUpperCase()] : undefined;
  if (!source) return null;
  return (
    <View style={[styles.flag, { width: size, height: Math.round(size * 0.75) }]}
          accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" />
      <View style={[StyleSheet.absoluteFill, styles.hairline]} />
    </View>
  );
}

/** Flag + localized city name on one line; short = the city's short name ("Saigon") where space is tight. */
export function CityName({ name, country, short = false, style, size }: {
  name: string | null | undefined;
  country: string | null | undefined;
  short?: boolean;
  style?: StyleProp<TextStyle>;
  size?: number;
}) {
  const styles = useThemedStyles(makeStyles);
  if (!name) return null;
  return (
    <View style={styles.row}>
      <CityFlag country={country} size={size} />
      <Text style={[styles.text, style]} numberOfLines={1}>{short ? shortCityName(name) : localizeCityName(name)}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  flag:     { borderRadius: 2, overflow: 'hidden' },
  hairline: { borderRadius: 2, borderWidth: StyleSheet.hairlineWidth, borderColor: c.flagLine },
  row:      { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1, minWidth: 0 },
  text:     { flexShrink: 1 },
});
