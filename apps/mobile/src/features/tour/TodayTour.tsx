import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { fetchDailyTour } from '@/api/daily';
import { shortCityName } from '@/i18n/cityName';
import { Card, Photo, SectionTitle } from '@/ui';
import { ACCENTS, DashedRoute, FlagSticker, TANGERINE } from '@/ui/joy';
import { TodayPodium } from '@/features/today/TodayPodium';
import type { DailyToday, DailyTour } from '@/types';
import { rememberTour } from './store';

const CIRCLE = 68;

/**
 * Yesterday around the world (SPEC 10.7) on Today: "[N] cities, same
 * challenge" and one story circle per city: its photo cropped to a circle in
 * a ring of the joyful accents, its flag sticker, and the short name, opening
 * the tour at that city. A dashed route links the circles (decorative).
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
      <SectionTitle small title={t('tour.title')} highlight={TANGERINE} action={{ label: t('tour.watch'), onPress: () => open(0) }} />
      <Text style={styles.sub}>{t('tour.sub', { count: slides.length })}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <DashedRoute width={slides.length * (CIRCLE + 20)} height={CIRCLE * 0.6} style={styles.route} />
        {slides.map(({ s, i }, n) => (
          <TouchableOpacity key={s.city.id} style={styles.item} onPress={() => open(i)} accessibilityRole="button"
                            accessibilityLabel={t('tour.openCity', { city: shortCityName(s.city.name) })}>
            <View style={[styles.ring, { borderColor: ACCENTS[n % ACCENTS.length] }]}>
              <Photo thumb={s.proof.thumbUrl} full={s.proof.photoUrl} style={styles.photo} contentFit="cover" transition={150}
                     onError={() => setBroken(b => (b.includes(s.proof.id) ? b : [...b, s.proof.id]))} />
              <FlagSticker country={s.city.country} size={24} style={styles.flag} />
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
  ring:  { width: CIRCLE + 8, height: CIRCLE + 8, borderRadius: (CIRCLE + 8) / 2, borderWidth: 3, backgroundColor: c.bg2,
           alignItems: 'center', justifyContent: 'center' },
  route: { left: CIRCLE / 2, top: 6 + CIRCLE * 0.2 },
  photo: { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, backgroundColor: c.bg3 },
  flag:  { position: 'absolute', bottom: -3, right: -3 },
  name:  { fontSize: 12, fontWeight: '700', color: c.text, textAlign: 'center' },
});
