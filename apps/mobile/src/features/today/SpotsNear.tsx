import { useCallback, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useScope } from '@/context/ScopeContext';
import { fetchSpotsNear, type Spot } from '@/api/spots';
import { compactPrice, distance } from './format';
import { SectionTitle } from '@/ui';

/**
 * Spots near you (SPEC 9.3): the 2-3 nearest spots, linking to the Map. Uses
 * the phone's position only when location is already allowed (Today never
 * asks), else the city centre; World scope uses the city centre too. When the
 * city has no spot yet, the nearest ones anywhere show with a note.
 */
export function SpotsNear({ cityId, refreshKey }: { cityId: string | null; refreshKey: number }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const router = useRouter();
  const { scope } = useScope();
  const [spots, setSpots] = useState<Spot[] | null>(null);
  const [fallback, setFallback] = useState(false);

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
    } catch {
      setSpots(s => s ?? []);
    }
  }, [cityId, scope, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openMap = (spotId?: string) => router.push((spotId ? `/(tabs)/map?spot=${spotId}&source=today` : '/(tabs)/map?source=today') as never);

  if (spots === null) return null;
  return (
    <View style={styles.wrap}>
      <SectionTitle title={t('today.spotsTitle')} action={{ label: t('today.openMap'), onPress: () => openMap() }} />
      {fallback && spots.length > 0 && <Text style={styles.note}>{t('today.spotsFallback')}</Text>}
      {spots.length === 0 ? (
        <TouchableOpacity style={styles.empty} onPress={() => openMap()} accessibilityRole="button">
          <Ionicons name="location-outline" size={22} color={colors.primaryText} />
          <Text style={styles.emptyText}>{t('today.spotsEmpty')}</Text>
        </TouchableOpacity>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards}>
          {spots.map(s => (
            <TouchableOpacity key={s.id} style={styles.card} onPress={() => openMap(s.id)} activeOpacity={0.85}
                              accessibilityRole="button" accessibilityLabel={s.name}>
              {s.cover.thumbUrl || s.cover.photoUrl
                ? <Image source={{ uri: s.cover.thumbUrl ?? s.cover.photoUrl ?? undefined }} style={styles.photo} contentFit="cover" />
                : <View style={styles.photo} />}
              <View style={styles.body}>
                <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
                <View style={styles.meta}>
                  {s.distanceM !== undefined && (
                    <View style={styles.metaItem}>
                      <Ionicons name="location-outline" size={13} color={colors.muted} />
                      <Text style={styles.metaText}>{distance(s.distanceM, i18n.language)}</Text>
                    </View>
                  )}
                  {s.priceRange && <Text style={styles.metaText}>{compactPrice(s.priceRange.min, s.priceRange.currency, i18n.language)}</Text>}
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:      { gap: 8 },
  note:      { fontSize: 12, color: c.muted },
  cards:     { gap: 10 },
  card:      { width: 150, backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line, borderRadius: 16, overflow: 'hidden' },
  photo:     { height: 62, backgroundColor: c.primaryTint },
  body:      { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10, gap: 4 },
  name:      { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  meta:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  metaItem:  { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText:  { fontSize: 12, fontWeight: '600', color: c.muted },
  empty:     { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line,
               borderStyle: 'dashed', borderRadius: 16, padding: 14, minHeight: 56 },
  emptyText: { flex: 1, fontSize: FontSizes.sm, color: c.muted },
});
