import { thumbUrl } from '@/lib/imageThumb';
import { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { fetchLeaderboard } from '@/api/leaderboard';
import { useApp } from '@/context/AppContext';
import { canAccessProfile } from '@/lib/profileAccess';
import { avatarColor } from '@/lib/avatarColors';
import type { LeaderboardEntry } from '@/types';
import { Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

function Slot({
  entry,
  first,
  onPress,
}: {
  entry:   LeaderboardEntry;
  first?:  boolean;
  onPress: (userId: string | null) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const name = entry.displayName ?? '?';
  return (
    <View style={styles.slot}>
      {first && <Text style={styles.crown}>👑</Text>}
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={() => onPress(entry.user_id ?? null)}
        disabled={!entry.user_id}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        accessibilityRole="button"
        accessibilityLabel={name}
      >
        <View style={[styles.avatar, first && styles.avatarFirst, { backgroundColor: avatarColor(entry.user_id ?? name) }]}>
          {entry.thumbAvatarUrl
            ? <Image source={{ uri: thumbUrl(entry.thumbAvatarUrl) }} style={styles.avatarImg} />
            : <Text style={[styles.avatarLetter, first && styles.avatarLetterFirst]}>{name[0].toUpperCase()}</Text>}
        </View>
      </TouchableOpacity>
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
  const styles = useThemedStyles(makeStyles);

  const { t } = useTranslation('challenge');
  const router = useRouter();
  const { account } = useApp();
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null); // null = loading

  // Tap a podium avatar → that user's profile. Self → the Me tab (known +
  // editable); others → the registered-user profile behind canAccessProfile
  // so guests hit the auth gate instead of a 404. Mirrors leaderboard.tsx.
  const openProfile = (userId: string | null) => {
    if (!userId) return;
    if (userId === account?.id) { router.push('/(tabs)/me'); return; }
    if (!canAccessProfile(account)) { router.push('/auth-gate'); return; }
    router.push({ pathname: '/user/[id]', params: { id: userId } });
  };

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
          {second ? <Slot entry={second} onPress={openProfile} /> : <View style={styles.slot} />}
          {first  ? <Slot entry={first} first onPress={openProfile} /> : <View style={styles.slot} />}
          {third  ? <Slot entry={third} onPress={openProfile} /> : <View style={styles.slot} />}
        </View>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card: {
    marginHorizontal: Spacing.md,
    marginBottom:     Spacing.md,
    padding:          14,
    backgroundColor:  c.bg2,
    // Gold border so the Most Local podium stands out (matches the Legend/crown theme).
    borderWidth:      1.5,
    borderColor:      'rgba(251,191,36,0.6)',
    borderRadius:     14,
    shadowColor:      '#fbbf24',
    shadowOffset:     { width: 0, height: 0 },
    shadowOpacity:    0.22,
    shadowRadius:     9,
    elevation:        3,
  },
  head:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { fontSize: 15, fontWeight: '800', color: c.text },
  seeAll: { fontSize: 13, fontWeight: '600', color: '#60a5fa' },
  // Empty-leaderboard CTA: the head row's marginBottom is collapsed (no
  // podium below), the sub line carries the "be first ranked" nudge.
  emptySub: { fontSize: 12, fontWeight: '500', color: c.muted, marginTop: -8 },

  podium: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 10 },
  slot:   { flex: 1, alignItems: 'center', gap: 6 },
  crown:  { fontSize: 18, lineHeight: 20 },

  avatar: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarFirst: { width: 66, height: 66, borderRadius: 33, borderWidth: 2, borderColor: 'rgba(255,122,60,0.55)' },
  avatarSkel:  { backgroundColor: c.overlay },
  avatarImg:   { width: '100%', height: '100%' },
  avatarLetter:      { color: '#fff', fontWeight: '800', fontSize: 18 },
  avatarLetterFirst: { fontSize: 22 },

  meta:     { maxWidth: '100%', fontSize: 12, color: c.muted },
  metaFirst: { color: c.text, fontWeight: '700' },
  metaRank:  { color: '#FF7A3C', fontWeight: '800' },
});
