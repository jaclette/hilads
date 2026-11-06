import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, Text, View, StyleSheet, useWindowDimensions } from 'react-native';
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
import { Avatar, Segmented } from '@/ui';
import { FlagSticker, themeColor, tint } from '@/ui/joy';
import { shortCityName } from '@/i18n/cityName';
import { thumbUrl } from '@/lib/imageThumb';
import { handOffList } from '@/lib/prefetch';
import { canAccessProfile } from '@/lib/profileAccess';
import { track } from '@/services/analytics';
import {
  fetchRanks, type CitiesRanks, type PhotosRanks, type PlayersRanks, type RanksPeriod, type RanksScope, type RanksTab,
} from '@/api/ranks';
import type { DailyProof } from '@/types';
import { MEDAL, MEDAL_EMOJI, Movement, Podium, RaceBar, RankRow, ScopeToggle, YouBar, type PodiumGhost, type PodiumItem } from '@/features/ranks/parts';

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
  const params = useLocalSearchParams<{ tab?: string; period?: string; scope?: string; cityId?: string }>();
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
  const data = resp?.key === key ? resp.data : null;

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
  const ghost: PodiumGhost = {
    label: t(tab === 'photos' ? 'ranks.ghost.photo' : tab === 'players' ? 'ranks.ghost.player' : 'ranks.ghost.city'),
    onPress: () => {
      Haptics.selectionAsync().catch(() => {});
      track('ranks_ghost_tapped', { tab, period });
      if (tab === 'photos' && period === 'today') router.push((account ? '/daily/proof' : '/auth-gate?reason=daily_proof&returnTo=%2Fdaily%2Fproof') as never);
      else router.navigate('/(tabs)/today' as never);
    },
  };

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
        {tab === 'photos' && <PhotosView data={data as PhotosRanks | null} header={header} failed={failed} refreshing={refreshing} onRefresh={onRefresh} period={period} ghost={ghost} />}
        {tab === 'players' && <PlayersView data={data as PlayersRanks | null} header={header} failed={failed} refreshing={refreshing} onRefresh={onRefresh} ghost={ghost}
                                           period={period} list={list} onOpen={id => { if (canAccessProfile(account)) router.push(`/user/${id}` as never); }} />}
        {tab === 'cities' && <CitiesView data={data as CitiesRanks | null} header={header} failed={failed} refreshing={refreshing} onRefresh={onRefresh} ghost={ghost}
                                         period={period} list={list} myCityId={cityId} />}
      </View>
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

function PhotosView({ data, header, failed, refreshing, onRefresh, period, ghost }: {
  data: PhotosRanks | null; header: React.ReactNode; failed: boolean; refreshing: boolean; onRefresh: () => void; period: RanksPeriod; ghost: PodiumGhost;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const { width } = useWindowDimensions();
  const open = useOpenPhoto();
  const items = data?.items ?? [];
  const proofs = items.map(i => i.proof);
  const grid = period === 'week' || period === 'alltime';
  const tile = (width - Spacing.md * 2 - 16) / 3;

  const podium: PodiumItem[] = items.slice(0, 3).map(i => ({
    key: i.proof.id, rank: i.rank, label: i.proof.user.username ? `@${i.proof.user.username}` : i.proof.user.displayName ?? '',
    lead: <Image source={{ uri: thumbUrl(i.proof.thumbUrl ?? i.proof.photoUrl) ?? undefined }} style={[styles.podiumPhoto, { borderColor: MEDAL[i.rank - 1] }]} contentFit="cover" />,
    value: i.proof.voteCount, format: n => `${n} ❤️`, onPress: () => open(proofs, i.proof),
  }));

  const top = (
    <View>
      {header}
      {items.length > 0 && !grid && <Podium items={podium} ghost={ghost} />}
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

  if (grid) {
    return (
      <FlatList
        key="grid"
        data={items}
        numColumns={3}
        keyExtractor={i => i.proof.id}
        ListHeaderComponent={top}
        columnWrapperStyle={{ gap: 8, paddingHorizontal: Spacing.md }}
        contentContainerStyle={styles.listPad}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
        ListEmptyComponent={data || failed ? <Empty text={t('ranks.empty.photos')} failed={failed} /> : null}
        renderItem={({ item }) => (
          <Pressable onPress={() => open(proofs, item.proof)} style={{ width: tile, marginBottom: 8 }} accessibilityRole="button"
                     accessibilityLabel={`#${item.rank}, ${item.proof.voteCount} ❤️`}>
            <Image source={{ uri: thumbUrl(item.proof.thumbUrl ?? item.proof.photoUrl) ?? undefined }} style={[styles.hof, { width: tile, height: tile }]} contentFit="cover" />
            {item.rank <= 3 && <Text style={styles.hofMedal}>{MEDAL_EMOJI[item.rank - 1]}</Text>}
            <View style={styles.hofLikes}><Text style={styles.hofLikesText}>{item.proof.voteCount} ❤️</Text></View>
          </Pressable>
        )}
      />
    );
  }

  return (
    <FlatList
      key="list"
      data={items.slice(3)}
      keyExtractor={i => i.proof.id}
      ListHeaderComponent={top}
      contentContainerStyle={styles.listPad}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
      ListEmptyComponent={items.length === 0 && (data || failed) ? <Empty text={t('ranks.empty.photos')} failed={failed} /> : null}
      renderItem={({ item }) => (
        <View style={styles.rowPad}>
          <RankRow rank={item.rank} value={`${item.proof.voteCount} ❤️`} onPress={() => open(proofs, item.proof)}
                   lead={<Image source={{ uri: thumbUrl(item.proof.thumbUrl ?? item.proof.photoUrl) ?? undefined }} style={styles.rowPhoto} contentFit="cover" />}
                   title={item.proof.user.username ? `@${item.proof.user.username}` : item.proof.user.displayName ?? ''}
                   sub={<><FlagSticker country={item.proof.city?.country} size={14} /><Text style={styles.sub} numberOfLines={1}>{shortCityName(item.proof.city?.name ?? '')}</Text></>} />
        </View>
      )}
    />
  );
}

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
  rowPhoto:     { width: 44, height: 44, borderRadius: 10, backgroundColor: c.bg3 },
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
  hof:          { borderRadius: 12, backgroundColor: c.bg3 },
  hofMedal:     { position: 'absolute', top: 4, left: 6, fontSize: 22 },
  hofLikes:     { position: 'absolute', right: 6, bottom: 6, paddingHorizontal: 6, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center' },
  hofLikesText: { fontSize: 11, fontWeight: '800', color: '#FFFFFF' },
  funLine:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: Spacing.md, marginTop: 10, padding: 12,
                  borderRadius: Radius.card, backgroundColor: tint(themeColor('sip').fill, 0.2) },
  funText:      { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: '800', color: c.text },
  empty:        { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 40, gap: 12 },
  emptyEmoji:   { fontSize: 44 },
  emptyText:    { fontSize: 16, lineHeight: 22, fontWeight: '700', color: c.text, textAlign: 'center' },
});
