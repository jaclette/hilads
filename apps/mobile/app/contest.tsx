import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Space, Gutter, Radius, Type, IconSize, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { Avatar, Button, Card, Screen, ScreenHeader, Segmented } from '@/ui';
import { contestDate, fetchContest, fetchContestRanking, type ContestOverview, type ContestRanking, type ContestRow, type ContestMeJoined } from '@/features/contest/contest';
import { track } from '@/services/analytics';

/**
 * Launch Season (phase 1, mechanics first): the contest's own screen, separate from Ranks.
 * The prize counter, my score (likes / invites / head start), the friends who count, the
 * season and final-week rankings, how it works and the rules link. Join from here
 * (app/contest-join). Every number comes from GET /contest and /contest/ranking.
 */
export default function ContestScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { t, i18n } = useTranslation('me');
  const { account } = useApp();
  const [data, setData] = useState<ContestOverview | null>(null);
  const [ranking, setRanking] = useState<ContestRanking | null>(null);
  const [tab, setTab] = useState<'season' | 'final'>('season');
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    fetchContest().then(d => {
      setData(d);
      const phase = d.season?.phase === 'final' || d.season?.phase === 'over' ? 'final' : 'season';
      setTab(phase);
      if (d.season) return fetchContestRanking(phase).then(setRanking);
    }).catch(() => setFailed(true));
  }, []);
  useFocusEffect(useCallback(() => { load(); track('contest_viewed', {}); }, [load]));

  const pickTab = (k: 'season' | 'final') => {
    setTab(k);
    setRanking(null);
    fetchContestRanking(k).then(setRanking).catch(() => setFailed(true));
  };
  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/today' as never));
  const s = data?.season;

  if (failed || !data || !s) {
    return (
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader title={t('contest.title')} onBack={back} testID="contest" />
        <View style={styles.center}>
          {failed ? (
            <>
              <Text style={styles.muted}>{t('contest.error')}</Text>
              <Button variant="secondary" size="sm" label={t('contest.retry')} onPress={load} />
            </>
          ) : data && !s ? <Text style={styles.muted}>{t('contest.closed')}</Text>
            : <ActivityIndicator color={colors.muted} />}
        </View>
      </Screen>
    );
  }

  const me = data.me;
  const joined = me?.joined === true ? (me as ContestMeJoined) : null;
  const counter = data.counter;
  const pct = counter ? Math.min(1, counter.players / Math.max(1, counter.threshold)) : 0;
  const phaseLine = t(`contest.phase.${s.phase}`, { date: contestDate(s.phase === 'upcoming' ? s.startDate : s.endDate, i18n.language) });
  const r = s.rules;

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title={s.name} subtitle={phaseLine} onBack={back} testID="contest" />
      <ScrollView contentContainerStyle={styles.body}>
        {s.isTest && <Text style={styles.test}>{t('contest.test')}</Text>}

        {/* The public counter: players with enough photos vs the prize threshold. */}
        {counter && (
          <Card style={styles.card}>
            <Text style={styles.counter} accessibilityRole="header">{t('contest.counter', { count: counter.players, max: counter.threshold })}</Text>
            <View style={styles.bar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={[styles.barFill, { width: `${pct * 100}%` }]} />
            </View>
            <Text style={styles.muted}>{t('contest.counterHint', { photos: counter.photos, max: counter.threshold })}</Text>
          </Card>
        )}

        {/* Me: my score, or the join button. */}
        {joined && joined.disqualified && <Card style={styles.card}><Text style={styles.text}>{t('contest.dq')}</Text></Card>}
        {joined && joined.excluded && <Card style={styles.card}><Text style={styles.text}>{t('contest.excluded')}</Text></Card>}
        {joined && joined.points && !joined.disqualified && (
          <Card style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.section} accessibilityRole="header">{t('contest.myScore')}</Text>
              <Text style={styles.rank}>
                {(tab === 'final' ? joined.finalRank : joined.seasonRank) ? '#' + (tab === 'final' ? joined.finalRank : joined.seasonRank) : t('contest.notRanked')}
              </Text>
            </View>
            <View style={styles.split}>
              <Part label={t('contest.votes')} value={tab === 'final' ? joined.points.finalVotes : joined.points.votes} />
              <Part label={t('contest.referral')} value={joined.points.referral} />
              {tab === 'final' && <Part label={t('contest.headstart')} value={joined.points.headstart} />}
              <Part label={t('contest.total')} value={tab === 'final' ? joined.points.final : joined.points.season} strong />
            </View>
            <Text style={styles.muted}>{t('contest.photosDays', { photos: joined.photos ?? 0, days: joined.days ?? 0 })}</Text>

            {joined.referrals && (
              <View style={styles.referrals}>
                <Text style={styles.label}>{t('contest.referrals', { active: Math.min(joined.referrals.active, joined.referrals.cap), cap: joined.referrals.cap })}</Text>
                {joined.referrals.friends.map((f, i) => (
                  <View key={(f.username ?? '') + i} style={styles.row}>
                    <Text style={styles.text} numberOfLines={1}>@{f.username}</Text>
                    <Text style={[styles.muted, f.status === 'active' && { color: colors.green }]}>
                      {t(`contest.friend.${f.status}`, { photos: f.photos, min: joined.referrals!.minPhotos })}
                    </Text>
                  </View>
                ))}
                <Text style={styles.muted}>{t('contest.referralsHint', { count: joined.referrals.minPhotos })}</Text>
                <Button variant="secondary" size="sm" icon="person-add-outline" label={t('contest.inviteCta')} onPress={() => router.push('/invite' as never)} />
              </View>
            )}
          </Card>
        )}
        {me && me.joined === false && (
          <Card style={styles.card}>
            <Text style={styles.text}>{t('contest.joinText')}</Text>
            {me.canJoin
              ? <Button icon="rocket-outline" label={t('contest.join')} onPress={() => router.push('/contest-join' as never)} testID="contest-join" />
              : <Text style={styles.muted}>{me.reason === 'closed' ? t('contest.closed') : t('contest.cantJoin')}</Text>}
          </Card>
        )}
        {!account && (
          <Card style={styles.card}>
            <Text style={styles.text}>{t('contest.joinText')}</Text>
            <Button icon="rocket-outline" label={t('contest.join')} onPress={() => router.push('/auth-gate?reason=contest&returnTo=%2Fcontest' as never)} />
          </Card>
        )}

        {/* The contest's own ranking (not the Ranks tab). */}
        <Segmented options={[{ key: 'season', label: t('contest.tabSeason') }, { key: 'final', label: t('contest.tabFinal') }]} value={tab} onChange={pickTab} />
        {tab === 'final' && !ranking?.frozen && (
          <Text style={styles.muted}>{t('contest.finalNotYet', { date: contestDate(s.finalWeekStart, i18n.language), count: r.headstartTopN })}</Text>
        )}
        {!ranking ? <ActivityIndicator color={colors.muted} style={{ marginVertical: Space.lg }} /> : (
          <Card style={styles.list}>
            {ranking.rows.length === 0 && <Text style={styles.muted}>{t('contest.empty')}</Text>}
            {ranking.rows.map(row => <RankRow key={row.userId} row={row} me={row.userId === account?.id} />)}
            {ranking.me && !ranking.rows.some(x => x.userId === ranking.me!.userId) && <RankRow row={ranking.me} me />}
          </Card>
        )}

        {/* How it works + the full rules (public page). */}
        <Card style={styles.card}>
          <Text style={styles.section} accessibilityRole="header">{t('contest.howTitle')}</Text>
          {[t('contest.how1'), t('contest.how2', { count: r.voteCap }),
            t('contest.how3', { points: r.referralPoints, min: r.referralMinPhotos, max: r.referralCap }),
            t('contest.how4', { count: r.headstartTopN })].map((line, i) => (
            <Text key={i} style={styles.text}>• {line}</Text>
          ))}
          <Pressable onPress={() => Linking.openURL(s.rulesUrl)} accessibilityRole="link" hitSlop={8} style={styles.link}>
            <Text style={styles.linkText}>{t('contest.rules')}</Text>
            <Ionicons name="open-outline" size={IconSize.sm} color={colors.primaryText} />
          </Pressable>
        </Card>
      </ScrollView>
    </Screen>
  );
}

function Part({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.part} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[styles.partValue, strong && styles.partStrong]}>{value}</Text>
      <Text style={styles.partLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function RankRow({ row, me }: { row: ContestRow; me: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('me');
  const router = useRouter();
  const name = row.username ? '@' + row.username : row.displayName ?? '';
  const detail = [row.votes > 0 ? `${t('contest.votes')} ${row.votes}` : null, row.referral > 0 ? `${t('contest.referral')} ${row.referral}` : null,
                  row.headstart > 0 ? `${t('contest.headstart')} ${row.headstart}` : null].filter(Boolean).join(' · ');
  return (
    <Pressable style={[styles.rankRow, me && styles.rankRowMe]} onPress={() => router.push({ pathname: '/user/[id]', params: { id: row.userId } })}
               accessibilityRole="button" accessibilityLabel={`#${row.rank} ${name}, ${t('contest.pts', { count: row.points })}`}>
      <Text style={styles.rankNum}>{row.rank}</Text>
      <Avatar uri={row.photoUrl} name={row.displayName ?? row.username ?? ''} size={36} />
      <View style={styles.rankBody}>
        <Text style={styles.text} numberOfLines={1}>{name}{me ? ` · ${t('contest.youLabel')}` : ''}</Text>
        {!!detail && <Text style={styles.muted} numberOfLines={1}>{detail}</Text>}
      </View>
      <Text style={styles.rankPts}>{t('contest.pts', { count: row.points })}</Text>
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  body:       { paddingHorizontal: Gutter, paddingBottom: Space.xxl, gap: Space.md },
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.md, padding: Gutter },
  test:       { alignSelf: 'flex-start', ...Type.caption, fontWeight: '900', color: c.onCta, backgroundColor: c.red, borderRadius: Radius.control, paddingHorizontal: Space.sm, paddingVertical: 2, overflow: 'hidden' },
  card:       { padding: Space.md, gap: Space.sm },
  list:       { gap: 0, paddingHorizontal: Space.md, paddingVertical: Space.xs },
  counter:    { ...Type.title, color: c.text },
  bar:        { height: 10, borderRadius: 5, backgroundColor: c.line, overflow: 'hidden' },
  barFill:    { height: '100%', backgroundColor: c.cta },
  section:    { ...Type.label, fontWeight: '800', color: c.text },
  label:      { ...Type.caption, fontWeight: '800', color: c.text },
  text:       { ...Type.body, color: c.text, flexShrink: 1 },
  muted:      { ...Type.caption, color: c.muted },
  row:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  rank:       { ...Type.label, fontWeight: '900', color: c.primaryText },
  split:      { flexDirection: 'row', gap: Space.sm },
  part:       { flex: 1, alignItems: 'center', paddingVertical: Space.sm, borderRadius: Radius.control, backgroundColor: c.primaryTint },
  partValue:  { ...Type.label, fontWeight: '800', color: c.primaryOnTint },
  partStrong: { fontWeight: '900' },
  partLabel:  { ...Type.caption, color: c.primaryOnTint },
  referrals:  { gap: Space.xs, marginTop: Space.xs },
  rankRow:    { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.sm, minHeight: 52 },
  rankRowMe:  { backgroundColor: c.primaryTint, borderRadius: Radius.control, marginHorizontal: -Space.sm, paddingHorizontal: Space.sm },
  rankNum:    { ...Type.label, fontWeight: '900', color: c.muted, width: 28, textAlign: 'center' },
  rankBody:   { flex: 1 },
  rankPts:    { ...Type.label, fontWeight: '800', color: c.text },
  link:       { flexDirection: 'row', alignItems: 'center', gap: Space.xs, minHeight: 44 },
  linkText:   { ...Type.label, fontWeight: '800', color: c.primaryText },
});
