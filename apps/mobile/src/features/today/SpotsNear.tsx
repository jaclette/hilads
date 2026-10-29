import { useCallback, useState } from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useScope } from '@/context/ScopeContext';
import { fetchSpotsNear, type Spot } from '@/api/spots';
import { shortCityName } from '@/i18n/cityName';

/**
 * Spots near you (SPEC 9.3, V3 polish 3.4): one slim row, "12 spots near you ·
 * Open map" (the Map owns the spots); hidden when there's none around. Uses
 * the phone's position only when location is already allowed (Today never
 * asks), else the city centre; World scope uses the city centre too. When the
 * city has no spot yet, the nearest ones anywhere show with a note. In a city
 * I'm not in, the list is centred on it: "Spots in <city>".
 */
export function SpotsNear({ cityId, refreshKey }: { cityId: string | null; refreshKey: number }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { scope } = useScope();
  const [spots, setSpots] = useState<Spot[] | null>(null);
  const [fallback, setFallback] = useState(false);
  // Centred on the chosen city when I'm not in it: "Spots in <city>".
  const [away, setAway] = useState<{ name: string; country: string | null } | null>(null);

  const load = useCallback(async () => {
    let pos: { lat: number; lng: number } | null = null;
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.granted && scope === 'city') {
        const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 });
        if (last) pos = { lat: last.coords.latitude, lng: last.coords.longitude };
      }
    } catch { /* no position: city centre */ }
    if (!pos && !cityId) { setSpots([]); return; }
    try {
      const res = await fetchSpotsNear({ ...(pos ?? {}), cityId: pos ? (scope === 'city' ? cityId : null) : cityId });
      setSpots(res.items);
      setFallback(res.fallback);
      setAway(scope === 'city' && res.center === 'city' && res.city ? res.city : null);
    } catch {
      setSpots(s => s ?? []);
    }
  }, [cityId, scope, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openMap = (spotId?: string) => router.push((spotId ? `/(tabs)/map?spot=${spotId}&source=today` : '/(tabs)/map?source=today') as never);

  if (spots === null || spots.length === 0 || fallback) return null;
  // One slim row: the Map owns the spots (V3 polish 3.4).
  const label = away ? t('today.spotsTeaserIn', { count: spots.length, city: shortCityName(away.name) }) : t('today.spotsTeaser', { count: spots.length });
  return (
    <TouchableOpacity style={styles.teaser} onPress={() => openMap()} accessibilityRole="button" testID="today-spots"
                      accessibilityLabel={`${label}. ${t('today.openMap')}`}>
      <View style={styles.pin}><Ionicons name="location" size={18} color={colors.primaryText} /></View>
      <Text style={styles.teaserText} numberOfLines={1}>{label}</Text>
      <Text style={styles.open}>{t('today.openMap')}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.primaryText} />
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  teaser:     { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 12, paddingVertical: 8,
                borderRadius: 16, borderWidth: 1.5, borderColor: c.line, backgroundColor: c.bg2 },
  pin:        { width: 32, height: 32, borderRadius: 16, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  teaserText: { flex: 1, fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  open:       { fontSize: 13, fontWeight: '800', color: c.primaryText },
});
