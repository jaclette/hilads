import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { AppHeader } from '@/features/shell/AppHeader';
import { SeasonalScope } from '@/features/event/SeasonalArt';
import { Avatar, Segmented, ThemeIcon } from '@/ui';
import { useDailyToday } from '@/hooks/useDaily';
import { ShareSheet } from '@/features/share/ShareSheet';
import { proofShare, todayShare, type ShareContent } from '@/features/share/content';
import { Confetti, FlagSticker, themeColor, tint } from '@/ui/joy';
import { shortCityName } from '@/i18n/cityName';
import { thumbUrl } from '@/lib/imageThumb';
import { handOffList } from '@/lib/prefetch';
import { canAccessProfile } from '@/lib/profileAccess';
import { track } from '@/services/analytics';
import {
  fetchRanks, type CitiesRanks, type PhotosRanks, type PlayersRanks, type RanksPeriod, type RanksScope, type RanksTab,
} from '@/api/ranks';
import type { DailyProof } from '@/types';
import { MEDAL, Movement, Podium, RaceBar, RankRow, ScopeToggle, YouBar, type PodiumGhost, type PodiumItem } from '@/features/ranks/parts';

// The last answer of each view (segment, period, scope, city), in memory.
const ranksCache = new Map<string, PlayersRanks | CitiesRanks | PhotosRanks>();

const PERIODS: Record<RanksTab, RanksPeriod[]> = {
  photos:  ['today', 'yesterday', 'week', 'alltime'],
  players: ['today', 'week', 'alltime'],
  cities:  ['today', 'week', 'alltime'],
};

/**
 * RANKS (V6), the game hub: 📸 Photos, 🙋 Players, 🌍 Cities, for today, this
 * week or all time (photos: also yesterday's results), in my city or the World.
 * A podium for the top 3, then a list with movement since yesterday, and a
 * sticky "You" bar. Deep links: /ranks?tab=&period=&scope=.
 * Filters (V6.4): the periods as equal chips across the width (no scrolling),
 * then the info line (time left to vote) with the scope toggle on its right
 * ("🇻🇳 Saigon | 🌍 World", the header's city; none on Cities). A podium short
 * of 3 shows the missing places as dashed ghosts that lead to the camera or Today.
 */
export default function RanksScreen() {
  return <SeasonalScope><RanksContent /></SeasonalScope>;
}

function RanksContent() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { city, account } = useApp();
  const params = useLocalSearchParams<{ tab?: string; period?: string; scope?: string; cityId?: string; focus?: string }>();
  // ?focus=me (the results card): the photos ranking opens on my photo, with a little confetti.
  const [focusMe, setFocusMe] = useState(false);
  useEffect(() => { if (params.focus === 'me') setFocusMe(true); }, [params.focus]);
  const [tab, setTab] = useState<RanksTab>('photos');
  const [period, setPeriod] = useState<RanksPeriod>('today');
  // The scope follows the city chosen in the header (World without one).
  const [scope, setScope] = useState<RanksScope>('city');
  // Each response is kept with what it was asked for: a view only ever gets its own shape (switching
  // tabs, or a slow answer for the previous tab, used to hand Cities rows to the Players view).
  const [resp, setResp] = useState<{ key: string; data: PlayersRanks | CitiesRanks | PhotosRanks } | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const list = useRef<FlatList<unknown>>(null);
  // A rank-up notification names its city (cityId); else my city.
  const myCityId = city?.channelId ? Number(String(city.channelId).replace('city_', '')) || null : null;
  const cityId = Number(params.cityId) || myCityId;
  const scopeNow: RanksScope = cityId ? scope : 'world';
  const key = `${tab}|${period}|${scopeNow}|${cityId}`;
  // A view seen before shows its last answer at once (stale-while-revalidate), refreshed below.
  const data = resp?.key === key ? resp.data : ranksCache.get(key) ?? null;

  // A deep link (push, Passport, a notification) picks the segment, period and scope.
  useEffect(() => {
    const tb = (['photos', 'players', 'cities'] as RanksTab[]).find(x => x === params.tab);
    if (tb) setTab(tb);
    const pd = (['today', 'yesterday', 'week', 'alltime'] as RanksPeriod[]).find(x => x === params.period);
    if (pd) setPeriod(pd);
    if (params.scope === 'city' || params.scope === 'world') setScope(params.scope);
  }, [params.tab, params.period, params.scope]);
  useEffect(() => { if (!PERIODS[tab].includes(period)) setPeriod('today'); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setFailed(false);
    const asked = key;
    try {
      const o = { period, scope: scopeNow, cityId };
      const next = tab === 'players' ? await fetchRanks('players', o) : tab === 'cities' ? await fetchRanks('cities', o) : await fetchRanks('photos', o);
      ranksCache.set(asked, next);
      setResp({ key: asked, data: next });
    } catch {
      setFailed(true);
    }
  }, [tab, period, scopeNow, cityId, key]);
  useEffect(() => { load(); track('ranks_viewed', { tab, period, scope: scopeNow }); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const pick = <T,>(set: (v: T) => void, v: T) => { Haptics.selectionAsync().catch(() => {}); set(v); };

  // The info line (today's photos: the time left to vote), on the left of the scope toggle.
  const endsAt = tab === 'photos' && period === 'today' ? (data as PhotosRanks | null)?.endsAt ?? null : null;
  const hours = endsAt ? Math.max(0, Math.floor((endsAt * 1000 - Date.now()) / 3_600_000)) : null;
  const info = hours === null ? '' : hours > 0 ? t('ranks.timeLeft', { count: hours }) : t('ranks.timeLeftMin');
  const showToggle = tab !== 'cities' && !!cityId;
  // An empty podium place sends to the camera (today's photos) or to Today.
  // An empty podium place depends on where I stand: a past period has nobody to call ("Nobody
  // took this spot"); today, before I've played: play (the camera, never the edit of a photo I
  // posted); once I've played: invite a friend (today's share card, "Your turn", and its link).
  const today = useDailyToday(city?.channelId);
  const [share, setShare] = useState<ShareContent | null>(null);
  const played = !!(data as { played?: boolean } | null)?.played;
  const tap = (action: string, go: () => void) => () => {
    Haptics.selectionAsync().catch(() => {});
    track('ranks_ghost_tapped', { tab, period, action });
    go();
  };
  const invite = () => {
    const d = today.data;
    if (d?.challenge && d.myProof) setShare(proofShare(d.myProof, d.challenge));
    else if (d?.challenge && city) setShare(todayShare(d.challenge, city));
    else router.navigate('/(tabs)/today' as never);
  };
  const ghost: PodiumGhost = (rank) => {
    if (period !== 'today') return { label: t('ranks.ghost.empty'), icon: 'close-outline' };
    if (tab === 'cities') return { label: t('ranks.ghost.city'), icon: 'flag-outline', onPress: tap('today', () => router.navigate('/(tabs)/today' as never)) };
    if (played) return { label: t('ranks.ghost.invite', { rank }), icon: 'person-add-outline', onPress: tap('invite', invite) };
    if (tab === 'photos') {
      return { label: t('ranks.ghost.photo'), icon: 'camera-outline',
               onPress: tap('play', () => router.push((account ? '/daily/proof' : '/auth-gate?reason=daily_proof&returnTo=%2Fdaily%2Fproof') as never)) };
    }
    return { label: t('ranks.ghost.player'), icon: 'camera-outline', onPress: tap('play', () => router.navigate('/(tabs)/today' as never)) };
  };
  const loadMorePhotos = useCallback((offset: number) => fetchRanks('photos', { period, scope: scopeNow, cityId, offset }), [period, scopeNow, cityId]);

  const header = (
    <View style={styles.controls}>
      <Segmented<RanksTab> value={tab} onChange={v => pick(setTab, v)} options={[
        { key: 'photos', label: t('ranks.seg.photos') }, { key: 'players', label: t('ranks.seg.players') }, { key: 'cities', label: t('ranks.seg.cities') },
      ]} />
      {/* The periods: equal chips across the width, no scrolling (nothing hidden off screen). */}
      <View style={styles.periods} accessibilityRole="tablist">
        {PERIODS[tab].map(p => (
          <Chip key={p} on={period === p} label={t(`ranks.period.${p}`)} onPress={() => pick(setPeriod, p)} />
        ))}
      </View>
      {(showToggle || !!info) && (
        <View style={styles.infoRow}>
          <Text style={styles.info} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{info}</Text>
          {showToggle && (
            <ScopeToggle value={scope} onChange={v => pick(setScope, v)} worldLabel={t('ranks.scope.world')}
                         city={city?.name ? shortCityName(city.name) : t('ranks.scope.city')} country={city?.country} />
          )}
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header} testID="ranks-screen"><AppHeader /></View>
      <View style={styles.flex}>
        {tab === 'photos' && <PhotosView data={data as PhotosRanks | null} header={header} failed={failed} refreshing={refreshing} onRefresh={onRefresh} period={period} ghost={ghost}
                                         loadMore={loadMorePhotos} list={list} focusMe={focusMe} onFocused={() => setFocusMe(false)} />}
        {tab === 'players' && <PlayersView data={data as PlayersRanks | null} header={header} failed={failed} refreshing={refreshing} onRefresh={onRefresh} ghost={ghost}
                                           period={period} list={list} onOpen={id => { if (canAccessProfile(account)) router.push(`/user/${id}` as never); }} />}
        {tab === 'cities' && <CitiesView data={data as CitiesRanks | null} header={header} failed={failed} refreshing={refreshing} onRefresh={onRefresh} ghost={ghost}
                                         period={period} list={list} myCityId={cityId} />}
      </View>
      <ShareSheet content={share} source="ranks_ghost" onClose={() => setShare(null)} />
    </SafeAreaView>
  );
}

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label}>
      <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{label}</Text>
    </Pressable>
  );
}

function Empty({ text, failed }: { text: string; failed: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>{failed ? '📡' : '🏆'}</Text>
      <Text style={styles.emptyText}>{failed ? t('loadFailed') : text}</Text>
    </View>
  );
}

/** Open the photo feed on a photo, playing the ranking in order from it. */
function useOpenPhoto() {
  const router = useRouter();
  return (proofs: DailyProof[], p: DailyProof) => {
    const key = `ranks-${Date.now()}`;
    handOffList(key, proofs);
    router.push(`/daily/photos?list=${key}&proof=${p.id}&source=ranks` as never);
  };
}

// ── Photos ──────────────────────────────────────────────────────────────────

function PhotosView({ data, header, failed, refreshing, onRefresh, period, ghost, loadMore, list, focusMe = false, onFocused }: {
  data: PhotosRanks | null; header: React.ReactNode; failed: boolean; refreshing: boolean; onRefresh: () => void; period: RanksPeriod; ghost: PodiumGhost;
  loadMore: (offset: number) => Promise<PhotosRanks>; list: React.RefObject<FlatList<unknown> | null>;
  /** Open on my photo (scrolled to its row) with a confetti burst, once the data is here. */
  focusMe?: boolean; onFocused?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const { account } = useApp();
  const open = useOpenPhoto();
  // Later pages, appended as the list scrolls (each photo keeps the rank the server gave it).
  const [more, setMore] = useState<{ base: PhotosRanks; items: PhotosRanks['items']; next: number | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const extra = more?.base === data ? more : null;
  const items = useMemo(() => [...(data?.items ?? []), ...(extra?.items ?? [])], [data, extra]);
  const next = extra ? extra.next : data?.nextOffset ?? null;
  const proofs = useMemo(() => items.map(i => i.proof), [items]);
  const onEnd = () => {
    if (!data || next === null || loading) return;
    setLoading(true);
    loadMore(next)
      .then(p => setMore(m => ({ base: data, items: [...(m?.base === data ? m.items : []), ...p.items.filter(x => !items.some(y => y.proof.id === x.proof.id))], next: p.nextOffset ?? null })))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const top = items.filter(i => i.rank <= 3);
  const rest = items.filter(i => i.rank > 3);
  const podium: PodiumItem[] = top.map(i => ({
    key: i.proof.id, rank: i.rank, label: i.proof.user.username ? `@${i.proof.user.username}` : i.proof.user.displayName ?? '',
    lead: <Image source={{ uri: thumbUrl(i.proof.thumbUrl ?? i.proof.photoUrl) ?? undefined }} style={[styles.podiumPhoto, { borderColor: MEDAL[i.rank - 1] }]} contentFit="cover" />,
    value: i.proof.voteCount, format: n => `${n} ❤️`, onPress: () => open(proofs, i.proof),
  }));

  // The "You" bar: my best photo of the period and the likes it needs to pass the one above.
  const me = data?.me ?? null;
  const youText = me
    ? me.rank === 1 ? t('ranks.you.photoTop') : t('ranks.you.photo', { rank: me.rank, count: me.gap ?? 1, next: me.rank - 1 })
    : !account || (period === 'today' && !data?.played) ? t('ranks.you.none') : t('ranks.you.photoNone');
  const onYou = () => {
    if (!me) return;
    const i = rest.findIndex(x => x.proof.id === me.proofId);
    if (i >= 0) list.current?.scrollToIndex({ index: i, viewPosition: 0.5 });
    else { const p = items.find(x => x.proof.id === me.proofId); if (p) open(proofs, p.proof); }
  };

  // The results card's tap: my photo's row in view, a burst of confetti, a success buzz.
  const [burst, setBurst] = useState(false);
  useEffect(() => {
    if (!focusMe || !data) return;
    onFocused?.();
    if (!me) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setBurst(true);
    const i = rest.findIndex(x => x.proof.id === me.proofId);
    const id = i >= 0 ? setTimeout(() => list.current?.scrollToIndex({ index: i, viewPosition: 0.4 }), 350) : null;
    const end = setTimeout(() => setBurst(false), 2200);
    return () => { if (id) clearTimeout(id); clearTimeout(end); };
  }, [focusMe, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const headerBlock = (
    <View>
      {header}
      {items.length > 0 && <Podium items={podium} ghost={ghost} />}
      {period === 'yesterday' && !!data?.cityBest?.length && (
        <View style={styles.cityBest}>
          <Text style={styles.sectionTitle}>{t('ranks.bestPerCity')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {data.cityBest.map(({ proof }) => (
              <Pressable key={proof.id} onPress={() => open(data.cityBest!.map(x => x.proof), proof)} style={styles.bestCard} accessibilityRole="button"
                         accessibilityLabel={shortCityName(proof.city?.name ?? '')}>
                <Image source={{ uri: thumbUrl(proof.thumbUrl ?? proof.photoUrl) ?? undefined }} style={styles.bestPhoto} contentFit="cover" />
                <View style={styles.bestFoot}>
                  <FlagSticker country={proof.city?.country} size={18} />
                  <Text style={styles.bestCity} numberOfLines={1}>{shortCityName(proof.city?.name ?? '')}</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );

  return (
    <>
      <FlatList
        ref={list as React.RefObject<FlatList<typeof rest[number]>>}
        data={rest}
        keyExtractor={i => i.proof.id}
        ListHeaderComponent={headerBlock}
        contentContainerStyle={[styles.listPad, { paddingBottom: 96 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
        ListEmptyComponent={items.length === 0 && (data || failed) ? <Empty text={t('ranks.empty.photos')} failed={failed} /> : null}
        ListFooterComponent={loading ? <ActivityIndicator style={{ marginVertical: 16 }} color={colors.primary} /> : null}
        onEndReached={onEnd}
        onEndReachedThreshold={0.6}
        onScrollToIndexFailed={() => {}}
        initialNumToRender={12}
        windowSize={9}
        renderItem={({ item }) => <PhotoRankRow item={item} mine={me?.proofId === item.proof.id} week={period === 'week'} onPress={() => open(proofs, item.proof)} />}
      />
      {data && <YouBar text={youText} onPress={onYou} />}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}><Confetti run={burst} count={36} /></View>
    </>
  );
}

/**
 * A photo from #4: the big rank, the thumbnail, the challenge (its text and theme), the author
 * (avatar, @handle, flag), and "4 ❤️ · 2 💬" (ties are ranked by comments, then the earliest posted).
 */
const PhotoRankRow = memo(function PhotoRankRow({ item, mine, week, onPress }: { item: PhotosRanks['items'][number]; mine: boolean; week: boolean; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { theme: mode } = useTheme();
  const p = item.proof;
  const theme = p.context?.theme?.key ?? null;
  // The theme's text color, not its fill: the peach ones (Taste, Only here, and the retired themes of
  // older challenges, which fall back to the special day's peach) vanished on their own peach tint.
  const ink = theme ? (mode === 'dark' ? themeColor(theme).textDark : themeColor(theme).textLight) : null;
  const who = p.user.username ? `@${p.user.username}` : p.user.displayName ?? '';
  return (
    <Pressable onPress={onPress} style={[styles.pRow, mine && styles.pRowMine]} accessibilityRole="button"
               accessibilityLabel={`#${item.rank}, ${who}, ${p.voteCount} ❤️, ${p.commentCount ?? 0} 💬`}>
      <View style={styles.pRankBox}>
        <Text style={styles.pRank} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{item.rank}</Text>
        {/* Week: since yesterday (▲2, ▼1, new), when the server sends it. */}
        {week && item.prevRank !== undefined && <Movement rank={item.rank} prevRank={item.prevRank ?? null} show />}
      </View>
      <Image source={{ uri: thumbUrl(p.thumbUrl ?? p.photoUrl) ?? undefined }} style={styles.pThumb} contentFit="cover" />
      <View style={styles.pBody}>
        {!!p.context?.text && <Text style={styles.pTitle} numberOfLines={1}>{p.context.text}</Text>}
        <View style={styles.pMeta}>
          {!!theme && ink && (
            <View style={[styles.pChip, { backgroundColor: tint(ink, 0.14) }]}>
              <ThemeIcon theme={theme} size={11} color={ink} />
              <Text style={styles.pChipText} numberOfLines={1}>{p.context?.theme?.name}</Text>
            </View>
          )}
        </View>
        <View style={styles.pMeta}>
          <Avatar uri={p.user.photoUrl} name={p.user.displayName ?? p.user.username ?? ''} size={18} />
          <Text style={styles.sub} numberOfLines={1}>{who}</Text>
          <FlagSticker country={p.city?.country} size={14} />
        </View>
      </View>
      <View style={styles.pill}><Text style={styles.pillText} numberOfLines={1}>{p.voteCount} ❤️ · {p.commentCount ?? 0} 💬</Text></View>
    </Pressable>
  );
});

// ── Players ─────────────────────────────────────────────────────────────────

function PlayersView({ data, header, failed, refreshing, onRefresh, period, list, onOpen, ghost }: {
  data: PlayersRanks | null; header: React.ReactNode; failed: boolean; refreshing: boolean; onRefresh: () => void; period: RanksPeriod; ghost: PodiumGhost;
  list: React.RefObject<FlatList<unknown> | null>; onOpen: (userId: string) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const entries = data?.entries ?? [];
  const nameOf = (u: { displayName: string | null; username: string | null }) => (u.username ? `@${u.username}` : u.displayName ?? '');
  const pts = (n: number) => t('ranks.pts', { count: n });
  const podium: PodiumItem[] = entries.slice(0, 3).map(e => ({
    key: e.user.id, rank: e.rank, label: nameOf(e.user), value: e.points, format: pts, onPress: () => onOpen(e.user.id),
    lead: <View style={[styles.podiumAvatar, { borderColor: MEDAL[e.rank - 1] }]}><Avatar uri={e.user.photoUrl} name={e.user.displayName ?? e.user.username ?? ''} size={56} /></View>,
  }));
  const me = data?.me ?? null;
  const youText = me
    ? me.rank === 1 ? t('ranks.you.top') : t('ranks.you.player', { rank: me.rank, gap: me.gap ?? 0, name: me.next ? nameOf(me.next) : '' })
    : t('ranks.you.none');
  const rest = entries.slice(3);

  return (
    <>
      <FlatList
        ref={list as React.RefObject<FlatList<typeof rest[number]>>}
        data={rest}
        keyExtractor={e => e.user.id}
        ListHeaderComponent={<View>{header}{entries.length > 0 && <Podium items={podium} ghost={ghost} />}</View>}
        contentContainerStyle={[styles.listPad, { paddingBottom: 96 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
        ListEmptyComponent={entries.length === 0 && (data || failed) ? <Empty text={t('ranks.empty.players')} failed={failed} /> : null}
        onScrollToIndexFailed={() => {}}
        renderItem={({ item: e }) => (
          <View style={styles.rowPad}>
            <RankRow rank={e.rank} title={nameOf(e.user)} value={pts(e.points)} mine={me?.user.id === e.user.id} onPress={() => onOpen(e.user.id)}
                     movement={<Movement rank={e.rank} prevRank={e.prevRank} show={period !== 'today'} />}
                     lead={<Avatar uri={e.user.photoUrl} name={e.user.displayName ?? e.user.username ?? ''} size={40} />}
                     sub={<>
                       {!!e.city && <FlagSticker country={e.city.country} size={14} />}
                       <Text style={[styles.badge, e.user.isLocal ? styles.badgeLocal : styles.badgeTraveler]}>{e.user.isLocal ? t('local') : t('traveler')}</Text>
                     </>} />
          </View>
        )}
      />
      {data && <YouBar text={youText} onPress={() => {
        if (me && me.rank > 3 && me.rank - 4 < rest.length) list.current?.scrollToIndex({ index: me.rank - 4, viewPosition: 0.5 });
      }} />}
    </>
  );
}

// ── Cities ──────────────────────────────────────────────────────────────────

function CitiesView({ data, header, failed, refreshing, onRefresh, period, list, myCityId, ghost }: {
  data: CitiesRanks | null; header: React.ReactNode; failed: boolean; refreshing: boolean; onRefresh: () => void; period: RanksPeriod; ghost: PodiumGhost;
  list: React.RefObject<FlatList<unknown> | null>; myCityId: number | null;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const entries = data?.entries ?? [];
  const leader = entries[0]?.photos ?? 1;
  const mine = data?.mine ?? null;
  const name = (c: { name: string }) => shortCityName(c.name);
  const openCity = (c: { id: number; country: string | null }) => {
    if (period === 'today') router.push(`/daily/stories?city=${c.id}&source=ranks` as never);
    else router.push(`/daily/countries?country=${c.country ?? ''}&source=ranks` as never);
  };
  const line = mine
    ? mine.rank === 1 ? t('ranks.city.lineTop', { city: name(mine.city) })
      : t('ranks.city.line', { city: name(mine.city), rank: mine.rank, count: mine.gap ?? 1, next: mine.next ? shortCityName(mine.next.name) : '' })
    : null;
  const podium: PodiumItem[] = entries.slice(0, 3).map(e => ({
    key: String(e.city.id), rank: e.rank, label: name(e.city), value: e.photos, format: n => t('today.proofs', { count: n }),
    lead: <FlagSticker country={e.city.country} size={52} />, onPress: () => openCity(e.city),
  }));
  const color = themeColor('sip').fill;

  return (
    <>
      <FlatList
        ref={list as React.RefObject<FlatList<typeof entries[number]>>}
        data={entries}
        keyExtractor={e => String(e.city.id)}
        ListHeaderComponent={(
          <View>
            {header}
            {!!line && (
              <View style={styles.funLine}>
                {!!mine && <FlagSticker country={mine.city.country} size={22} />}
                <Text style={styles.funText}>{line}</Text>
              </View>
            )}
            {entries.length > 0 && <Podium items={podium} ghost={ghost} />}
          </View>
        )}
        contentContainerStyle={[styles.listPad, { paddingBottom: 96 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
        ListEmptyComponent={data || failed ? <Empty text={t('ranks.empty.cities')} failed={failed} /> : null}
        onScrollToIndexFailed={() => {}}
        renderItem={({ item: e, index }) => (
          <View style={styles.rowPad}>
            <RankRow rank={e.rank} title={name(e.city)} value={t('today.proofs', { count: e.photos })} mine={e.city.id === myCityId}
                     onPress={() => openCity(e.city)}
                     movement={<Movement rank={e.rank} prevRank={e.prevRank} show={period !== 'today'} />}
                     lead={<FlagSticker country={e.city.country} size={34} />}
                     sub={<Text style={styles.sub}>{t('mosaic.players', { count: e.players })} · {e.likes} ❤️</Text>}
                     extra={<RaceBar ratio={e.photos / Math.max(1, leader)} color={e.city.id === myCityId ? colors.cta : color} delay={Math.min(index, 8) * 60} />} />
          </View>
        )}
      />
      {mine && (
        <YouBar text={mine.rank === 1 ? t('ranks.city.lineTop', { city: name(mine.city) })
          : t('ranks.city.youBar', { city: name(mine.city), rank: mine.rank, count: mine.gap ?? 1, next: mine.next ? shortCityName(mine.next.name) : '' })}
                onPress={() => list.current?.scrollToIndex({ index: Math.max(0, mine.rank - 1), viewPosition: 0.5 })} />
      )}
    </>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container:    { flex: 1, backgroundColor: c.bg },
  header:       { paddingHorizontal: Spacing.md, backgroundColor: c.bg },
  flex:         { flex: 1 },
  controls:     { paddingHorizontal: Spacing.md, paddingTop: 6, gap: 10 },
  periods:      { flexDirection: 'row', gap: 6 },
  infoRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 34, paddingBottom: 4 },
  info:         { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 18, fontWeight: '800', color: c.text },
  chip:         { flex: 1, minWidth: 0, alignItems: 'center', height: 36, paddingHorizontal: 6, borderRadius: Radius.full, borderWidth: 1.5, borderColor: c.line, backgroundColor: c.bg2, justifyContent: 'center' },
  chipOn:       { backgroundColor: themeColor('sip').fill, borderColor: themeColor('sip').fill },
  chipText:     { fontSize: 14, lineHeight: 18, fontWeight: '800', color: c.text },
  chipTextOn:   { color: themeColor('sip').onFill },
  listPad:      { paddingBottom: 32 },
  rowPad:       { paddingHorizontal: Spacing.md - 4 },
  podiumPhoto:  { width: 72, height: 72, borderRadius: 16, borderWidth: 3, backgroundColor: c.bg3 },
  podiumAvatar: { borderRadius: 32, borderWidth: 3, padding: 1 },
  sub:          { fontSize: 13, lineHeight: 17, color: c.muted, flexShrink: 1 },
  badge:        { fontSize: 11, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, overflow: 'hidden' },
  badgeLocal:   { backgroundColor: tint('#1FB5A8', 0.2), color: c.localText },
  badgeTraveler: { backgroundColor: tint('#3D9BF0', 0.2), color: c.text },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: c.text, marginBottom: 8 },
  cityBest:     { paddingHorizontal: Spacing.md, paddingTop: 12 },
  bestCard:     { width: 112, borderRadius: Radius.card, overflow: 'hidden', backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line },
  bestPhoto:    { width: 112, height: 112, backgroundColor: c.bg3 },
  bestFoot:     { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6 },
  bestCity:     { flex: 1, fontSize: 12, fontWeight: '800', color: c.text },
  pRow:         { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 12, borderRadius: Radius.card },
  pRowMine:     { backgroundColor: c.primaryTint },
  pRankBox:     { width: 40, alignItems: 'center', gap: 1 },
  pRank:        { width: 40, fontSize: 24, lineHeight: 30, fontWeight: '900', color: c.text, textAlign: 'center' },
  pThumb:       { width: 52, height: 52, borderRadius: 12, backgroundColor: c.bg3 },
  pBody:        { flex: 1, minWidth: 0, gap: 3 },
  pTitle:       { fontSize: 14, lineHeight: 18, fontWeight: '800', color: c.text },
  pMeta:        { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 },
  pChip:        { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, height: 18, borderRadius: 9, maxWidth: '100%' },
  pChipText:    { fontSize: 11, lineHeight: 14, fontWeight: '800', color: c.text, flexShrink: 1 },
  pill:         { paddingHorizontal: 8, height: 26, borderRadius: 13, backgroundColor: tint('#FFC93C', 0.25), alignItems: 'center', justifyContent: 'center' },
  pillText:     { fontSize: 12, fontWeight: '800', color: c.text },
  funLine:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: Spacing.md, marginTop: 10, padding: 12,
                  borderRadius: Radius.card, backgroundColor: tint(themeColor('sip').fill, 0.2) },
  funText:      { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: '800', color: c.text },
  empty:        { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 40, gap: 12 },
  emptyEmoji:   { fontSize: 44 },
  emptyText:    { fontSize: 16, lineHeight: 22, fontWeight: '700', color: c.text, textAlign: 'center' },
});
