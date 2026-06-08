import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, ActivityIndicator, TouchableOpacity, StyleSheet, RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useApp } from '@/context/AppContext';
import { fetchLeaderboard } from '@/api/leaderboard';
import { avatarColor } from '@/lib/avatarColors';
import { canAccessProfile } from '@/lib/profileAccess';
import { countryToFlag } from '@/lib/countryFlag';
import { localizeCityName } from '@/i18n/cityName';
import { LeaderboardCityPickerSheet } from '@/features/challenge/LeaderboardCityPickerSheet';
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

  // PR38 — allow callers (score celebration popin) to request an initial
  // scope via /leaderboard?scope=world. Only 'world' is honoured here;
  // anything else (including the absence of the param) falls back to
  // 'city', preserving the trophy-chip default.
  const params = useLocalSearchParams<{ scope?: string }>();
  const initialScope: LeaderboardScope = params.scope === 'world' ? 'world' : 'city';

  const [scope,  setScope]  = useState<LeaderboardScope>(initialScope);
  const [period, setPeriod] = useState<LeaderboardPeriod>('month');

  // PR13 — picker-overridden city for the leaderboard view. Null = use the
  // caller's current city (default behaviour). Setting this DOES NOT change
  // the user's actual current_city anywhere else in the app.
  const [pickedCity, setPickedCity] = useState<{ channelId: string; name: string } | null>(null);
  const [cityPickerOpen, setCityPickerOpen] = useState(false);

  const [data,    setData]    = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // The picker overrides the default; fall back to the caller's current city.
  const effectiveChannelId = pickedCity?.channelId ?? city?.channelId ?? null;
  const cityId = effectiveChannelId ? `city_${effectiveChannelId}` : undefined;
  const effectiveCityName  = pickedCity?.name ?? city?.name ?? null;

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

  // Open the row's user profile. Self → the Me tab (already known + editable);
  // others → the registered-user profile, behind canAccessProfile so guests
  // hit the auth gate instead of a 404 on the registered profile endpoint.
  const handleRowPress = useCallback((userId: string, isMe: boolean) => {
    if (isMe) {
      router.push('/(tabs)/me');
      return;
    }
    if (!canAccessProfile(account)) {
      router.push('/auth-gate');
      return;
    }
    router.push({ pathname: '/user/[id]', params: { id: userId } });
  }, [router, account]);

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
        cityLabel={localizeCityName(effectiveCityName) ?? t('leaderboard.scope.city')}
        onCityTap={scope === 'city' ? () => setCityPickerOpen(true) : undefined}
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
          renderItem={({ item }) => {
            const isMeRow = item.user_id === me?.user_id;
            return (
              <Row
                entry={item}
                isMe={isMeRow}
                showCity={scope === 'world'}
                onPress={() => handleRowPress(item.user_id, isMeRow)}
                t={t}
              />
            );
          }}
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
                cityName:       city?.name    ?? null,
                cityCountry:    city?.country ?? null,
              }}
              isMe
              showCity={scope === 'world'}
              onPress={() => handleRowPress(me.user_id, true)}
              t={t}
            />
          ) : (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => router.push('/challenge/create')}
              accessibilityRole="button"
              accessibilityLabel={t('leaderboard.me.unranked')}
            >
              <LinearGradient
                colors={Gradients.primary.colors}
                start={Gradients.primary.start}
                end={Gradients.primary.end}
                style={styles.unrankedCta}
              >
                <Text style={styles.unrankedCtaText}>
                  🔥 {t('leaderboard.me.unranked')}
                </Text>
                <Ionicons name="arrow-forward" size={18} color={Colors.white} />
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* PR13 — city picker sheet. Selecting a city overrides the
          leaderboard's view scope to that city, without touching the user's
          actual current_city anywhere else in the app. */}
      <LeaderboardCityPickerSheet
        visible={cityPickerOpen}
        selectedChannelId={effectiveChannelId}
        onSelect={(channelId, picked) => {
          setPickedCity({ channelId, name: picked.name });
          setCityPickerOpen(false);
        }}
        onClose={() => setCityPickerOpen(false)}
      />
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
  scope, onScope, period, onPeriod, cityLabel, onCityTap, t,
}: {
  scope:  LeaderboardScope;
  onScope: (v: LeaderboardScope) => void;
  period: LeaderboardPeriod;
  onPeriod: (v: LeaderboardPeriod) => void;
  cityLabel: string;
  /** Provided when scope='city' — tapping the city segment opens the picker.
   *  When scope='world', undefined and the tap behaves like a normal scope
   *  switch (back to city). */
  onCityTap?: () => void;
  t: (k: string) => string;
}) {
  // Primary toggle (city ⇄ world) — custom layout instead of the generic
  // Segmented because the city pill carries a chevron when active to signal
  // it's tappable (opens the picker).
  const cityActive  = scope === 'city';
  const worldActive = scope === 'world';
  return (
    <View style={styles.selectorsWrap}>
      <View style={styles.segWrap}>
        <TouchableOpacity
          style={[styles.segItem, !cityActive && undefined]}
          onPress={() => (cityActive && onCityTap ? onCityTap() : onScope('city'))}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ selected: cityActive }}
        >
          {cityActive && (
            <LinearGradient
              colors={Gradients.primary.colors}
              start={Gradients.primary.start}
              end={Gradients.primary.end}
              style={StyleSheet.absoluteFill}
            />
          )}
          <View style={styles.cityLabelRow}>
            <Text
              style={[styles.segText, cityActive && styles.segTextActiveGradient]}
              numberOfLines={1}
            >
              {cityLabel}
            </Text>
            {cityActive && (
              <Ionicons name="chevron-down" size={14} color={Colors.white} style={{ marginLeft: 4 }} />
            )}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.segItem}
          onPress={() => onScope('world')}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ selected: worldActive }}
        >
          {worldActive && (
            <LinearGradient
              colors={Gradients.primary.colors}
              start={Gradients.primary.start}
              end={Gradients.primary.end}
              style={StyleSheet.absoluteFill}
            />
          )}
          <Text
            style={[styles.segText, worldActive && styles.segTextActiveGradient]}
            numberOfLines={1}
          >
            {t('leaderboard.scope.world')}
          </Text>
        </TouchableOpacity>
      </View>

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
  entry, isMe, showCity, onPress, t,
}: {
  entry: LeaderboardEntry;
  isMe:  boolean;
  /** PR13 — show the user's city + flag next to displayName. Only true on
   *  world scope; city scope hides it as redundant (everyone in the list
   *  shares the same city). */
  showCity?: boolean;
  /** Tap navigates to the row's profile (self → Me tab, others → /user/[id]
   *  behind canAccessProfile). The whole row is the touch target. */
  onPress?: () => void;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const flag = entry.cityCountry ? countryToFlag(entry.cityCountry) : '';
  const cityLabel = entry.cityName ? localizeCityName(entry.cityName) : null;
  return (
    <TouchableOpacity
      style={[styles.row, isMe && styles.rowMe]}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={entry.displayName}
    >
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
      <View style={styles.nameWrap}>
        <Text style={[styles.name, isMe && styles.nameMe]} numberOfLines={1}>
          {entry.displayName}
        </Text>
        {showCity && cityLabel && (
          <Text style={styles.citySub} numberOfLines={1}>
            {flag ? `${flag} ` : ''}{cityLabel}
          </Text>
        )}
      </View>
      <Text style={[styles.points, isMe && styles.pointsMe]}>
        {t('leaderboard.points', { points: entry.points })}
      </Text>
    </TouchableOpacity>
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
  // City segment label + chevron, centered as a row (active state only).
  cityLabelRow: {
    flexDirection: 'row',
    alignItems:    'center',
    justifyContent:'center',
  },
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
  // PR13 — wrapper allowing the city subtitle to stack under the displayName.
  // Replaces the previous direct `name` flex layout when showCity is on.
  nameWrap: { flex: 1, minWidth: 0, gap: 1 },
  name:     { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
  citySub:  { fontSize: FontSizes.xs, color: Colors.muted2, fontWeight: '600' },
  nameMe: { color: Colors.text, fontWeight: '800' },
  points:   { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.muted },
  pointsMe: { color: '#FF7A3C', fontWeight: '800' },
  sep: { height: 1, backgroundColor: Colors.border, marginLeft: Spacing.md + 44 + Spacing.md + 40 + Spacing.md },

  // Pinned caller row
  pinnedWrap: {
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  // Unranked CTA — replaces the previous muted-grey one-liner. Orange
  // gradient pill that nudges the unranked viewer straight into the
  // create-challenge flow. Branded primary gradient (#C24A38 → #B87228),
  // arrow on the right so the affordance reads as "go do this".
  unrankedCta: {
    marginHorizontal:  Spacing.md,
    marginVertical:    Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical:   14,
    borderRadius:      Radius.full,
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               10,
    shadowColor:       '#C24A38',
    shadowOpacity:     0.35,
    shadowRadius:      12,
    shadowOffset:      { width: 0, height: 4 },
    elevation:         4,
  },
  unrankedCtaText: {
    color:      Colors.white,
    fontSize:   FontSizes.md,
    fontWeight: '800',
    letterSpacing: -0.2,
    textAlign:  'center',
  },

  emptyWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg, gap: 12 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: FontSizes.lg, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  emptyBody:  { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center' },
});
