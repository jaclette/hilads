import { thumbUrl } from '@/lib/imageThumb';
/**
 * Here screen - two sections:
 *   1. Here now    - people live in this city right now (from AppContext, realtime)
 *   2. City crew   - registered members whose home city is this city (paginated API)
 *
 * Filters: badge and/or vibe, combinable.
 * Pagination: city crew loads 10 at a time via "Load more".
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { fetchCityMembers, fetchCityAmbassadors, fetchMessageBadges, type CityMember, type CityAmbassador, type UserBadgeInfo } from '@/api/channels';
import { filterBlocked } from '@/lib/blockFilter';
import type { OnlineUser } from '@/types';
import { canAccessProfile } from '@/lib/profileAccess';
import { BADGE_META } from '@/types';
import { Border, FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Avatar, Button, Chip, EmptyState, IconButton, ModeLabel, Screen, ScreenHeader } from '@/ui';

const CONTEXT_BADGE_KEYS = new Set(['host']);

// ── Badge pill ────────────────────────────────────────────────────────────────
// Accepts a badge key string; derives label and colors from shared BADGE_META.

function BadgePill({ badgeKey }: { badgeKey: string }) {
  const pillStyles = useThemedStyles(makePillStyles);
  const { t } = useTranslation('common');
  const meta = BADGE_META[badgeKey as keyof typeof BADGE_META] ?? BADGE_META.regular;
  return (
    <View style={[pillStyles.pill, badgeKey === 'host' && pillStyles.pillGold]}>
      <Text style={[pillStyles.text, badgeKey === 'host' && pillStyles.textGold]}>{t(`badge.${badgeKey}`, { defaultValue: meta.label })}</Text>
    </View>
  );
}

const VIBES = ['party', 'board_games', 'coffee', 'music', 'food', 'chill'] as const;
const VIBE_LABEL: Record<string, string> = { party: 'Party', board_games: 'Board Games', coffee: 'Coffee', music: 'Music', food: 'Food', chill: 'Chill' };

function VibePill({ vibe }: { vibe?: string | null }) {
  const pillStyles = useThemedStyles(makePillStyles);
  const { t } = useTranslation('common');
  if (!vibe || !VIBE_LABEL[vibe]) return null;
  return (
    <View style={[pillStyles.pill, pillStyles.pillTint]}>
      <Text style={[pillStyles.text, pillStyles.textTint]}>{t(`vibe.${vibe}`, { defaultValue: VIBE_LABEL[vibe] })}</Text>
    </View>
  );
}

function Mode({ mode }: { mode?: string | null }) {
  const { t } = useTranslation('common');
  if (mode !== 'local' && mode !== 'exploring') return null;
  return <ModeLabel mode={mode === 'local' ? 'local' : 'traveler'} label={t(`mode.${mode}.label`)} />;
}

const makePillStyles = (c: ThemeColors) => StyleSheet.create({
  pill:     { alignSelf: 'flex-start', height: 22, justifyContent: 'center', borderRadius: Radius.full, paddingHorizontal: 8, backgroundColor: c.bg3 },
  pillTint: { backgroundColor: c.primaryTint },
  pillGold: { backgroundColor: c.bg3 },
  text:     { fontSize: 11, fontWeight: '700', color: c.muted },
  textTint: { color: c.primaryOnTint },
  textGold: { color: c.gold },
});

const MODE_FILTERS = ['local', 'exploring'] as const;
const BADGE_FILTERS = ['fresh', 'regular', 'host'] as const;

function OnlineUserRow({ user, isMe, onPress, onDm }: {
  user: OnlineUser; isMe: boolean; onPress?: () => void; onDm: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('here');
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={onPress ? 0.7 : 1} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined}>
      <View>
        <Avatar uri={user.profilePhotoUrl ? thumbUrl(user.profileThumbPhotoUrl ?? user.profilePhotoUrl) : null} name={user.nickname ?? '?'} size={44} fallback="color" />
        <View style={styles.liveDot} />
      </View>
      <View style={styles.rowInfo}>
        <Text style={styles.nickname} numberOfLines={1}>
          {user.nickname}{isMe ? <Text style={styles.youLabel}> {t('you')}</Text> : ''}
        </Text>
        <View style={styles.badgeRow}>
          <Mode mode={user.mode} />
          {user.primaryBadge
            ? <BadgePill badgeKey={user.primaryBadge.key} />
            : <BadgePill badgeKey={user.isRegistered ? 'regular' : 'ghost'} />}
          {user.contextBadge && <BadgePill badgeKey={user.contextBadge.key} />}
          <VibePill vibe={user.vibe} />
        </View>
      </View>
      {!isMe && user.userId && (
        <IconButton icon="chatbubble-outline" iconSize={20} label={t('messages', { ns: 'common' })} onPress={onDm} />
      )}
    </TouchableOpacity>
  );
}

function CrewMemberRow({ member, onPress }: { member: CityMember; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7} accessibilityRole="button">
      <Avatar uri={member.avatarUrl ? thumbUrl(member.thumbAvatarUrl ?? member.avatarUrl) : null} name={member.displayName ?? '?'} size={44} fallback="color" />
      <View style={styles.rowInfo}>
        <Text style={styles.nickname} numberOfLines={1}>{member.displayName}</Text>
        <View style={styles.badgeRow}>
          <Mode mode={member.mode} />
          {member.badges.map(k => <BadgePill key={k} badgeKey={k} />)}
          <VibePill vibe={member.vibe} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function HereScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { t } = useTranslation('here');
  const { city, sessionId, account, onlineUsers, blockedSet } = useApp();

  const [filterBadge, setFilterBadge] = useState<string | null>(null);
  const [filterVibe,  setFilterVibe]  = useState<string | null>(null);
  const [filterMode,  setFilterMode]  = useState<string | null>(null);

  const [legends,      setLegends]      = useState<CityAmbassador[]>([]);

  const [crewMembers,  setCrewMembers]  = useState<CityMember[]>([]);
  const [onlineBadges, setOnlineBadges] = useState<Record<string, UserBadgeInfo>>({});
  const [crewPage,     setCrewPage]     = useState(1);
  const [crewHasMore,  setCrewHasMore]  = useState(false);
  const [crewLoading,  setCrewLoading]  = useState(false);

  const mySessionId = sessionId ?? '';

  // Block filter (Apple G1.2) - server already filters this list, but the
  // client-side pass keeps the UI instant when the user blocks someone
  // currently visible (no refetch round-trip).
  const visibleCrew = useMemo(
    () => filterBlocked(
      crewMembers,
      m => ({ userId: m.id, guestId: null }),
      blockedSet,
    ),
    [crewMembers, blockedSet],
  );

  // Build a userId → crew member lookup for badge enrichment
  const crewLookup = useMemo(() => {
    const map = new Map<string, CityMember>();
    visibleCrew.forEach(m => map.set(m.id, m));
    return map;
  }, [visibleCrew]);

  // Fetch city crew - reset and reload when filters or city changes
  const loadCrew = useCallback(async (page: number, reset: boolean) => {
    if (!city?.channelId) return;
    setCrewLoading(true);
    try {
      const data = await fetchCityMembers(city.channelId, {
        page,
        limit: 10,
        badge: filterBadge ?? undefined,
        vibe:  filterVibe  ?? undefined,
        mode:  filterMode  ?? undefined,
      });
      setCrewMembers(prev => reset ? data.members : [...prev, ...data.members]);
      setCrewHasMore(data.hasMore);
      setCrewPage(page);
    } catch { /* silent */ }
    finally  { setCrewLoading(false); }
  }, [city?.channelId, filterBadge, filterVibe, filterMode]);

  useEffect(() => {
    loadCrew(1, true);
  }, [loadCrew]);

  // Resolve avatars + badges for whoever is present right now. Presence has no
  // avatar and an online user may be outside the paginated crew list, so fetch
  // directly by userId (keyed on the set of online userIds).
  const onlineUserIdsKey = onlineUsers.map(u => u.userId ?? '').filter(Boolean).sort().join(',');
  useEffect(() => {
    const ids = onlineUsers.map(u => u.userId).filter((x): x is string => !!x);
    if (!city?.channelId || ids.length === 0) { setOnlineBadges({}); return; }
    fetchMessageBadges(city.channelId, ids).then(setOnlineBadges).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city?.channelId, onlineUserIdsKey]);

  // Fetch local legends (ambassadors) when city changes
  useEffect(() => {
    if (!city?.channelId) return;
    fetchCityAmbassadors(city.channelId).then(setLegends).catch(() => {});
  }, [city?.channelId]);

  // Enrich HERE NOW users with badge/vibe/avatar. WS presence carries no avatar,
  // and an online user isn't guaranteed to be in the paginated crew list, so we
  // resolve badges/avatars for the online userIds directly (onlineBadges) and use
  // that as the reliable source; crew + self/account are fallbacks.
  const enrichedOnline = useMemo(() => onlineUsers.map(u => {
    if (!u.userId) return u; // guest: no enrichment possible
    const isSelf = u.sessionId === mySessionId;
    const crew   = crewLookup.get(u.userId);
    const b      = onlineBadges[u.userId];
    if (!crew && !b && !isSelf) return u;
    const primaryKey = crew?.badges.find(k => !CONTEXT_BADGE_KEYS.has(k));
    const contextKey = crew?.badges.find(k => CONTEXT_BADGE_KEYS.has(k));
    return {
      ...u,
      primaryBadge:    primaryKey ? { key: primaryKey, label: BADGE_META[primaryKey as keyof typeof BADGE_META]?.label ?? primaryKey } : (b?.primaryBadge ?? u.primaryBadge),
      contextBadge:    contextKey ? { key: contextKey, label: BADGE_META[contextKey as keyof typeof BADGE_META]?.label ?? contextKey } : (b?.contextBadge ?? u.contextBadge),
      vibe:            crew?.vibe ?? b?.vibe ?? u.vibe,
      mode:            crew?.mode ?? b?.mode ?? u.mode,
      // profilePhotoUrl just needs to be truthy for OnlineUserRow to render the
      // image; the thumb URL from onlineBadges works for both fields.
      profilePhotoUrl:      crew?.avatarUrl      ?? b?.thumbAvatarUrl ?? (isSelf ? (account?.profile_photo_url       ?? undefined) : undefined) ?? u.profilePhotoUrl,
      profileThumbPhotoUrl: crew?.thumbAvatarUrl ?? b?.thumbAvatarUrl ?? (isSelf ? (account?.profile_thumb_photo_url ?? undefined) : undefined) ?? u.profileThumbPhotoUrl,
    };
  }), [onlineUsers, crewLookup, onlineBadges, mySessionId, account]);

  // Apply badge + vibe filters to live users (client-side - small list)
  const filteredOnline = enrichedOnline.filter(u => {
    if (filterBadge) {
      const isMe = u.sessionId === mySessionId;
      if (!isMe) {
        if (filterBadge === 'host') return u.contextBadge?.key === 'host';
        if (u.primaryBadge?.key !== filterBadge) return false;
      }
    }
    if (filterVibe && u.sessionId !== mySessionId && u.vibe !== filterVibe) return false;
    if (filterMode && u.sessionId !== mySessionId && u.mode !== filterMode) return false;
    return true;
  });

  const others = filteredOnline.filter(u => u.sessionId !== mySessionId);
  const me     = filteredOnline.find(u => u.sessionId === mySessionId);
  const liveList = me ? [...others, me] : others;

  const header = (
    <ScreenHeader title={t('title')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/chat' as never))}
                  right={city ? <Text style={styles.headerSub} numberOfLines={1}>{city.name}</Text> : undefined} />
  );

  if (!city) {
    return (
      <Screen>
        {header}
        <View style={styles.empty}>
          <EmptyState icon="location-outline" title={t('noCityTitle')} body={t('noCitySub')}
                      action={<Button label={t('browseCities')} onPress={() => router.push('/switch-city' as never)} />} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      {header}

      {/* Filters: badge, vibe, mode (combinable). */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow} style={styles.filtersWrap}>
        <Text style={styles.filterGroupLabel}>{t('filterBadge')}</Text>
        {BADGE_FILTERS.map(k => (
          <Chip key={k} variant="filter" label={t(`badge.${k}`, { ns: 'common' })} selected={filterBadge === k}
                onPress={() => setFilterBadge(v => v === k ? null : k)} />
        ))}
        <View style={styles.filterDivider} />
        <Text style={styles.filterGroupLabel}>{t('filterVibe')}</Text>
        {VIBES.map(k => (
          <Chip key={k} variant="filter" label={t(`vibe.${k}`, { ns: 'common', defaultValue: VIBE_LABEL[k] })} selected={filterVibe === k}
                onPress={() => setFilterVibe(v => v === k ? null : k)} />
        ))}
        <View style={styles.filterDivider} />
        <Text style={styles.filterGroupLabel}>{t('filterMode')}</Text>
        {MODE_FILTERS.map(k => (
          <Chip key={k} variant="filter" label={t(`mode.${k}.label`, { ns: 'common' })} selected={filterMode === k}
                onPress={() => setFilterMode(v => v === k ? null : k)} />
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ── Here now: only from 2 people (on your own it's just you). ── */}
        {liveList.length >= 2 && (
          <>
            <View style={styles.sectionHeader}>
              <View style={styles.liveDotSection} />
              <Text style={styles.sectionTitle}>{t('hereNow')} · {liveList.length}</Text>
            </View>
            <View style={styles.group}>
              {liveList.map((item, i) => {
                const isMe = item.sessionId === mySessionId;
                return (
                  <View key={item.sessionId} style={i > 0 && styles.divider}>
                    <OnlineUserRow
                      user={item}
                      isMe={isMe}
                      onPress={!isMe && item.userId ? () => {
                        if (!canAccessProfile(account)) { router.push('/auth-gate'); return; }
                        router.push({ pathname: '/user/[id]', params: { id: item.userId! } });
                      } : undefined}
                      onDm={() => {
                        if (!canAccessProfile(account)) { router.push('/auth-gate?reason=send_dm'); return; }
                        if (item.userId) router.push({ pathname: '/dm/[id]', params: { id: item.userId, name: item.nickname } });
                      }}
                    />
                  </View>
                );
              })}
            </View>
          </>
        )}

        {/* ── Local legends ── */}
        {legends.length > 0 && (
          <>
            <View style={styles.sectionHeaderCol}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="ribbon-outline" size={18} color={colors.gold} />
                <Text style={styles.sectionTitle}>{t('legends')}</Text>
              </View>
              <Text style={styles.sectionSub}>{t('legendsSub')}</Text>
            </View>
            <View style={[styles.group, styles.groupGold]}>
              {legends.map((m, i) => {
                const firstPick = m.ambassadorPicks?.tip ?? m.ambassadorPicks?.restaurant ?? m.ambassadorPicks?.spot ?? m.ambassadorPicks?.story;
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.row, i > 0 && styles.divider]}
                    onPress={() => {
                      if (!canAccessProfile(account)) { router.push('/auth-gate'); return; }
                      router.push({ pathname: '/user/[id]', params: { id: m.id, name: m.displayName } });
                    }}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                  >
                    <Avatar uri={m.avatarUrl ? thumbUrl(m.thumbAvatarUrl ?? m.avatarUrl) : null} name={m.displayName ?? '?'} size={44} fallback="color" />
                    <View style={styles.rowInfo}>
                      <Text style={styles.nickname} numberOfLines={1}>{m.displayName}</Text>
                      <View style={styles.badgeRow}>
                        {m.badges.map(k => <BadgePill key={k} badgeKey={k} />)}
                        <VibePill vibe={m.vibe} />
                      </View>
                      {firstPick ? (
                        <View style={styles.pickRow}>
                          <Ionicons name="bulb-outline" size={13} color={colors.muted} />
                          <Text style={styles.legendPickPreview} numberOfLines={1}>{firstPick}</Text>
                        </View>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {/* ── City crew ── */}
        <View style={styles.sectionHeader}>
          <Ionicons name="people-outline" size={18} color={colors.text} />
          <Text style={styles.sectionTitle}>{t('cityCrew')}</Text>
        </View>

        {crewLoading && visibleCrew.length === 0 ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : visibleCrew.length === 0 ? (
          <EmptyState body={t('noMatchCrew')} />
        ) : (
          <View style={styles.group}>
            {visibleCrew.map((m, i) => (
              <View key={m.id} style={i > 0 && styles.divider}>
                <CrewMemberRow
                  member={m}
                  onPress={() => {
                    if (!canAccessProfile(account)) { router.push('/auth-gate'); return; }
                    router.push({ pathname: '/user/[id]', params: { id: m.id, name: m.displayName } });
                  }}
                />
              </View>
            ))}
          </View>
        )}

        {crewHasMore && (
          <Button variant="secondary" label={t('loadMore')} onPress={() => loadCrew(crewPage + 1, false)} loading={crewLoading} style={styles.loadMore} />
        )}

      </ScrollView>
    </Screen>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  headerSub:        { maxWidth: 160, fontSize: FontSizes.xs, fontWeight: '600', color: c.muted },
  empty:            { flex: 1, justifyContent: 'center', padding: Spacing.lg },
  filtersWrap:      { flexGrow: 0 },
  filterRow:        { alignItems: 'center', gap: 8, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  filterGroupLabel: { fontSize: 12, fontWeight: '700', color: c.muted },
  filterDivider:    { width: 1, height: 22, backgroundColor: c.line, marginHorizontal: 4 },
  scrollContent:    { paddingHorizontal: Spacing.md, paddingBottom: Spacing.xl },
  sectionHeader:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: Spacing.md, marginBottom: 8 },
  sectionHeaderCol: { gap: 2, marginTop: Spacing.md, marginBottom: 8 },
  sectionTitleRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle:     { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  sectionSub:       { fontSize: FontSizes.xs, fontWeight: '400', color: c.muted },
  liveDotSection:   { width: 8, height: 8, borderRadius: Radius.full, backgroundColor: c.green },
  group:            { borderRadius: Radius.card, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2, paddingHorizontal: 14 },
  groupGold:        { borderColor: c.gold },
  divider:          { borderTopWidth: 1, borderTopColor: c.line },
  row:              { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 10 },
  liveDot:          { position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, borderRadius: Radius.full, backgroundColor: c.green,
                      borderWidth: 2, borderColor: c.bg2 },
  rowInfo:          { flex: 1, minWidth: 0, gap: 4 },
  nickname:         { fontSize: 15, fontWeight: '700', color: c.text },
  youLabel:         { fontSize: FontSizes.xs, fontWeight: '600', color: c.muted },
  badgeRow:         { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  pickRow:          { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendPickPreview:{ flex: 1, fontSize: 12, fontWeight: '400', color: c.muted },
  loader:           { marginTop: 12 },
  loadMore:         { marginTop: Spacing.md },
});
