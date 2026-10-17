import { thumbUrl } from '@/lib/imageThumb';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, ActivityIndicator, TouchableOpacity, StyleSheet, RefreshControl,
} from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { fetchLeaderboard } from '@/api/leaderboard';
import { canAccessProfile } from '@/lib/profileAccess';
import { countryToFlag } from '@/lib/countryFlag';
import { localizeCityName } from '@/i18n/cityName';
import { cityDemonym } from '@/lib/cityDemonym';
import { LeaderboardCityPickerSheet } from '@/features/challenge/LeaderboardCityPickerSheet';
import { Border, FontSizes, Spacing, Radius, buildLeaderboardUrl, type ThemeColors } from '@/constants';
import { RankMedal } from '@/features/daily/RankMedal';
import { Avatar, Button, EmptyState, Screen, ScreenHeader, Segmented } from '@/ui';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useShareToCity } from '@/lib/useShareToCity';
import { useShareToWorld } from '@/lib/useShareToWorld';
import { buildRankShareMessage } from '@/lib/buildRankShareMessage';
import type {
  LeaderboardResponse, LeaderboardScope, LeaderboardPeriod, LeaderboardEntry,
} from '@/types';

const PAGE_SIZE = 50;

/**
 * Leaderboard screen - reached from the 🏆 chip on the MY CITY tab.
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
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const router = useRouter();
  const { t } = useTranslation('challenge');
  const { account, city } = useApp();

  // PR38 - allow callers (score celebration popin) to request an initial
  // scope via /leaderboard?scope=world. Only 'world' is honoured here;
  // anything else (including the absence of the param) falls back to
  // 'city', preserving the trophy-chip default.
  const params = useLocalSearchParams<{ scope?: string; period?: string }>();
  const initialScope: LeaderboardScope =
    params.scope === 'world' ? 'world' : params.scope === 'cities' ? 'cities' : 'city';
  const initialPeriod: LeaderboardPeriod = params.period === 'alltime' ? 'alltime' : 'month';

  const [scope,  setScope]  = useState<LeaderboardScope>(initialScope);
  const [period, setPeriod] = useState<LeaderboardPeriod>(initialPeriod);

  const { shareToCity }  = useShareToCity();
  const { shareToWorld } = useShareToWorld();

  // PR13 - picker-overridden city for the leaderboard view. Null = use the
  // caller's current city (default behaviour). Setting this DOES NOT change
  // the user's actual current_city anywhere else in the app. `country` is
  // kept so the city segment can show its flag without a separate lookup.
  const [pickedCity, setPickedCity] = useState<{ channelId: string; name: string; country?: string } | null>(null);
  const [cityPickerOpen, setCityPickerOpen] = useState(false);

  const [data,    setData]    = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // The picker overrides the default; fall back to the caller's current city.
  const effectiveChannelId   = pickedCity?.channelId ?? city?.channelId ?? null;
  const cityId               = effectiveChannelId ? `city_${effectiveChannelId}` : undefined;
  const effectiveCityName    = pickedCity?.name    ?? city?.name    ?? null;
  const effectiveCityCountry = pickedCity?.country ?? city?.country ?? null;

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
  // True iff the caller appears in the visible page - avoids a duplicate row.
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

  // City-specific title: "Most Saigonese" for HCMC, etc. Falls back to the
  // generic "Most Local" for the cities/world scopes or unmapped cities.
  const demonym = scope === 'city' ? cityDemonym(effectiveCityName) : null;
  const headerTitle = demonym
    ? t('leaderboard.titleCity', { demonym, defaultValue: `🏆 Most ${demonym}` })
    : t('leaderboard.title');

  // "Share my rank" - fun message + neighbour @mentions (users only), posted to
  // the right channel (city/cities → my city; world → World). Null when there's
  // no rank or the two neighbours aren't on the loaded page → CTA hidden.
  const rankShare = useMemo(() => buildRankShareMessage({
    scope, period, entries,
    me: me ? { rank: me.rank, points: me.points } : null,
    myCityId: city?.channelId ? `city_${city.channelId}` : null,
    placeCityName: localizeCityName(effectiveCityName) ?? effectiveCityName ?? undefined,
    url: buildLeaderboardUrl(scope, period),
    t,
  }), [scope, period, entries, me, city?.channelId, effectiveCityName, t]);

  const onShareRank = useCallback(() => {
    if (!rankShare) return;
    if (scope === 'world') shareToWorld(rankShare.text, rankShare.mentions);
    else                   shareToCity(rankShare.text, rankShare.mentions);
  }, [rankShare, scope, shareToWorld, shareToCity]);

  return (
    <Screen>
      <ScreenHeader title={headerTitle} compact />

      <Selectors
        scope={scope}      onScope={setScope}
        period={period}    onPeriod={setPeriod}
        cityLabel={localizeCityName(effectiveCityName) ?? t('leaderboard.scope.city')}
        cityCountry={effectiveCityCountry}
        onCityTap={scope === 'city' ? () => setCityPickerOpen(true) : undefined}
        t={t}
      />

      {rankShare && (
        <Button variant="secondary" size="sm" icon="megaphone-outline" label={t('leaderboard.share.cta')} onPress={onShareRank}
                style={styles.shareRank} />
      )}

      {loading && !data ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : error ? (
        <View style={styles.emptyWrap}>
          <EmptyState icon="cloud-offline-outline" body={error} />
        </View>
      ) : entries.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState icon="trophy-outline" title={t('leaderboard.empty.title')} body={t('leaderboard.empty.body')} />
        </View>
      ) : (
        <FlatList
          data={entries}
          // Cities-scope rows have no user_id; fall back to city_id + rank.
          // User rows always have user_id.
          keyExtractor={(e) => e.user_id ?? e.city_id ?? `r${e.rank}`}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          renderItem={({ item }) => {
            if (scope === 'cities') {
              const isMyCity = !!city?.channelId && item.city_id === `city_${city.channelId}`;
              return <CityRow entry={item} isMe={isMyCity} t={t} />;
            }
            const isMeRow = item.user_id === me?.user_id;
            return (
              <Row
                entry={item}
                isMe={isMeRow}
                showCity={scope === 'world'}
                onPress={() => handleRowPress(item.user_id ?? '', isMeRow)}
                t={t}
              />
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}

      {/* Pinned caller row - only when not already visible in the page.
          On the cities scope, the pinned row is the caller's CITY (not the
          caller themselves), so spectators see where their home city sits
          in the cup. */}
      {me && !meInPage && (
        <View style={styles.pinnedWrap}>
          {me.rank !== null && scope === 'cities' ? (
            <CityRow
              entry={{
                rank:        me.rank,
                city_id:     city?.channelId ? `city_${city.channelId}` : undefined,
                cityName:    city?.name    ?? null,
                cityCountry: city?.country ?? null,
                points:      me.points,
              }}
              isMe
              t={t}
            />
          ) : me.rank !== null ? (
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
            <Button icon="flame-outline" label={t('leaderboard.me.unranked')} onPress={() => router.navigate('/(tabs)/today' as never)}
                    style={styles.unrankedCta} />
          )}
        </View>
      )}

      {/* PR13 - city picker sheet. Selecting a city overrides the
          leaderboard's view scope to that city, without touching the user's
          actual current_city anywhere else in the app. */}
      <LeaderboardCityPickerSheet
        visible={cityPickerOpen}
        selectedChannelId={effectiveChannelId}
        onSelect={(channelId, picked) => {
          setPickedCity({ channelId, name: picked.name, country: picked.country });
          setCityPickerOpen(false);
        }}
        onClose={() => setCityPickerOpen(false)}
      />
    </Screen>
  );
}

// ── Selectors ────────────────────────────────────────────────────────────────

function Selectors({
  scope, onScope, period, onPeriod, cityLabel, cityCountry, onCityTap, t,
}: {
  scope:  LeaderboardScope;
  onScope: (v: LeaderboardScope) => void;
  period: LeaderboardPeriod;
  onPeriod: (v: LeaderboardPeriod) => void;
  cityLabel: string;
  /** ISO-2 country code for the displayed city - drives the flag prefix.
   *  Null when neither the picker nor the user's current city resolves a
   *  country (rare; geolocation usually populates it). */
  cityCountry: string | null;
  /** Provided when scope='city' - opens the city picker. */
  onCityTap?: () => void;
  t: (k: string) => string;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const cityFlag = cityCountry ? countryToFlag(cityCountry) : '';
  return (
    <View style={styles.selectorsWrap}>
      {/* Scope: My city ⇄ Cities ⇄ World. Tapping "My city" again opens the picker. */}
      <Segmented<LeaderboardScope>
        options={[
          { key: 'city',   label: t('leaderboard.scope.city') },
          { key: 'cities', label: t('leaderboard.scope.cities') },
          { key: 'world',  label: t('leaderboard.scope.world') },
        ]}
        value={scope}
        onChange={(v) => (v === 'city' && scope === 'city' && onCityTap ? onCityTap() : onScope(v))}
      />

      {/* The city being shown (My city scope): tap to pick another one. */}
      {onCityTap && (
        <TouchableOpacity style={styles.cityPick} onPress={onCityTap} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel={cityLabel}>
          {cityFlag ? <Text style={styles.cityFlag}>{cityFlag}</Text> : <Ionicons name="location-outline" size={16} color={colors.muted} />}
          <Text style={styles.cityPickText} numberOfLines={1}>{cityLabel}</Text>
          <Ionicons name="chevron-down" size={16} color={colors.muted} />
        </TouchableOpacity>
      )}

      <Segmented<LeaderboardPeriod>
        options={[
          { key: 'month',   label: t('leaderboard.period.month') },
          { key: 'alltime', label: t('leaderboard.period.alltime') },
        ]}
        value={period}
        onChange={onPeriod}
      />
    </View>
  );
}

// ── Row ──────────────────────────────────────────────────────────────────────

function Row({
  entry, isMe, showCity, onPress, t,
}: {
  entry: LeaderboardEntry;
  isMe:  boolean;
  /** PR13 - show the user's city + flag next to displayName. Only true on
   *  world scope; city scope hides it as redundant (everyone in the list
   *  shares the same city). */
  showCity?: boolean;
  /** Tap navigates to the row's profile (self → Me tab, others → /user/[id]
   *  behind canAccessProfile). The whole row is the touch target. */
  onPress?: () => void;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const styles = useThemedStyles(makeStyles);
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
      <RankMedal rank={entry.rank} size={30} style={styles.rank} />
      <Avatar uri={entry.thumbAvatarUrl ? thumbUrl(entry.thumbAvatarUrl) : null} name={entry.displayName || '?'} size={40} fallback="color" />
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

// ── Cities-scope row ─────────────────────────────────────────────────────────
// A single row of the "Cities" tab: flag + city name + sum of all member
// scores. No avatar, no tap (cities don't have profiles). The user's home
// city gets the same orange highlight as the user-row "isMe" treatment so
// they can scan to where they sit in the cup.
function CityRow({
  entry, isMe, t,
}: {
  entry: LeaderboardEntry;
  isMe:  boolean;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const flag      = entry.cityCountry ? countryToFlag(entry.cityCountry) : '';
  const cityLabel = entry.cityName ? localizeCityName(entry.cityName) : '-';
  return (
    <View style={[styles.row, isMe && styles.rowMe]}>
      <RankMedal rank={entry.rank} size={30} style={styles.rank} />
      <View style={styles.cityFlagBox}>
        {flag ? <Text style={styles.cityFlagText}>{flag}</Text> : <Ionicons name="globe-outline" size={20} color={colors.muted} />}
      </View>
      <View style={styles.nameWrap}>
        <Text style={[styles.name, isMe && styles.nameMe]} numberOfLines={1}>
          {cityLabel}
        </Text>
      </View>
      <Text style={[styles.points, isMe && styles.pointsMe]}>
        {t('leaderboard.points', { points: entry.points })}
      </Text>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  shareRank: { alignSelf: 'center', marginBottom: Spacing.xs },

  // Selectors
  selectorsWrap: { paddingHorizontal: Spacing.md, paddingTop: Spacing.xs, paddingBottom: Spacing.sm, gap: Spacing.sm },
  cityPick:      { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, maxWidth: '100%',
                   paddingHorizontal: 14, borderRadius: Radius.full, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  cityFlag:      { fontSize: 16 },
  cityPickText:  { flexShrink: 1, fontSize: FontSizes.sm, fontWeight: '700', color: c.text },

  // List
  list:   { paddingVertical: Spacing.sm },
  row:    { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  rowMe:  { backgroundColor: c.primaryTint },
  rank:   { width: 36 },
  // Cities-scope: a flag slots into the avatar position. Same 40×40
  // footprint so the row geometry doesn't drift between scopes.
  cityFlagBox:  { width: 40, height: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg2,
                  borderWidth: Border, borderColor: c.line },
  cityFlagText: { fontSize: 22, lineHeight: 26 },
  // PR13 - wrapper allowing the city subtitle to stack under the displayName.
  nameWrap: { flex: 1, minWidth: 0, gap: 1 },
  name:     { fontSize: FontSizes.md, fontWeight: '700', color: c.text },
  citySub:  { fontSize: FontSizes.xs, fontWeight: '600', color: c.muted },
  nameMe:   { color: c.primaryOnTint, fontWeight: '800' },
  points:   { fontSize: FontSizes.sm, fontWeight: '700', color: c.muted },
  pointsMe: { color: c.primaryOnTint, fontWeight: '800' },
  sep:      { height: 1, backgroundColor: c.line, marginLeft: Spacing.md + 36 + 12 + 40 + 12 },

  // Pinned caller row
  pinnedWrap:  { borderTopWidth: Border, borderTopColor: c.line, backgroundColor: c.bg },
  unrankedCta: { marginHorizontal: Spacing.md, marginVertical: Spacing.sm },

  emptyWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.lg },
});
