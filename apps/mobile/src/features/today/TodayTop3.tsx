import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { useScope } from '@/context/ScopeContext';
import { track } from '@/services/analytics';
import { fetchDailySheet } from '@/api/daily';
import { useDailyLeaderboard } from '@/features/daily/leaderboard';
import { dailyTrackProps } from '@/features/daily/track';
import type { DailyLeaderboardEntry, DailyProof, DailyToday } from '@/types';

/**
 * Today's live top 3 (SPEC 9.3 / 8.1): avatar, name and votes, with "See top
 * 10". In city scope the city's top 3 when it has one, else World. Before the
 * challenge is ranked, today's latest proofs show instead (city, else World),
 * so the section is never empty while people post.
 */
export function TodayTop3({ today }: { today: DailyToday | null }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account, identity } = useApp();
  const { scope } = useScope();
  const guestId = account ? null : identity?.guestId ?? null;
  const active = !!today?.challenge?.isActive;
  const lb = useDailyLeaderboard(active, account?.id ?? (guestId ? `g:${guestId}` : null), guestId);

  const ranked = !!lb && lb.date === today?.challenge?.date && lb.ranked;
  const cityId = today?.city?.id ?? null;
  const cityEntries = scope === 'city' && cityId !== null ? lb?.cities.find(c => c.city.id === cityId)?.entries ?? [] : [];
  const top: DailyLeaderboardEntry[] = !ranked ? [] : (cityEntries.length > 0 ? cityEntries : lb!.world).slice(0, 3);

  const tracked = useRef<string | null>(null);
  useEffect(() => {
    if (top.length === 0 || !lb?.date || tracked.current === lb.date) return;
    tracked.current = lb.date;
    track('daily_leaderboard_viewed', { source: 'today', ...dailyTrackProps(today, account?.mode), provisional: true, ranked: true, my_rank: lb.me?.rank ?? null });
  }, [top.length, lb, today, account?.mode]);

  if (!today?.challenge) return null;
  if (top.length === 0) return <LatestProofs today={today} />;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{t('today.top3')}</Text>
        <TouchableOpacity onPress={() => router.push('/daily/today?tab=top10' as never)} hitSlop={8} accessibilityRole="button">
          <Text style={styles.link}>{t('today.seeTop10')}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.row}>
        {top.map(e => (
          <TouchableOpacity key={e.proofId} style={styles.entry} onPress={() => router.push(`/daily/today?proof=${e.proofId}` as never)}
                            accessibilityRole="button" accessibilityLabel={`#${e.rank} ${e.user.username ?? ''}, ${t('today.votes', { count: e.voteCount })}`}>
            <Avatar person={e.user} />
            <View style={styles.entryText}>
              <Text style={styles.name} numberOfLines={1}>{e.user.username ?? e.user.displayName ?? ''}</Text>
              <Text style={styles.votes} numberOfLines={1}>{t('today.votes', { count: e.voteCount })}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function Avatar({ person }: { person: DailyLeaderboardEntry['user'] }) {
  const styles = useThemedStyles(makeStyles);
  const initial = (person.username ?? person.displayName ?? '?').slice(0, 1).toUpperCase();
  return person.photoUrl
    ? <Image source={{ uri: person.photoUrl }} style={styles.avatar} contentFit="cover" />
    : <View style={[styles.avatar, styles.avatarEmpty]}><Text style={styles.initial}>{initial}</Text></View>;
}

/** Today's latest approved proofs (city scope: the city's, else World); hidden when there are none. */
function LatestProofs({ today }: { today: DailyToday }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account, identity } = useApp();
  const { scope } = useScope();
  const guestId = account ? null : identity?.guestId ?? null;
  const [proofs, setProofs] = useState<DailyProof[]>([]);
  const date = today.challenge?.date ?? null;
  const cityId = scope === 'city' ? today.city?.id ?? null : null;

  const load = useCallback(async () => {
    if (!date) return;
    try {
      let sheet = await fetchDailySheet(date, { scope: cityId ? 'city' : 'world', cityId, limit: 10, guestId });
      if (cityId && sheet.proofs.length === 0) sheet = await fetchDailySheet(date, { scope: 'world', limit: 10, guestId });
      setProofs(sheet.proofs);
    } catch { /* keep what we have */ }
  }, [date, cityId, guestId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (proofs.length === 0) return null;
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{t('today.latest')}</Text>
        <TouchableOpacity onPress={() => router.push('/daily/today?source=today' as never)} hitSlop={8} accessibilityRole="button">
          <Text style={styles.link}>{t('today.seeAll')}</Text>
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
        {proofs.map(p => (
          <TouchableOpacity key={p.id} onPress={() => router.push(`/daily/today?proof=${p.id}` as never)} accessibilityRole="button"
                            accessibilityLabel={p.caption ?? p.user.username ?? ''}>
            <Image source={{ uri: p.thumbUrl ?? p.photoUrl }} style={styles.thumb} contentFit="cover" />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:        { backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  head:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title:       { fontSize: 15, fontWeight: '800', color: c.text },
  link:        { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryText },
  row:         { flexDirection: 'row', gap: 8 },
  entry:       { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  entryText:   { flex: 1, minWidth: 0 },
  avatar:      { width: 32, height: 32, borderRadius: Radius.full, backgroundColor: c.primaryTint },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  initial:     { fontSize: FontSizes.xs, fontWeight: '800', color: c.primaryOnTint },
  name:        { fontSize: FontSizes.xs, fontWeight: '700', color: c.text },
  votes:       { fontSize: 12, fontWeight: '500', color: c.muted },
  thumbs:      { gap: 8 },
  thumb:       { width: 72, height: 72, borderRadius: 12, backgroundColor: c.bg3 },
});
