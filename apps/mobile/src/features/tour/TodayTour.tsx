import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { fetchDailyTour } from '@/api/daily';
import { shortCityName } from '@/i18n/cityName';
import { Card, CityFlag, Photo, SectionTitle } from '@/ui';
import { TodayPodium } from '@/features/today/TodayPodium';
import type { DailyToday, DailyTour } from '@/types';
import { rememberTour } from './store';

const CIRCLE = 68;

/**
 * Yesterday around the world (SPEC 10.7) on Today: "[N] cities, same
 * challenge" and one story circle per city: its photo cropped to a circle
 * with a small flag badge, and the short name, opening the tour at that city.
 * Never a flag-only circle: a city whose photo can't load leaves the row.
 * Fewer than 2 cities: the row is hidden (yesterday's podium module instead).
 */
export function TodayTour({ today, refreshKey }: { today: DailyToday | null; refreshKey: number }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account, identity } = useApp();
  const guestId = account ? null : identity?.guestId ?? null;
  const cityId = today?.city?.id ?? null;
  const [tour, setTour] = useState<DailyTour | null>(null);
  const [failed, setFailed] = useState(false);
  const [broken, setBroken] = useState<string[]>([]);   // proof ids whose photo didn't load
  const loaded = !!today;

  const load = useCallback(async () => {
    if (!loaded) return;
    try {
      const next = await fetchDailyTour({ cityId, guestId });
      rememberTour(next);
      setTour(next);
      setFailed(false);
    } catch {
      setFailed(true);   // no tour (nothing closed yet): the podium module
    }
  }, [loaded, cityId, guestId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { if (refreshKey > 0) load(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tour && !failed) return null;
  const slides = (tour?.slides ?? []).map((s, i) => ({ s, i })).filter(({ s }) => !!(s.proof.thumbUrl || s.proof.photoUrl) && !broken.includes(s.proof.id));
  if (!tour || slides.length < 2) return <TodayPodium today={today} refreshKey={refreshKey} />;

  const open = (start: number) => router.push(`/daily/tour?start=${start}&source=today` as never);
  return (
    <Card style={styles.card}>
      <SectionTitle small title={t('tour.title')} action={{ label: t('tour.watch'), onPress: () => open(0) }} />
      <Text style={styles.sub}>{t('tour.sub', { count: slides.length })}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {slides.map(({ s, i }) => (
          <TouchableOpacity key={s.city.id} style={styles.item} onPress={() => open(i)} accessibilityRole="button"
                            accessibilityLabel={t('tour.openCity', { city: shortCityName(s.city.name) })}>
            <View style={styles.ring}>
              <Photo thumb={s.proof.thumbUrl} full={s.proof.photoUrl} style={styles.photo} contentFit="cover" transition={150}
                     onError={() => setBroken(b => (b.includes(s.proof.id) ? b : [...b, s.proof.id]))} />
              <View style={styles.flag}><CityFlag country={s.city.country} size={20} /></View>
            </View>
            <Text style={styles.name} numberOfLines={1}>{shortCityName(s.city.name)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </Card>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:  { padding: 14, gap: 6 },
  sub:   { fontSize: FontSizes.xs, fontWeight: '600', color: c.muted, marginTop: -4 },
  row:   { gap: 12, paddingTop: 6, paddingRight: 4 },
  item:  { width: CIRCLE + 8, alignItems: 'center', gap: 6 },
  ring:  { width: CIRCLE + 8, height: CIRCLE + 8, borderRadius: (CIRCLE + 8) / 2, borderWidth: 2.5, borderColor: c.primary,
           alignItems: 'center', justifyContent: 'center' },
  photo: { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, backgroundColor: c.bg3 },
  flag:  { position: 'absolute', bottom: -2, right: -2, borderRadius: 4, overflow: 'hidden', borderWidth: 2, borderColor: c.bg2 },
  name:  { fontSize: 12, fontWeight: '700', color: c.text, textAlign: 'center' },
});
