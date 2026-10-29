import { useCallback, useEffect, useState } from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { fetchDailyTour } from '@/api/daily';
import { shortCityName } from '@/i18n/cityName';
import { answerText } from '@/features/compare/format';
import { RankMedal } from '@/features/daily/RankMedal';
import { compareCountryProofs } from '@/features/daily/countryOrder';
import { Card, Photo, SectionTitle } from '@/ui';
import { isEventDay, useSeasonal } from '@/features/event/seasonal';
import { FlagSticker } from '@/ui/joy';
import type { DailyToday, DailyTour } from '@/types';
import { rememberTour } from './store';

const THUMB = 84;

/**
 * Yesterday's recap on Today (SPEC 10.7), one card: the winning photo
 * (yesterday's #1, else the best: compareCountryProofs), "Yesterday", the question, the
 * winner's flag, city and answer ("Lisbon · Saúde!"), and how many cities
 * played. "Watch" and the card open yesterday's tour at the winner. Its
 * footer opens every past challenge (V3 polish 3.2); without a photo
 * yesterday, that link stays on its own.
 */
export function TodayTour({ today, refreshKey }: { today: DailyToday | null; refreshKey: number }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const router = useRouter();
  const { account, identity } = useApp();
  const archive = (
    <TouchableOpacity style={styles.archive} onPress={() => router.push('/daily/archive?source=today_yesterday' as never)}
                      accessibilityRole="button" hitSlop={6} testID="today-archive">
      <Ionicons name="calendar-outline" size={16} color={colors.primaryText} />
      <Text style={styles.archiveText}>{t('today.allPast')}</Text>
      <Ionicons name="chevron-forward" size={15} color={colors.primaryText} />
    </TouchableOpacity>
  );
  const guestId = account ? null : identity?.guestId ?? null;
  const cityId = today?.city?.id ?? null;
  const [tour, setTour] = useState<DailyTour | null>(null);
  // Yesterday was a seasonal event's day (Halloween's recap): the label keeps its emoji.
  const seasonal = useSeasonal();
  const recap = seasonal?.event.phase === 'recap' || isEventDay(seasonal, tour?.date);
  const loaded = !!today;

  const load = useCallback(async () => {
    if (!loaded) return;
    try {
      const next = await fetchDailyTour({ cityId, guestId });
      rememberTour(next);
      setTour(next);
    } catch { /* no tour (nothing closed yet): no card */ }
  }, [loaded, cityId, guestId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { if (refreshKey > 0) load(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const slides = tour?.slides ?? [];
  if (!loaded) return null;
  if (!tour || slides.length === 0) return <Card style={styles.card}>{archive}</Card>;
  // The winner: yesterday's #1, else the best photo (the shared rule: most liked, then the earliest posted).
  let at = slides.findIndex(s => s.podium === 1);
  if (at < 0) at = slides.reduce((best, s, i) => (compareCountryProofs(s.proof, slides[best].proof) < 0 ? i : best), 0);
  const cities = new Set(slides.map(s => s.city.id)).size;   // a slide per photo: several per city
  const win = slides[at];
  const answer = win.proof.answer && !win.proof.backHome ? answerText(win.proof.answer, i18n.language) : null;
  const question = tour.challenge.compare?.question ?? tour.challenge.text;
  const open = () => router.push(`/daily/tour?start=${at}&source=today_recap` as never);

  return (
    <Card style={styles.card}>
      <SectionTitle small title={recap ? `${t('recap.label')} ${seasonal!.theme.emoji}` : t('recap.label')} action={{ label: t('tour.watch'), onPress: open }} />
      <TouchableOpacity style={styles.row} onPress={open} activeOpacity={0.85} accessibilityRole="button" testID="yesterday-recap"
                        accessibilityLabel={[t('recap.label'), question, shortCityName(win.city.name), answer].filter(Boolean).join(', ')}>
        <View>
          <Photo thumb={win.proof.thumbUrl} full={win.proof.photoUrl} style={styles.thumb} contentFit="cover" transition={150} />
          {win.podium === 1 && <RankMedal rank={1} size={24} style={styles.medal} />}
        </View>
        <View style={styles.body}>
          <Text style={styles.question} numberOfLines={2}>{question}</Text>
          <View style={styles.cityRow}>
            <FlagSticker country={win.city.country} size={16} />
            <Text style={styles.city} numberOfLines={1}>
              {shortCityName(win.city.name)}{answer ? <Text style={styles.answer}>{` · ${answer}`}</Text> : null}
            </Text>
          </View>
          <Text style={styles.meta}>{t('recap.cities', { count: cities })}</Text>
        </View>
      </TouchableOpacity>
      <View style={styles.footer}>{archive}</View>
    </Card>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:     { padding: 14, gap: 10 },
  row:      { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb:    { width: THUMB, height: THUMB, borderRadius: 16, backgroundColor: c.bg3 },
  medal:    { position: 'absolute', top: -6, left: -6, borderWidth: 2, borderColor: c.bg2 },
  body:     { flex: 1, gap: 4 },
  question: { fontSize: FontSizes.md, lineHeight: 21, fontWeight: '800', color: c.text },
  cityRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  city:     { flexShrink: 1, fontSize: 14, fontWeight: '700', color: c.text },
  answer:   { fontWeight: '800', color: c.primaryText },
  meta:     { fontSize: 13, fontWeight: '600', color: c.muted },
  footer:   { borderTopWidth: 1, borderTopColor: c.line, paddingTop: 10 },
  archive:  { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28 },
  archiveText: { flex: 1, fontSize: 14, fontWeight: '700', color: c.primaryText },
});
