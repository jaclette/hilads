import { useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { fetchDailyBoard } from '@/api/daily';
import { useApp } from '@/context/AppContext';
import { CityFlag, SectionTitle } from '@/ui';
import { shortCityName } from '@/i18n/cityName';
import { answerText } from '@/features/compare/format';
import { PickPill } from '@/features/map/PickBadge';
import { PhotoCredit } from '@/features/map/PhotoCredit';
import type { DailyPick, DailyToday } from '@/types';

/**
 * "Meanwhile, from our picks" on Today: the Hilads picks attached to today's
 * challenge (photo, city, place, the pick's checked answer), each votable on
 * its own (never a player answer). Hidden when the day has none.
 */
export function TodayPicks({ today, refreshKey }: { today: DailyToday | null; refreshKey: number }) {
  const styles = useThemedStyles(makeStyles);
  const { t, i18n } = useTranslation('daily');
  const router = useRouter();
  const { identity, account } = useApp();
  const [picks, setPicks] = useState<DailyPick[]>([]);
  const date = today?.challenge?.isActive ? today.challenge.date : null;

  useEffect(() => {
    if (!date) { setPicks([]); return; }
    let alive = true;
    fetchDailyBoard(date, account ? null : identity?.guestId)
      .then(b => { if (alive) setPicks(b.picks ?? []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [date, refreshKey, account, identity?.guestId]);

  if (picks.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <SectionTitle title={t('compare.picksTitle')} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards}>
        {picks.map(p => (
          <View key={p.place.id} style={styles.card}>
            <TouchableOpacity onPress={() => router.push(`/spot/${p.place.id}` as never)} activeOpacity={0.85}
                              accessibilityRole="button" accessibilityLabel={p.place.name}>
              <View>
                {p.photo ? <Image source={{ uri: p.photo.thumbUrl ?? p.photo.url }} style={styles.photo} contentFit="cover" /> : <View style={styles.photo} />}
                <PhotoCredit by={null} credit={p.photo?.credit} overlay />
                <PickPill />
              </View>
              <View style={styles.body}>
                <View style={styles.city}>
                  <CityFlag country={p.city?.country} size={14} />
                  <Text style={styles.cityText} numberOfLines={1}>{p.city?.name ? shortCityName(p.city.name) : ''}</Text>
                </View>
                <Text style={styles.name} numberOfLines={2}>{p.place.name}</Text>
                {p.answer && <Text style={styles.answer} numberOfLines={1}>{answerText(p.answer, i18n.language)}</Text>}
              </View>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:     { gap: 8 },
  cards:    { gap: 10 },
  card:     { width: 170, backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line, borderRadius: 16, overflow: 'hidden' },
  photo:    { height: 110, backgroundColor: c.primaryTint },
  body:     { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10, gap: 4 },
  city:     { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cityText: { flex: 1, fontSize: 12, fontWeight: '700', color: c.muted },
  name:     { fontSize: FontSizes.sm, fontWeight: '800', color: c.text },
  answer:   { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryText },
});
