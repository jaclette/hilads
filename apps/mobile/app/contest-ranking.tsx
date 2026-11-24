import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Space, Gutter, type ThemeColors, Type } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { Card, Screen, ScreenHeader, Segmented } from '@/ui';
import { contestDate, fetchContest, fetchContestRanking, type ContestOverview, type ContestRanking } from '@/features/contest/contest';
import { Podium, RankRow } from '@/features/contest/RankingParts';
import { track } from '@/services/analytics';

/**
 * The Launch Season's full ranking (from the home's preview): Season / Final week, the podium,
 * everyone after it, and my row pinned at the bottom of the screen. Its own ranking, never the
 * Ranks tab's.
 */
export default function ContestRankingScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { t, i18n } = useTranslation('me');
  const { account } = useApp();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<'season' | 'final'>(params.tab === 'final' ? 'final' : 'season');
  const [data, setData] = useState<ContestOverview | null>(null);
  const [ranking, setRanking] = useState<ContestRanking | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback((k: 'season' | 'final') => {
    setRanking(null);
    setFailed(false);
    fetchContestRanking(k).then(setRanking).catch(() => setFailed(true));
  }, []);
  useFocusEffect(useCallback(() => {
    fetchContest(i18n.language).then(setData).catch(() => {});
    load(tab);
    track('contest_ranking_viewed', { tab });
  }, [load, tab, i18n.language]));

  const back = () => (router.canGoBack() ? router.back() : router.replace('/contest' as never));
  const s = data?.season;
  const mine = ranking?.me ?? null;
  // The head start a row brings into the final week: in the season, the one its rank would earn
  // (top N with points: N for #1 … 1 for #N); in the final week, the one it has.
  const topN = s?.rules.headstartTopN ?? 0;
  const bonusFor = (row: { rank: number; points: number; headstart: number }) =>
    tab === 'final' ? row.headstart : row.points > 0 && row.rank <= topN ? topN - row.rank + 1 : 0;
  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title={t('contest.rankingTitle')} subtitle={s?.name} onBack={back} testID="contest-ranking" />
      <ScrollView contentContainerStyle={styles.body}>
        <Segmented options={[{ key: 'season', label: t('contest.tabSeason') }, { key: 'final', label: t('contest.tabFinal') }]} value={tab}
                   onChange={k => { setTab(k); load(k); }} />
        {tab === 'final' && ranking && !ranking.frozen && s && (
          <Text style={styles.muted}>{t('contest.finalNotYet', { date: contestDate(s.finalWeekStart, i18n.language), count: s.rules.headstartTopN })}</Text>
        )}
        {tab === 'season' && s && topN > 0 && <Text style={styles.muted}>{t('contest.hsHint', { count: topN })}</Text>}
        {failed ? <Text style={styles.muted}>{t('contest.error')}</Text> : !ranking ? <ActivityIndicator color={colors.muted} style={{ marginVertical: Space.lg }} /> : (
          <Card style={styles.card}>
            {ranking.rows.length === 0 && <Text style={styles.muted}>{t('contest.empty')}</Text>}
            {ranking.rows.length > 0 && <Podium rows={ranking.rows.slice(0, 3)} meId={account?.id ?? null} bonusFor={bonusFor} />}
            {ranking.rows.slice(3).map(row => <RankRow key={row.userId} row={row} me={row.userId === account?.id} bonus={bonusFor(row)} />)}
          </Card>
        )}
      </ScrollView>
      {/* My row, always in sight. */}
      {mine && (
        <View style={styles.pinned}>
          <RankRow row={mine} me bonus={bonusFor(mine)} />
        </View>
      )}
    </Screen>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  body:   { paddingHorizontal: Gutter, paddingBottom: 120, gap: Space.md },
  card:   { padding: Space.md, gap: 0 },
  muted:  { ...Type.caption, color: c.muted },
  pinned: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: Gutter + Space.sm, paddingTop: Space.xs, paddingBottom: Space.lg,
            backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.line },
});
