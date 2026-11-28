import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, Text, TextInput, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Space, Gutter, Radius, Type, Border, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { Button, Chip, CityFlag, EmptyState, ScreenHeader, Tappable } from '@/ui';
import { fetchMembers, fetchMembersSummary, type Member, type MemberCity, type MemberFilter, type MembersScope, type MembersSummary } from '@/api/members';
import { submitBlock } from '@/api/blocks';
import { countryToFlag } from '@/lib/countryFlag';
import { shortCityName } from '@/i18n/cityName';
import { track } from '@/services/analytics';
import { MemberRow } from '@/features/members/MemberRow';
import { CityStrip, HereNowRow, JustLandedRow, MembersSection, Spotlight } from '@/features/members/MembersSections';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSeedWaves } from '@/features/members/wave';
import { ProfileActionSheet } from '@/features/profile/ProfileActionSheet';
import { ReportModal } from '@/features/profile/ReportModal';

// New second: visible without scrolling the chips.
const CITY_FILTERS: MemberFilter[] = ['all', 'new', 'here', 'locals', 'travelers', 'friends'];

/**
 * Members (docs/mockups/hilads_members_mockup.html), opened from the members line of the Hi
 * header: a city's crew (?scope=city&cityId=N) or the whole World (?scope=world). Who is here
 * now, the week's spotlight, everyone (filter chips, search, paged), a wave for each; the
 * World adds its cities strip and a searchable list of every city (members/cities).
 */
export default function MembersScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('members');
  const router = useRouter();
  const { account, identity, city: myCity, addBlocked, removeBlocked } = useApp();
  const params = useLocalSearchParams<{ scope?: string; cityId?: string; name?: string; country?: string; filterCity?: string }>();
  const world = params.scope === 'world';
  const cityId = world ? null : String(params.cityId ?? myCity?.channelId ?? '');
  const cityName = shortCityName(params.name ?? (String(myCity?.channelId) === cityId ? myCity?.name : '') ?? '');
  const country = params.country ?? (String(myCity?.channelId) === cityId ? myCity?.country : null) ?? null;

  const [worldCity, setWorldCity] = useState<number | null>(params.filterCity ? Number(params.filterCity) : null);
  // A city picked in "See all" comes back as ?filterCity.
  useEffect(() => { if (params.filterCity) setWorldCity(Number(params.filterCity)); }, [params.filterCity]);
  const scope: MembersScope = useMemo(() => (world ? { scope: 'world', cityId: worldCity } : { scope: 'city', cityId: cityId ?? '' }), [world, worldCity, cityId]);
  const [summary, setSummary] = useState<MembersSummary | null>(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [filter, setFilter] = useState<MemberFilter>('all');
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');   // debounced
  const [rows, setRows] = useState<Member[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [menuFor, setMenuFor] = useState<Member | null>(null);
  const [reportFor, setReportFor] = useState<Member | null>(null);
  const req = useRef(0);
  useSeedWaves(rows);
  useSeedWaves(summary?.hereNow);

  useEffect(() => { track('members_viewed', { scope: world ? 'world' : 'city' }); }, [world]);

  // "You're new here: say hi to your city 👋": a newcomer's first visit only.
  const [newcomerLine, setNewcomerLine] = useState(false);
  useEffect(() => {
    if (!summary?.me?.isNew) return;
    AsyncStorage.getItem('hilads_members_newcomer_seen').then(v => {
      if (v) return;
      setNewcomerLine(true);
      AsyncStorage.setItem('hilads_members_newcomer_seen', '1').catch(() => {});
    }).catch(() => {});
  }, [summary?.me?.isNew]);

  // The summary: the whole scope (the World's strip stays on "All" counts).
  const loadSummary = useCallback(() => {
    setSummaryFailed(false);
    return fetchMembersSummary(world ? { scope: 'world' } : { scope: 'city', cityId: cityId ?? '' })
      .then(setSummary).catch(() => setSummaryFailed(true));
  }, [world, cityId]);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  // Debounced search: results as you type.
  useEffect(() => {
    const id = setTimeout(() => setQ(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);
  useEffect(() => { if (q) track('members_search', { scope: world ? 'world' : 'city', length: q.length }); }, [q, world]);

  const load = useCallback(async (more = false) => {
    const n = ++req.current;
    if (!more) { setFailed(false); }
    try {
      const r = await fetchMembers(scope, { filter, q, offset: more ? next ?? 0 : 0 });
      if (n !== req.current) return;
      setRows(prev => (more && prev ? [...prev, ...r.members.filter(m => !prev.some(p => p.id === m.id))] : r.members));
      setNext(r.nextOffset);
    } catch {
      if (n === req.current && !more) { setFailed(true); setRows(r => r ?? []); }
    } finally {
      if (n === req.current) setLoadingMore(false);
    }
  }, [scope, filter, q, next]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setRows(null); setNext(null); load(false); }, [scope, filter, q]);

  const onRefresh = async () => { setRefreshing(true); await Promise.all([loadSummary(), load(false)]); setRefreshing(false); };
  const onEnd = () => { if (next !== null && !loadingMore && rows) { setLoadingMore(true); load(true); } };

  const openProfile = useCallback((u: { id: string; displayName: string }) => {
    router.push({ pathname: '/user/[id]', params: { id: u.id, name: u.displayName } } as never);
  }, [router]);
  const pickFilter = (f: MemberFilter) => { setFilter(f); track('members_filter', { filter: f, scope: world ? 'world' : 'city' }); };
  const pickCity = (id: number | null) => { setWorldCity(id); if (id !== null) track('members_city_filter', { cityId: id }); };
  const openCity = (c: MemberCity) => { if (world) pickCity(c.id); };

  const block = (m: Member) => {
    addBlocked({ userId: m.id });
    setRows(r => r?.filter(x => x.id !== m.id) ?? r);
    setSummary(s => (s ? { ...s, hereNow: s.hereNow.filter(x => x.id !== m.id) } : s));
    submitBlock({ targetUserId: m.id, targetNickname: m.displayName, guestId: account ? undefined : identity?.guestId })
      .catch(() => removeBlocked({ userId: m.id }));
  };

  // ── Header ───────────────────────────────────────────────────────────────
  const title = world ? t('titleWorld') : t('titleCity', { city: cityName, flag: countryToFlag(country) }).trim();
  const counts = summary?.counts;
  const live = counts ? [
    counts.here > 0 ? t('hereCount', { count: counts.here }) : null,
    t('memberCount', { count: counts.members }),
    world && counts.cities ? t('cityCount', { count: counts.cities }) : null,
  ].filter(Boolean).join(' · ') : '';
  const filters = CITY_FILTERS.filter(f => f !== 'friends' || !!account);
  const searching = q.length > 0;
  const cityMatches = world && searching && summary?.cities
    ? summary.cities.filter(c => c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];
  const selectedCityName = worldCity !== null ? summary?.cities?.find(c => c.id === worldCity)?.name : null;

  const header = (
    <View>
      {/* A newcomer's first visit to this screen, and an account with no city yet (they pick one). */}
      {!searching && newcomerLine && (
        <View style={styles.note}><Text style={styles.noteText}>{t('newcomer')}</Text></View>
      )}
      {!searching && summary?.me && !summary.me.hasCity && (
        <Tappable style={[styles.note, styles.noteAction]} onPress={() => router.push('/switch-city' as never)} accessibilityRole="button">
          <Text style={styles.noteText}>{t('pickCity')}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primaryOnTint} />
        </Tappable>
      )}
      {!searching && world && !!summary?.cities?.length && (
        <>
          <MembersSection title={t('cities')} aside={t('seeAll', { count: summary.cities.length })}
                          onAside={() => router.push({ pathname: '/members/cities' } as never)} />
          <CityStrip total={summary.counts.members} cities={summary.cities} selected={worldCity} onSelect={pickCity} />
        </>
      )}
      {!searching && !world && !!summary?.hereNow.length && (
        <>
          <MembersSection title={t('hereNow')} />
          <HereNowRow people={summary.hereNow} meId={account?.id} onOpen={openProfile} />
        </>
      )}
      {!searching && !!summary?.spotlight.length && worldCity === null && (
        <>
          <MembersSection title={t('spotlight')} aside={t('thisWeek')} />
          <Spotlight cards={summary.spotlight} onUser={openProfile} onCity={openCity} />
        </>
      )}
      {!searching && worldCity === null && !!summary?.justLanded?.length && (
        <>
          <MembersSection title={t('landed.title')} />
          <JustLandedRow people={summary.justLanded} world={world} meId={account?.id} onOpen={openProfile} />
        </>
      )}
      {!!cityMatches.length && (
        <>
          <MembersSection title={t('cities')} />
          <View style={styles.cityResults}>
            {cityMatches.map(c => (
              <Tappable key={c.id} style={styles.cityResult} onPress={() => { setQuery(''); pickCity(c.id); }} accessibilityRole="button"
                        accessibilityLabel={t('cityA11y', { city: c.name, count: c.members })}>
                <CityFlag country={c.country} size={16} />
                <Text style={styles.cityResultName}>{c.name}</Text>
                <Text style={styles.cityResultCount}>{t('memberCount', { count: c.members })}</Text>
              </Tappable>
            ))}
          </View>
        </>
      )}
      <MembersSection title={searching ? t('results') : selectedCityName ? t('crewOf', { city: selectedCityName }) : t('everyone')}
                      aside={selectedCityName ? t('clearCity') : undefined} onAside={selectedCityName ? () => pickCity(null) : undefined} />
      {!searching && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {filters.map(f => <Chip key={f} variant="filter" label={t(`filter.${f}`)} selected={filter === f} onPress={() => pickFilter(f)} />)}
        </ScrollView>
      )}
    </View>
  );

  const empty = rows === null ? (
    <View style={styles.skeletons} accessibilityLabel={t('loading')}>
      {[0, 1, 2, 3].map(i => <View key={i} style={styles.skeleton} />)}
    </View>
  ) : failed ? (
    <EmptyState icon="cloud-offline-outline" title={t('errorTitle')} body={t('errorBody')}
                action={<Button variant="secondary" label={t('retry')} onPress={() => load(false)} />} />
  ) : searching ? (
    <EmptyState icon="search-outline" body={t('noResults', { q })} />
  ) : filter !== 'all' ? (
    <EmptyState icon="people-outline" body={t(`emptyFilter.${filter}`)} />
  ) : (
    <EmptyState icon="people-outline" title={t('emptyTitle')} body={world ? t('emptyWorld') : t('emptyCity', { city: cityName })} />
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title={title} testID="members-screen" />
      <View style={styles.top}>
        {!!live && (
          <View style={styles.liveLine} accessibilityLabel={live}>
            {(counts?.here ?? 0) > 0 && <View style={styles.liveDot} />}
            <Text style={styles.liveText} numberOfLines={1}>{live}</Text>
          </View>
        )}
        {summaryFailed && !summary && <Text style={styles.liveText}>{t('errorBody')}</Text>}
        <View style={styles.search}>
          <Ionicons name="search-outline" size={18} color={colors.muted} />
          <TextInput value={query} onChangeText={setQuery} placeholder={world ? t('searchWorld') : t('searchCity')} placeholderTextColor={colors.muted}
                     style={styles.searchInput} autoCorrect={false} autoCapitalize="none" returnKeyType="search" clearButtonMode="while-editing"
                     accessibilityLabel={world ? t('searchWorld') : t('searchCity')} testID="members-search" />
          {!!query && (
            <Tappable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('clearSearch')}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Tappable>
          )}
        </View>
      </View>
      <FlatList
        data={rows ?? []}
        keyExtractor={m => m.id}
        renderItem={({ item }) => <MemberRow member={item} world={world && worldCity === null} onPress={openProfile} onLongPress={setMenuFor} />}
        ItemSeparatorComponent={() => <View style={{ height: Space.sm }} />}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} style={styles.more} /> : <View style={styles.more} />}
        contentContainerStyle={styles.list}
        onEndReached={onEnd}
        onEndReachedThreshold={0.6}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={12}
        windowSize={9}
        removeClippedSubviews
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      />

      <ProfileActionSheet visible={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor?.displayName} actions={menuFor ? [
        { key: 'profile', label: t('viewProfile'), icon: 'person-outline', onPress: () => { const m = menuFor; setMenuFor(null); openProfile(m); } },
        { key: 'report', label: t('report'), icon: 'flag-outline', onPress: () => { setReportFor(menuFor); setMenuFor(null); } },
        { key: 'block', label: t('block'), icon: 'ban-outline', destructive: true, onPress: () => { const m = menuFor; setMenuFor(null); block(m); } },
      ] : []} />
      {reportFor && (
        <ReportModal visible reporterGuestId={identity?.guestId} targetUserId={reportFor.id} targetNickname={reportFor.displayName}
                     onClose={() => setReportFor(null)} />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container:   { flex: 1, backgroundColor: c.bg },
  top:         { paddingHorizontal: Gutter, gap: Space.md, paddingBottom: Space.xs },
  liveLine:    { flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginTop: -Space.xs },
  liveDot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: c.green },
  liveText:    { ...Type.caption, color: c.muted, flexShrink: 1 },
  search:      { flexDirection: 'row', alignItems: 'center', gap: Space.sm, height: 44, paddingHorizontal: Space.md,
                 borderRadius: Radius.control, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  searchInput: { flex: 1, ...Type.body, color: c.text, paddingVertical: 0 },
  list:        { paddingHorizontal: Gutter, paddingBottom: Space.xxl },
  chips:       { gap: Space.sm, paddingBottom: Space.md, paddingRight: Space.lg },
  cityResults: { gap: Space.xs },
  cityResult:  { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 48, paddingHorizontal: Space.md,
                 borderRadius: Radius.card, backgroundColor: c.bg2 },
  cityResultName:  { ...Type.label, fontSize: 15, color: c.text, flex: 1 },
  cityResultCount: { ...Type.caption, color: c.muted },
  note:        { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginTop: Space.md, padding: Space.md,
                 borderRadius: Radius.card, backgroundColor: c.primaryTint },
  noteAction:  { justifyContent: 'space-between' },
  noteText:    { ...Type.body, fontWeight: '700', color: c.primaryOnTint, flexShrink: 1 },
  skeletons:   { gap: Space.sm },
  skeleton:    { height: 64, borderRadius: Radius.card, backgroundColor: c.bg3 },
  more:        { height: Space.xxl, marginTop: Space.md },
});
