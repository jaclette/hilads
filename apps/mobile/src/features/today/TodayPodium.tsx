import { useCallback, useEffect, useState } from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { useScope } from '@/context/ScopeContext';
import { localizeCityName } from '@/i18n/cityName';
import { fetchDailyPodium } from '@/api/daily';
import { seedProofs } from '@/features/daily/votes';
import { RankMedal } from '@/features/daily/RankMedal';
import type { DailyPodium, DailyToday } from '@/types';
import { Button, Card, CityName, SectionTitle } from '@/ui';

/**
 * Yesterday's podium (SPEC 9.3): yesterday's top 3 proofs of the scope with
 * gold, silver and bronze seals, author, city and votes, and "N proofs in M
 * countries". A photo opens it in yesterday's sheet; "See all" opens the sheet.
 * When one of them is mine: "Share your #N" (SPEC 9.14).
 * A city with no proof yesterday shows World's; hidden when there were none.
 */
export function TodayPodium({ today, refreshKey }: { today: DailyToday | null; refreshKey: number }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account, identity } = useApp();
  const { scope } = useScope();
  const guestId = account ? null : identity?.guestId ?? null;
  const [podium, setPodium] = useState<DailyPodium | null>(null);
  const loaded = !!today;
  const cityId = scope === 'city' ? today?.city?.id ?? null : null;

  const load = useCallback(async () => {
    if (!loaded) return;
    try {
      const next = await fetchDailyPodium({ scope: cityId ? 'city' : 'world', cityId, guestId });
      seedProofs(next.proofs, false);
      setPodium(next);
    } catch { /* keep what we have */ }
  }, [loaded, cityId, guestId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { if (refreshKey > 0) load(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!podium || podium.proofs.length === 0) return null;
  const proofs = t('today.proofs', { count: podium.total });
  const mine = podium.proofs.find(p => p.isMine);
  return (
    <Card style={styles.card}>
      <SectionTitle small title={t('today.podiumTitle')}
                    action={{ label: t('today.seeAll'), onPress: () => router.push(`/daily/${podium.date}?source=today` as never) }} />
      <Text style={styles.stats}>
        {podium.scope === 'world' ? t('today.proofsIn', { proofs, countries: t('today.countries', { count: podium.countries }) }) : proofs}
      </Text>
      <View style={styles.row}>
        {podium.proofs.map(p => {
          const name = p.user.displayName || p.user.username || '';
          const votes = t('today.votes', { count: p.voteCount });
          return (
            <TouchableOpacity key={p.id} style={styles.item} onPress={() => router.push(`/daily/${podium.date}?proof=${p.id}` as never)}
                              accessibilityRole="button"
                              accessibilityLabel={[`#${p.rank}`, name, p.city?.name ? localizeCityName(p.city.name) : null, votes].filter(Boolean).join(', ')}>
              <View style={styles.photo}>
                <Image source={{ uri: p.thumbUrl ?? p.photoUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                <RankMedal rank={p.rank} size={24} podium style={styles.rank} />
              </View>
              <Text style={styles.name} numberOfLines={1}>{name}</Text>
              {!!p.city?.name && <CityName name={p.city.name} country={p.city.country} short style={styles.city} size={14} />}
              <Text style={styles.votes} numberOfLines={1}>{votes}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {mine && (
        <Button variant="secondary" size="sm" icon="share-social-outline" label={t('share.shareRank', { rank: mine.rank })}
                onPress={() => router.push(`/daily/${podium.date}?proof=${mine.id}&share=1&source=podium` as never)} />
      )}
    </Card>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:  { paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  stats: { fontSize: 13, fontWeight: '500', color: c.muted, marginTop: -4 },
  row:   { flexDirection: 'row', gap: 10 },
  item:  { flex: 1, minWidth: 0, gap: 2 },
  photo: { width: '100%', aspectRatio: 4 / 5, marginBottom: 4, borderRadius: 14, overflow: 'hidden', backgroundColor: c.bg3 },
  rank:  { position: 'absolute', top: 6, left: 6, borderWidth: 2, borderColor: c.bg2 },
  name:  { fontSize: 13, fontWeight: '700', color: c.text },
  city:  { fontSize: 12, fontWeight: '500', color: c.muted },
  votes: { fontSize: 12, fontWeight: '500', color: c.muted },
});
