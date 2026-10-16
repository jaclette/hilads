import { useEffect, useRef } from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { track } from '@/services/analytics';
import { MEDALS } from './DailyProofTile';
import { useDailyLeaderboard } from './leaderboard';
import type { DailyToday } from '@/types';

/**
 * Compact live top 3 on the hero card (MY CITY, CHALLENGES). Hidden until the
 * challenge is ranked (minimum proofs) and someone has a vote. Opens the
 * sheet's Top 10 tab.
 */
export function DailyTop3({ today, source, trackProps }: {
  today: DailyToday; source: string; trackProps: Record<string, string | number | boolean | null>;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account, identity } = useApp();
  const guestId = account ? null : identity?.guestId ?? null;
  const active = !!today.challenge?.isActive;
  const lb = useDailyLeaderboard(active, account?.id ?? (guestId ? `g:${guestId}` : null), guestId);
  const top = lb && lb.date === today.challenge?.date && lb.ranked ? lb.world.slice(0, 3) : [];

  const tracked = useRef<string | null>(null);
  useEffect(() => {
    if (top.length === 0 || !lb?.date || tracked.current === lb.date) return;
    tracked.current = lb.date;
    track('daily_leaderboard_viewed', { source, ...trackProps, provisional: true, ranked: true, my_rank: lb.me?.rank ?? null });
  }, [top.length, lb, source, trackProps]);

  if (top.length === 0) return null;
  return (
    <TouchableOpacity
      style={styles.wrap}
      onPress={() => router.push('/daily/today?tab=top10' as never)}
      accessibilityRole="button"
      accessibilityLabel={t('leaderboard.compactTitle')}
    >
      <Text style={styles.title} numberOfLines={1}>🏆 {t('leaderboard.compactTitle')}</Text>
      <View style={styles.items}>
        {top.map(e => (
          <View key={e.proofId} style={styles.item}>
            {e.thumbUrl ? <Image source={{ uri: e.thumbUrl }} style={styles.thumb} contentFit="cover" /> : <View style={styles.thumb} />}
            <Text style={styles.medal}>{MEDALS[e.rank - 1] ?? `#${e.rank}`}</Text>
            <Text style={styles.votes}>♥ {e.voteCount}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.more}>{t('leaderboard.seeAll')}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:  { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8 },
  title: { flexShrink: 1, fontSize: FontSizes.xs, fontWeight: '800', color: c.text },
  items: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 10 },
  item:  { flexDirection: 'row', alignItems: 'center', gap: 3 },
  thumb: { width: 26, height: 26, borderRadius: Radius.sm, backgroundColor: c.bg3 },
  medal: { fontSize: 13 },
  votes: { fontSize: 11, fontWeight: '700', color: c.muted },
  more:  { fontSize: FontSizes.xs, fontWeight: '800', color: c.accentText },
});
