import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { useScope } from '@/context/ScopeContext';
import { localizeCityName, shortCityName } from '@/i18n/cityName';
import { fetchDailyTodayProofs } from '@/api/daily';
import { ShareSheet } from '@/features/share/ShareSheet';
import { representShare, type ShareContent } from '@/features/share/content';
import { seedProofs, useVoteState } from '@/features/daily/votes';
import { RankMedal } from '@/features/daily/RankMedal';
import { DailyStatusChip } from '@/features/daily/DailyStatusChip';
import { answerText } from '@/features/compare/format';
import type { DailyToday, DailyTodayProofs } from '@/types';
import { Card, CityName, Photo, SectionTitle } from '@/ui';

type StripProof = DailyTodayProofs['proofs'][number];

/**
 * Today's proofs (SPEC 9.3): the scope's approved proofs as a photo strip, most
 * voted first then newest, each with its city and votes, and a 1/2/3 seal on
 * the top three once the leaderboard ranks. A city with none shows World's.
 * Hidden when nobody has posted.
 */
export function TodayProofs({ today, refreshKey }: { today: DailyToday | null; refreshKey: number }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account, identity } = useApp();
  const { scope } = useScope();
  const guestId = account ? null : identity?.guestId ?? null;
  const [strip, setStrip] = useState<DailyTodayProofs | null>(null);
  const [invite, setInvite] = useState<ShareContent | null>(null);
  const date = today?.challenge?.date ?? null;
  const cityId = scope === 'city' ? today?.city?.id ?? null : null;

  const load = useCallback(async () => {
    if (!date) { setStrip(null); return; }
    try {
      const next = await fetchDailyTodayProofs({ scope: cityId ? 'city' : 'world', cityId, guestId });
      seedProofs(next.proofs, true);
      setStrip(next);
    } catch { /* keep what we have */ }
  }, [date, cityId, guestId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { if (refreshKey > 0) load(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // My own proof in review leads the strip, with its badge (only mine: others' never show before approval).
  const mine = today?.myProof && today.myProof.status === 'pending'
    && (strip?.scope === 'world' || today.myProof.city?.id === strip?.city?.id) ? today.myProof : null;
  const items: StripProof[] = [
    ...(mine && !strip?.proofs.some(p => p.id === mine.id) ? [{ ...mine, rank: null }] : []),
    ...(strip?.proofs ?? []),
  ];
  if (!strip || items.length === 0) return null;
  const world = strip.scope === 'world';
  // Represent your city (SPEC 9.16), World scope: "12 cities are on today's board. Saigon isn't yet."
  // Never a zero count; my own pending proof counts for me.
  const presence = scope === 'world' ? today?.presence ?? null : null;
  const myCity = today?.city?.name ? shortCityName(today.city.name) : null;
  const boardLine = !!presence && !presence.represented && presence.citiesToday > 0 && !!myCity && !!today?.challenge?.isActive;
  const proofs = t('today.proofs', { count: strip.total });
  const openSheet = () => router.push(`/daily/today?tab=${world ? 'world' : 'city'}&source=today_strip` as never);
  return (
    <Card style={styles.card}>
      {/* The title and "See all" open the challenge sheet on the strip's tab. */}
      <SectionTitle small title={world ? t('today.aroundWorld') : t('today.inCity', { city: shortCityName(strip.city?.name ?? '') })}
                    onPress={openSheet} action={{ label: t('today.seeAll'), onPress: openSheet }} />
      <Text style={styles.stats}>
        {world ? t('today.proofsIn', { proofs, countries: t('today.countries', { count: strip.countries }) }) : proofs}
      </Text>
      {boardLine && (
        <View style={styles.board}>
          <Text style={styles.boardText}>{t('represent.board', { count: presence!.citiesToday, city: myCity })}</Text>
          <TouchableOpacity onPress={() => setInvite(representShare(today!.challenge!, today!.city!))} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.boardLink}>{t('represent.invite')}</Text>
          </TouchableOpacity>
        </View>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map(p => (
          <StripItem key={p.id} proof={p} guestId={guestId} onPress={() => router.push(`/daily/today?proof=${p.id}` as never)} />
        ))}
      </ScrollView>
      <ShareSheet content={invite} source="represent_world_strip" onClose={() => setInvite(null)} />
    </Card>
  );
}

function StripItem({ proof, guestId, onPress }: { proof: StripProof; guestId: string | null; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t, i18n } = useTranslation('daily');
  const state = useVoteState(proof.id, guestId);
  const city = proof.city?.name ? localizeCityName(proof.city.name) : '';
  const votes = t('today.votes', { count: state?.voteCount ?? proof.voteCount });
  return (
    <TouchableOpacity style={styles.item} onPress={onPress} accessibilityRole="button"
                      accessibilityLabel={[proof.rank ? `#${proof.rank}` : null, city, votes].filter(Boolean).join(', ')}>
      <View style={styles.photo}>
        <Photo thumb={proof.thumbUrl} full={proof.photoUrl} style={StyleSheet.absoluteFill} contentFit="cover" />
        {proof.rank !== null && <RankMedal rank={proof.rank} size={24} style={styles.rank} />}
        {proof.status === 'pending' && <View style={styles.pending}><DailyStatusChip status="pending" /></View>}
      </View>
      {/* The city, then the answer to the day's question on its own line (SPEC 10.2). */}
      {!!proof.city?.name && <CityName name={proof.city.name} country={proof.city.country} short style={styles.city} />}
      {proof.answer && <Text style={styles.answer} numberOfLines={2}>{answerText(proof.answer, i18n.language)}</Text>}
      <Text style={styles.votes} numberOfLines={1}>{votes}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:  { paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  stats: { fontSize: 13, fontWeight: '500', color: c.muted, marginTop: -4 },
  row:   { gap: 10 },
  item:  { width: 112, gap: 2 },
  photo: { width: 112, height: 140, marginBottom: 4, borderRadius: 14, overflow: 'hidden', backgroundColor: c.bg3 },
  rank:  { position: 'absolute', top: 6, left: 6, borderWidth: 2, borderColor: c.bg2 },
  city:  { fontSize: 13, fontWeight: '700', color: c.text, maxWidth: '100%' },
  answer: { fontSize: 13, fontWeight: '800', color: c.text },
  pending: { position: 'absolute', left: 6, bottom: 6 },
  votes: { fontSize: 12, fontWeight: '500', color: c.muted },
  board: { gap: 4, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: c.primaryTint },
  boardText: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: c.primaryOnTint },
  boardLink: { fontSize: 13, fontWeight: '700', color: c.text, textDecorationLine: 'underline' },
});
