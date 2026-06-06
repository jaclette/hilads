import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, ActivityIndicator, TouchableOpacity, StyleSheet, RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useApp } from '@/context/AppContext';
import { fetchLeaderboard } from '@/api/leaderboard';
import { avatarColor } from '@/lib/avatarColors';
import { localizeCityName } from '@/i18n/cityName';
import { Colors, FontSizes, Spacing, Radius, Gradients } from '@/constants';
import type {
  LeaderboardResponse, LeaderboardScope, LeaderboardPeriod, LeaderboardEntry,
} from '@/types';

const PAGE_SIZE = 50;

/**
 * Leaderboard screen — reached from the 🏆 chip on the MY CITY tab.
 *
 * Two selectors:
 *   - scope:  My city (default) | World
 *   - period: This month (default) | All-time
 *
 * The caller's row is pinned at the bottom when they're ranked outside the
 * top page; when they have zero points in the scope/period, the pinned row
 * becomes a "Take a challenge to get on the board" nudge.
 */
export default function LeaderboardScreen() {
  const router = useRouter();
  const { t } = useTranslation('challenge');
  const { account, city } = useApp();

  const [scope,  setScope]  = useState<LeaderboardScope>('city');
  const [period, setPeriod] = useState<LeaderboardPeriod>('month');

  const [data,    setData]    = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const cityId = city?.channelId ? `city_${city.channelId}` : undefined;

  const load = useCallback(async () => {
    if (!account?.id) { setData(null); setLoading(false); return; }
    setError(null);
    const res = await fetchLeaderboard({
      scope, period,
      limit:  PAGE_SIZE,
      offset: 0,
      cityId: scope === 'city' ? cityId : undefined,
    });
    if (res === null) {
      setError(t('leaderboard.errLoad'));
    } else {
      setData(res);
    }
    setLoading(false);
    setRefreshing(false);
  }, [account?.id, scope, period, cityId, t]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const entries: LeaderboardEntry[] = data?.entries ?? [];
  const me = data?.me;
  // True iff the caller appears in the visible page — avoids a duplicate row.
  const meInPage = !!me && me.rank !== null && entries.some(e => e.user_id === me.user_id);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header
        title={t('leaderboard.title')}
        onBack={() => router.back()}
        t={t}
      />

      <Selectors
        scope={scope}      onScope={setScope}
        period={period}    onPeriod={setPeriod}
        cityLabel={localizeCityName(city?.name) ?? t('leaderboard.scope.city')}
        t={t}
      />

      {loading && !data ? (
        <View style={styles.center}><ActivityIndicator color={Colors.accent} /></View>
      ) : error ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyEmoji}>🤷</Text>
          <Text style={styles.emptyBody}>{error}</Text>
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyEmoji}>🥇</Text>
          <Text style={styles.emptyTitle}>{t('leaderboard.empty.title')}</Text>
          <Text style={styles.emptyBody}>{t('leaderboard.empty.body')}</Text>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.user_id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
          renderItem={({ item }) => (
            <Row entry={item} isMe={item.user_id === me?.user_id} t={t} />
          )}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}

      {/* Pinned caller row — only when not already visible in the page. */}
      {me && !meInPage && (
        <View style={styles.pinnedWrap}>
          {me.rank !== null ? (
            <Row
              entry={{
                rank:           me.rank,
                user_id:        me.user_id,
                displayName:    account?.display_name ?? '',
                thumbAvatarUrl: account?.thumbAvatarUrl ?? account?.profile_photo_url ?? null,
                points:         me.points,
              }}
              isMe
              t={t}
            />
          ) : (
            <View style={styles.unrankedRow}>
              <Text style={styles.unrankedText}>{t('leaderboard.me.unranked')}</Text>
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

// ── Header + selectors ───────────────────────────────────────────────────────

function Header({
  title, onBack, t,
}: { title: string; onBack: () => void; t: (k: string, opts?: { ns?: string }) => string }) {
  return (
    <View style={styles.nav}>
      <TouchableOpacity style={styles.backPill} onPress={onBack} activeOpacity={0.75}>
        <Ionicons name="chevron-back" size={18} color={Colors.text} />
        <Text style={styles.backPillText}>{t('back', { ns: 'common' })}</Text>
      </TouchableOpacity>
      <View style={styles.navCenter}>
        <Text style={styles.navTitle} numberOfLines={1}>{title}</Text>
      </View>
      <View style={{ width: 70 }} />
    </View>
  );
}

function Selectors({
  scope, onScope, period, onPeriod, cityLabel, t,
}: {
  scope:  LeaderboardScope;
  onScope: (v: LeaderboardScope) => void;
  period: LeaderboardPeriod;
  onPeriod: (v: LeaderboardPeriod) => void;
  cityLabel: string;
  t: (k: string) => string;
}) {
  return (
    <View style={styles.selectorsWrap}>
      <Segmented
        items={[
          { value: 'city',  label: cityLabel },
          { value: 'world', label: t('leaderboard.scope.world') },
        ]}
        active={scope}
        onChange={(v) => onScope(v as LeaderboardScope)}
        gradient
      />
      <Segmented
        items={[
          { value: 'month',   label: t('leaderboard.period.month') },
          { value: 'alltime', label: t('leaderboard.period.alltime') },
        ]}
        active={period}
        onChange={(v) => onPeriod(v as LeaderboardPeriod)}
      />
    </View>
  );
}

function Segmented<T extends string>({
  items, active, onChange, gradient = false,
}: {
  items:  Array<{ value: T; label: string }>;
  active: T;
  onChange: (v: T) => void;
  /** When true, the active pill renders the orange gradient (primary toggle).
   *  Otherwise active is a flat lighter background (secondary toggle). */
  gradient?: boolean;
}) {
  return (
    <View style={styles.segWrap}>
      {items.map(it => {
        const isActive = it.value === active;
        return (
          <TouchableOpacity
            key={it.value}
            style={[styles.segItem, isActive && (gradient ? null : styles.segItemActiveFlat)]}
            onPress={() => onChange(it.value)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
          >
            {isActive && gradient && (
              <LinearGradient
                colors={Gradients.primary.colors}
                start={Gradients.primary.start}
                end={Gradients.primary.end}
                style={StyleSheet.absoluteFill}
              />
            )}
            <Text
              style={[
                styles.segText,
                isActive && (gradient ? styles.segTextActiveGradient : styles.segTextActiveFlat),
              ]}
              numberOfLines={1}
            >
              {it.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Row ──────────────────────────────────────────────────────────────────────

function Row({
  entry, isMe, t,
}: {
  entry: LeaderboardEntry;
  isMe:  boolean;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <View style={[styles.row, isMe && styles.rowMe]}>
      <Text style={[styles.rank, isMe && styles.rankMe]}>#{entry.rank}</Text>
      <View style={[styles.avatar, { backgroundColor: avatarColor(entry.user_id) }]}>
        {entry.thumbAvatarUrl ? (
          <Image
            source={{ uri: entry.thumbAvatarUrl }}
            style={StyleSheet.absoluteFill}
            cachePolicy="memory-disk"
            contentFit="cover"
            transition={120}
          />
        ) : (
          <Text style={styles.avatarLetter}>{(entry.displayName?.[0] ?? '?').toUpperCase()}</Text>
        )}
      </View>
      <Text style={[styles.name, isMe && styles.nameMe]} numberOfLines={1}>
        {entry.displayName}
      </Text>
      <Text style={[styles.points, isMe && styles.pointsMe]}>
        {t('leaderboard.points', { points: entry.points })}
      </Text>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },

  nav: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
  },
  backPillText: { color: Colors.text, fontSize: FontSizes.sm, fontWeight: '700' },
  navCenter:    { flex: 1, alignItems: 'center' },
  navTitle:     { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text, letterSpacing: -0.3 },

  // Selectors
  selectorsWrap: {
    paddingHorizontal: Spacing.md,
    paddingTop:    Spacing.sm,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  segWrap: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: Radius.full,
    padding: 4,
    gap: 4,
  },
  segItem: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: Radius.full,
    overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  segItemActiveFlat: { backgroundColor: 'rgba(255,255,255,0.10)' },
  segText: { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.muted },
  segTextActiveFlat:    { color: Colors.text },
  segTextActiveGradient:{ color: Colors.white, fontWeight: '800' },

  // List
  list: { paddingVertical: Spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 2,
  },
  rowMe: {
    backgroundColor: 'rgba(255,122,60,0.08)',
  },
  rank:  { width: 44, color: Colors.muted2, fontSize: FontSizes.md, fontWeight: '800', textAlign: 'left' },
  rankMe: { color: '#FF7A3C' },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarLetter: { color: '#fff', fontWeight: '700', fontSize: 16 },
  name:   { flex: 1, fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
  nameMe: { color: Colors.text, fontWeight: '800' },
  points:   { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.muted },
  pointsMe: { color: '#FF7A3C', fontWeight: '800' },
  sep: { height: 1, backgroundColor: Colors.border, marginLeft: Spacing.md + 44 + Spacing.md + 40 + Spacing.md },

  // Pinned caller row
  pinnedWrap: {
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  unrankedRow: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  unrankedText: {
    fontSize: FontSizes.sm, fontWeight: '700', color: Colors.muted,
    textAlign: 'center',
  },

  emptyWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg, gap: 12 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: FontSizes.lg, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  emptyBody:  { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center' },
});
