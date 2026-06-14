import { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { fetchLeaderboard } from '@/api/leaderboard';
import { avatarColor } from '@/lib/avatarColors';
import type { LeaderboardEntry } from '@/types';
import { Colors, Spacing } from '@/constants';

function Slot({ entry, first }: { entry: LeaderboardEntry; first?: boolean }) {
  const name = entry.displayName ?? '?';
  return (
    <View style={styles.slot}>
      {first && <Text style={styles.crown}>👑</Text>}
      <View style={[styles.avatar, first && styles.avatarFirst, { backgroundColor: avatarColor(entry.user_id ?? name) }]}>
        {entry.thumbAvatarUrl
          ? <Image source={{ uri: entry.thumbAvatarUrl }} style={styles.avatarImg} />
          : <Text style={[styles.avatarLetter, first && styles.avatarLetterFirst]}>{name[0].toUpperCase()}</Text>}
      </View>
      <Text style={[styles.meta, first && styles.metaFirst]} numberOfLines={1}>
        <Text style={styles.metaRank}>{entry.rank}</Text> · {name}
      </Text>
    </View>
  );
}

/**
 * "Most Local" podium teaser - top 3 of the city (all-time) leaderboard.
 * Reuses fetchLeaderboard (no new query). Rank 1 centered + crowned; 2 left,
 * 3 right. Hidden when nobody is ranked yet; degrades cleanly with < 3.
 */
export function MostLocalCard({ channelId, onSeeAll }: { channelId: number | string | null; onSeeAll: () => void }) {
  const { t } = useTranslation('challenge');
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null); // null = loading

  useEffect(() => {
    let alive = true;
    setEntries(null);
    if (channelId == null) { setEntries([]); return; }
    fetchLeaderboard({ scope: 'city', period: 'alltime', limit: 3, offset: 0, cityId: `city_${channelId}` })
      .then(res => { if (alive) setEntries(res?.entries ?? []); })
      .catch(() => { if (alive) setEntries([]); });
    return () => { alive = false; };
  }, [channelId]);

  // Nobody ranked yet → still surface a leaderboard entry point (a tappable
  // CTA banner), instead of hiding the leaderboard until someone ranks.
  if (entries && entries.length === 0) {
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={onSeeAll}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={t('leaderboardCta.title')}
      >
        <View style={styles.head}>
          <Text style={styles.title}>{t('leaderboardCta.title')}</Text>
          <Text style={styles.seeAll}>{t('leaderboardCta.view')} ›</Text>
        </View>
        <Text style={styles.emptySub}>{t('leaderboardCta.sub')}</Text>
      </TouchableOpacity>
    );
  }

  const byRank = (r: number) => (entries ?? []).find(e => e.rank === r);
  const first = byRank(1), second = byRank(2), third = byRank(3);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>🏆 {t('mostLocal')}</Text>
        <TouchableOpacity onPress={onSeeAll} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.seeAll}>{t('seeAll')} ›</Text>
        </TouchableOpacity>
      </View>

      {entries === null ? (
        <View style={styles.podium}>
          <View style={styles.slot}><View style={[styles.avatar, styles.avatarSkel]} /></View>
          <View style={styles.slot}><View style={[styles.avatar, styles.avatarFirst, styles.avatarSkel]} /></View>
          <View style={styles.slot}><View style={[styles.avatar, styles.avatarSkel]} /></View>
        </View>
      ) : (
        <View style={styles.podium}>
          {second ? <Slot entry={second} /> : <View style={styles.slot} />}
          {first  ? <Slot entry={first} first /> : <View style={styles.slot} />}
          {third  ? <Slot entry={third} /> : <View style={styles.slot} />}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.md,
    marginBottom:     Spacing.md,
    padding:          14,
    backgroundColor:  Colors.bg2,
    borderWidth:      StyleSheet.hairlineWidth,
    borderColor:      Colors.border,
    borderRadius:     14,
  },
  head:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { fontSize: 15, fontWeight: '800', color: Colors.text },
  seeAll: { fontSize: 13, fontWeight: '600', color: '#60a5fa' },
  // Empty-leaderboard CTA: the head row's marginBottom is collapsed (no
  // podium below), the sub line carries the "be first ranked" nudge.
  emptySub: { fontSize: 12, fontWeight: '500', color: Colors.muted, marginTop: -8 },

  podium: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 10 },
  slot:   { flex: 1, alignItems: 'center', gap: 6 },
  crown:  { fontSize: 18, lineHeight: 20 },

  avatar: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarFirst: { width: 66, height: 66, borderRadius: 33, borderWidth: 2, borderColor: 'rgba(255,122,60,0.55)' },
  avatarSkel:  { backgroundColor: 'rgba(255,255,255,0.06)' },
  avatarImg:   { width: '100%', height: '100%' },
  avatarLetter:      { color: '#fff', fontWeight: '800', fontSize: 18 },
  avatarLetterFirst: { fontSize: 22 },

  meta:     { maxWidth: '100%', fontSize: 12, color: Colors.muted },
  metaFirst: { color: Colors.text, fontWeight: '700' },
  metaRank:  { color: '#FF7A3C', fontWeight: '800' },
});
