import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, SectionList, Text, View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { fetchDailyProof, fetchDailyProofsByIds, fetchDailyTodayCountries } from '@/api/daily';
import { shortCityName } from '@/i18n/cityName';
import { answerText } from '@/features/compare/format';
import { DailyProofTile } from '@/features/daily/DailyProofTile';
import { compareCountryGroups, rankCountryProofs } from '@/features/daily/countryOrder';
import { seedProofs } from '@/features/daily/votes';
import { lastCountries } from '@/features/today/TodayCountries';
import { getLastToday, useCountdown, useDailySheet, useHere } from '@/hooks/useDaily';
import { track } from '@/services/analytics';
import { Button, EmptyState, Screen, ScreenHeader, Segmented } from '@/ui';
import { DailyLeaderboardPanel } from '@/features/daily/DailyLeaderboardPanel';
import { DailyProofViewer } from '@/features/daily/DailyProofViewer';
import { FlagSticker } from '@/ui/joy';
import type { DailyCountryGroup, DailyProof, DailyTodayCountries } from '@/types';

/** The server lists at most 50 proofs per call. */
const BATCH = 50;

type Section = { group: DailyCountryGroup; data: DailyProof[][] };

/**
 * Same challenge. Different worlds. (Today's mosaic → "See all"): every
 * country that played today, one section each (flag, city, top answer,
 * photo count) with all its photos in a 2-column grid (light cards).
 * Countries in the mosaic's order (top photo's votes, then photos, then the
 * most recent), my country first; a country's photos best first, its mosaic
 * tile's photo leading (rankCountryProofs). A photo opens Today's photos
 * on it. Back returns to Today where it was.
 */
export default function CountriesScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const router = useRouter();
  const { source, date: dateParam, country, sort: sortParam } = useLocalSearchParams<{ source?: string; date?: string; country?: string; sort?: string }>();
  const lastToday = getLastToday();
  // A past day (the challenge screen of that day), else today.
  const date = dateParam && dateParam !== lastToday?.challenge?.date ? dateParam : null;
  const [sort, setSort] = useState<'country' | 'top10'>(sortParam === 'top10' ? 'top10' : 'country');
  const [viewing, setViewing] = useState<DailyProof | null>(null);
  const list = useRef<SectionList<DailyProof[], Section>>(null);
  const { account, identity } = useApp();
  const guestId = account ? null : identity?.guestId ?? null;
  const here = useHere();
  const [data, setData] = useState<DailyTodayCountries | null>(date ? null : lastCountries());
  const [proofs, setProofs] = useState<Map<string, DailyProof> | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const next = await fetchDailyTodayCountries({ date, cityId: here?.id ?? getLastToday()?.city?.id ?? null, guestId });
      setData(next);
      const ids = next.items.flatMap(g => g.ids);
      const chunks = Array.from({ length: Math.ceil(ids.length / BATCH) }, (_, i) => ids.slice(i * BATCH, (i + 1) * BATCH));
      const lists = await Promise.all(chunks.map(c => fetchDailyProofsByIds(c, guestId)));
      const all = lists.flat();
      seedProofs(all, !date && !!getLastToday()?.challenge?.isActive);
      setProofs(new Map(all.map(p => [p.id, p])));
    } catch {
      setFailed(true);
    }
  }, [here?.id, guestId, date]);
  useEffect(() => { track('today_countries_all', { source: source ?? 'today', past: !!date, sort }); load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sections: Section[] = useMemo(() => {
    if (!data || !proofs) return [];
    // My country: where I am, else the city Today shows (like the mosaic).
    const mine = (here?.country ?? getLastToday()?.city?.country ?? '').toUpperCase();
    const ordered = [...data.items].sort((a, b) => compareCountryGroups(a, b, mine));
    return ordered.flatMap(g => {
      // Best first, the mosaic tile's photo leading (one shared order).
      const list = rankCountryProofs(g.ids.map(id => proofs.get(id)).filter((p): p is DailyProof => !!p), g.top.id);
      if (list.length === 0) return [];
      const rows: DailyProof[][] = [];
      for (let i = 0; i < list.length; i += 2) rows.push(list.slice(i, i + 2));
      return [{ group: g, data: rows }];
    });
  }, [data, proofs, here?.country]);

  // Today: Today's photos on it; a past day: the photo on its own.
  const open = (p: DailyProof) => (date ? setViewing(p) : router.push(`/daily/photos?proof=${p.id}&source=today_all` as never));

  // ?country=XX (a bubble of the challenge screen): that country's section, once.
  const scrolled = useRef(false);
  const target = useRef<number | null>(null);
  const retries = useRef(0);
  useEffect(() => {
    if (!country || scrolled.current || sort !== 'country' || sections.length === 0) return;
    const at = sections.findIndex(s => s.group.country === country.toUpperCase());
    scrolled.current = true;
    if (at > 0) {
      target.current = at;
      setTimeout(() => list.current?.scrollToLocation({ sectionIndex: at, itemIndex: 0, viewOffset: 64, animated: false }), 50);
    }
  }, [sections, country, sort]);

  return (
    <Screen>
      <ScreenHeader title={t('worlds.tagline')} testID="countries-screen" />
      <View style={styles.switch}>
        <Segmented options={[{ key: 'country', label: t('countries.byCountry') }, { key: 'top10', label: t('leaderboard.tab') }]}
                   value={sort} onChange={k => { setSort(k); track('today_countries_sort', { sort: k }); }} />
      </View>
      {sort === 'top10' ? (
        <TopTen date={data?.date ?? date ?? lastToday?.challenge?.date ?? null} onOpen={open} />
      ) : failed ? (
        <View style={styles.center}>
          <EmptyState icon="cloud-offline-outline" body={t('loadFailed')}
                      action={<Button variant="secondary" size="sm" label={t('retry')} onPress={load} />} />
        </View>
      ) : !proofs ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <SectionList
          ref={list}
          sections={sections}
          // Rows not measured yet: retry once they are (the list has no fixed row height).
          onScrollToIndexFailed={() => {
            const at = target.current;
            retries.current += 1;
            if (at !== null && retries.current <= 8) setTimeout(() => list.current?.scrollToLocation({ sectionIndex: at, itemIndex: 0, viewOffset: 64, animated: false }), 250);
          }}
          keyExtractor={row => row.map(p => p.id).join('|')}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section: { group } }) => {
            const top = group.top;
            const answer = top.answer && !top.backHome ? answerText(top.answer, i18n.language) : null;
            return (
              <View style={styles.head}>
                <FlagSticker country={group.country} size={24} />
                <View style={styles.headBody}>
                  <Text style={styles.city} numberOfLines={1}>
                    {shortCityName(group.city.name)}{answer ? <Text style={styles.answer}>{` · ${answer}`}</Text> : null}
                  </Text>
                  <Text style={styles.count}>{t('today.proofs', { count: group.count })}</Text>
                </View>
              </View>
            );
          }}
          renderItem={({ item: row, section: { group } }) => (
            <View style={styles.row}>
              {row.map(p => (
                <DailyProofTile key={p.id} proof={p} onPress={() => open(p)} compact
                                mainAnswer={group.top.answer && !group.top.backHome ? answerText(group.top.answer, i18n.language) : null} />
              ))}
              {row.length === 1 && <View style={styles.filler} />}
            </View>
          )}
          ListEmptyComponent={<EmptyState icon="camera-outline" title={t('beFirst')} body={t('beFirstSub')} />}
        />
      )}
      <DailyProofViewer proof={viewing} challenge={null} onClose={() => setViewing(null)} />
    </Screen>
  );
}

/**
 * Top 10 (the challenge screen's old tab): the live leaderboard while the
 * challenge is open, the official podium once closed (DailyLeaderboardPanel).
 */
function TopTen({ date, onOpen }: { date: string | null; onOpen: (p: DailyProof) => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { city } = useApp();
  const { sheet } = useDailySheet(date ?? 'none', 'world', city?.channelId);
  const secondsLeft = useCountdown(sheet?.challenge?.isActive ? sheet.challenge.endsAt : null, sheet?.serverTime);
  if (!sheet) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  const known = [...sheet.proofs, ...(sheet.results?.world ?? []), ...(sheet.results?.cities ?? [])];
  return (
    <ScrollView contentContainerStyle={styles.list}>
      <DailyLeaderboardPanel sheet={sheet} secondsLeft={secondsLeft} source="see_all"
                             onOpenProof={id => { const p = known.find(x => x.id === id); if (p) onOpen(p); else fetchDailyProof(id).then(onOpen).catch(() => {}); }} />
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  center:   { flex: 1, alignItems: 'center', justifyContent: 'center' },
  switch:   { paddingHorizontal: Spacing.md, paddingTop: 4 },
  list:     { padding: Spacing.md, paddingBottom: Spacing.xl },
  head:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 18, paddingBottom: 10 },
  headBody: { flex: 1 },
  city:     { fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  answer:   { color: c.primaryText },
  count:    { fontSize: 13, fontWeight: '600', color: c.muted, marginTop: 1 },
  row:      { flexDirection: 'row', gap: 12, marginBottom: 12 },
  filler:   { flex: 1 },
});
