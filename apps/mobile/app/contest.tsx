import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Easing, Linking, Pressable, ScrollView, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Space, Gutter, Radius, Type, IconSize, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { Avatar, Button, Card, Crown, Screen, ScreenHeader, Segmented } from '@/ui';
import { contestDate, daysLeft, fetchContest, fetchContestRanking, type ContestOverview, type ContestRanking, type ContestRow, type ContestMeJoined } from '@/features/contest/contest';
import { HalongArt, LS } from '@/features/contest/HalongArt';
import { track } from '@/services/analytics';

/**
 * Launch Season, a boarding pass to the prize (docs/mockups/hilads_launch_season_mockup.html):
 * the prize first (Admin › Launch Season), the players' unlock as a flight path, my score as a
 * departure board, invites as a passport stamp, the season / final-week ranking as a podium,
 * how it works and the rules. Visual only: every number comes from GET /contest and
 * /contest/ranking. Event accents (LS) are fixed art colors; the rest follows the theme.
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
    fetchContest(i18n.language).then(d => {
      setData(d);
      const phase = d.season?.phase === 'final' || d.season?.phase === 'over' ? 'final' : 'season';
      setTab(phase);
      if (d.season) return fetchContestRanking(phase).then(setRanking);
    }).catch(() => setFailed(true));
  }, [i18n.language]);
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
  const final = s.phase === 'final' || s.phase === 'over';
  const phaseLine = t(`contest.phase.${s.phase}`, { date: contestDate(s.phase === 'upcoming' ? s.startDate : s.endDate, i18n.language) });
  const r = s.rules;
  const prize = { title: s.prize?.title || s.name, subtitle: s.prize?.subtitle ?? '' };

  // Points to the player just above me (the ranking shown).
  const mine = ranking?.me ?? null;
  const above = mine && mine.rank > 1 ? ranking?.rows.find(x => x.rank === mine.rank - 1) : null;
  const behind = mine && above ? above.points - mine.points : null;

  const joinCard = me && me.joined === false ? (
    <Card style={styles.card}>
      <Text style={styles.text}>{t('contest.joinText')}</Text>
      {me.canJoin
        ? <Button icon="rocket-outline" label={t('contest.join')} onPress={() => router.push('/contest-join' as never)} testID="contest-join" />
        : <Text style={styles.muted}>{me.reason === 'closed' ? t('contest.closed') : t('contest.cantJoin')}</Text>}
    </Card>
  ) : !account ? (
    <Card style={styles.card}>
      <Text style={styles.text}>{t('contest.joinText')}</Text>
      <Button icon="rocket-outline" label={t('contest.join')} onPress={() => router.push('/auth-gate?reason=contest&returnTo=%2Fcontest' as never)} />
    </Card>
  ) : null;

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title={s.name} subtitle={phaseLine} onBack={back} testID="contest" />
      <ScrollView contentContainerStyle={styles.body}>
        {/* The prize: a boarding pass. */}
        <View style={styles.pass} accessible accessibilityRole="header"
              accessibilityLabel={`${prize.title}. ${prize.subtitle}${s.isTest ? `. ${t('contest.test')}` : ''}`}>
          <View style={styles.passArt}>
            <View style={StyleSheet.absoluteFill}><HalongArt width="100%" height="100%" /></View>
            {s.isTest && <Text style={styles.test}>{t('contest.test')}</Text>}
          </View>
          <View style={styles.tear}>
            <View style={[styles.notch, { left: -25 }]} />
            <View style={[styles.notch, { right: -25 }]} />
          </View>
          <View style={styles.passBody}>
            <Text style={styles.prizeTitle}>{prize.title}</Text>
            {!!prize.subtitle && <Text style={styles.prizeSub}>{prize.subtitle}</Text>}
            <View style={styles.meta}>
              <Meta label={t('contest.passFinal')} value={final ? t('contest.passNow') : contestDate(s.finalWeekStart, i18n.language)} />
              <Meta label={t('contest.passEnds')} value={contestDate(s.endDate, i18n.language)} />
              <Meta label={t('contest.passDaysLeft')} value={String(daysLeft(s.endDate))} />
            </View>
            <Text style={[styles.muted, styles.gift]}>{t('contest.launchGift')}</Text>
          </View>
        </View>

        {joinCard}

        {/* The unlock: players on their way, as a flight path. */}
        {data.counter && <Unlock players={data.counter.players} max={data.counter.threshold} photos={data.counter.photos} />}

        {joined && joined.disqualified && <Card style={styles.card}><Text style={styles.text}>{t('contest.dq')}</Text></Card>}
        {joined && joined.excluded && <Card style={styles.card}><Text style={styles.text}>{t('contest.excluded')}</Text></Card>}

        {/* My score: a departure board. */}
        {joined && joined.points && !joined.disqualified && (
          <View style={styles.board} accessible
                accessibilityLabel={`${t(tab === 'final' ? 'contest.myFinalScore' : 'contest.myScore')}: ${tab === 'final' ? joined.points.final : joined.points.season}`}>
            <View style={styles.boardHead}>
              <Text style={styles.boardTitle}>{t(tab === 'final' ? 'contest.myFinalScore' : 'contest.myScore')}</Text>
              {(tab === 'final' ? joined.finalRank : joined.seasonRank)
                ? <View style={styles.tag}><View style={styles.tagHole} /><Text style={styles.tagText}>#{tab === 'final' ? joined.finalRank : joined.seasonRank}</Text></View>
                : <Text style={styles.boardMuted}>{t('contest.notRanked')}</Text>}
            </View>
            <View style={styles.tiles}>
              <Tile label={t('contest.votes')} value={tab === 'final' ? joined.points.finalVotes : joined.points.votes} />
              <Tile label={t('contest.referral')} value={joined.points.referral} />
              {tab === 'final' && <Tile label={t('contest.headstart')} value={joined.points.headstart} />}
              <Tile label={t('contest.total')} value={tab === 'final' ? joined.points.final : joined.points.season} total />
            </View>
            <Text style={styles.boardMuted}>
              {t('contest.photosDays', { photos: joined.photos ?? 0, days: joined.days ?? 0 })}
              {behind !== null && above ? ` · ${t('contest.behind', { count: behind, rank: above.rank })}` : ''}
            </Text>
          </View>
        )}

        {/* Invites: the growth lever, a passport stamp. */}
        {joined && joined.referrals && !joined.disqualified && (
          <Card style={styles.card}>
            <View style={styles.invite}>
              <View style={styles.stamp} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <Text style={styles.stampPts}>+{r.referralPoints}</Text>
                <Text style={styles.stampSmall} numberOfLines={2}>{t('contest.inviteStamp')}</Text>
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.section}>{t('contest.inviteTitle')}</Text>
                <Text style={styles.muted}>{t('contest.inviteText', { points: r.referralPoints, count: r.referralMinPhotos })}</Text>
              </View>
            </View>
            <View style={styles.segments} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {Array.from({ length: Math.min(joined.referrals.cap, 20) }).map((_, i) => (
                <View key={i} style={[styles.segment, i < joined.referrals!.active && styles.segmentOn]} />
              ))}
            </View>
            <Text style={styles.muted}>{t('contest.inviteProgress', { active: Math.min(joined.referrals.active, joined.referrals.cap), cap: joined.referrals.cap })}</Text>
            {joined.referrals.friends.map((f, i) => (
              <View key={(f.username ?? '') + i} style={styles.friend}>
                <Text style={styles.text} numberOfLines={1}>@{f.username}</Text>
                <Text style={[styles.muted, f.status === 'active' && { color: colors.green }]} numberOfLines={1}>
                  {t(`contest.friend.${f.status}`, { photos: f.photos, min: joined.referrals!.minPhotos })}
                </Text>
              </View>
            ))}
            <Button icon="person-add-outline" label={t('contest.inviteCta')} onPress={() => router.push('/invite' as never)} />
          </Card>
        )}

        {/* The contest's own ranking: a podium, then the list. */}
        <Segmented options={[{ key: 'season', label: t('contest.tabSeason') }, { key: 'final', label: t('contest.tabFinal') }]} value={tab} onChange={pickTab} />
        {tab === 'final' && ranking && !ranking.frozen && (
          <Text style={styles.muted}>{t('contest.finalNotYet', { date: contestDate(s.finalWeekStart, i18n.language), count: r.headstartTopN })}</Text>
        )}
        {!ranking ? <ActivityIndicator color={colors.muted} style={{ marginVertical: Space.lg }} /> : (
          <Card style={styles.card}>
            {ranking.rows.length === 0 && <Text style={styles.muted}>{t('contest.empty')}</Text>}
            {ranking.rows.length > 0 && <Podium rows={ranking.rows.slice(0, 3)} meId={account?.id ?? null} />}
            {ranking.rows.slice(3).map(row => <RankRow key={row.userId} row={row} me={row.userId === account?.id} />)}
            {ranking.me && !ranking.rows.some(x => x.userId === ranking.me!.userId) && <RankRow row={ranking.me} me />}
          </Card>
        )}

        {/* How it works + the full rules (public page). */}
        <Card style={styles.card}>
          <Text style={styles.section} accessibilityRole="header">{t('contest.howTitle')}</Text>
          {([
            ['camera-outline', t('contest.how1')],
            ['heart-outline', t('contest.how2', { count: r.voteCap })],
            ['people-outline', t('contest.how3', { points: r.referralPoints, min: r.referralMinPhotos, max: r.referralCap })],
            ['flag-outline', t('contest.how4', { count: r.headstartTopN })],
          ] as const).map(([icon, line]) => (
            <View key={icon} style={styles.how}>
              <Ionicons name={icon} size={IconSize.md} color={colors.primaryText} />
              <Text style={[styles.text, { flex: 1 }]}>{line}</Text>
            </View>
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

function Meta({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.metaCol} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.metaLabel} numberOfLines={2}>{label}</Text>
      <Text style={styles.metaValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

/** "212 / 500 players" and the plane flying along the route to the prize (once, on open). */
function Unlock({ players, max, photos }: { players: number; max: number; photos: number }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('me');
  const [width, setWidth] = useState(0);
  const pos = useRef(new Animated.Value(0)).current;
  const pct = Math.min(1, players / Math.max(1, max));
  const unlocked = players >= max;
  useEffect(() => {
    if (!width) return;
    const to = pct * width;
    AccessibilityInfo.isReduceMotionEnabled().then(still => {
      if (still) { pos.setValue(to); return; }
      Animated.timing(pos, { toValue: to, duration: 1400, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }).catch(() => pos.setValue(to));
  }, [width, pct, pos]);
  return (
    <Card style={styles.card}>
      <View style={styles.unlockHead} accessible accessibilityLabel={`${players} / ${max} ${t('contest.unlockPlayers')}`}>
        <Text style={styles.unlockCount}>{players} / {max}</Text>
        <Text style={styles.unlockLabel}>{t('contest.unlockPlayers')}</Text>
      </View>
      <View style={styles.flight} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={styles.flightEnd}>🏙️</Text>
        <View style={styles.flightTrack} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
          <View style={styles.flightDash} />
          <View style={[styles.flightDone, { width: `${pct * 100}%` }]} />
          <Animated.View style={[styles.plane, { transform: [{ translateX: pos }] }]}>
            <Ionicons name="airplane" size={22} color={LS.lantern} />
          </Animated.View>
        </View>
        <Text style={styles.flightEnd}>🎁</Text>
      </View>
      <Text style={styles.muted}>{unlocked ? t('contest.unlocked') : t('contest.unlockHint', { max, photos })}</Text>
    </Card>
  );
}

function Tile({ label, value, total }: { label: string; value: number; total?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.tile, total && styles.tileTotal]}>
      <Text style={[styles.tileValue, total && { color: '#FFFFFF' }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={[styles.tileLabel, total && { color: '#FFE0E4' }]} numberOfLines={2}>{label}</Text>
      <View style={styles.tileSplit} />
    </View>
  );
}

/** The top 3: #2 · #1 · #3 on medal blocks, crown on #1, "You" on mine. */
function Podium({ rows, meId }: { rows: ContestRow[]; meId: string | null }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('me');
  const router = useRouter();
  const medal = [colors.medalGold, colors.medalSilver, colors.medalBronze];
  const heights = [88, 64, 48];
  const order = [rows[1], rows[0], rows[2]];
  return (
    <View style={styles.podium}>
      {order.map((row, i) => {
        if (!row) return <View key={i} style={{ flex: 1 }} />;
        const place = row.rank - 1;
        const name = row.username ? '@' + row.username : row.displayName ?? '';
        const me = row.userId === meId;
        return (
          <Pressable key={row.userId} style={[styles.step, place === 0 && { flex: 1.15 }]} onPress={() => router.push({ pathname: '/user/[id]', params: { id: row.userId } })}
                     accessibilityRole="button" accessibilityLabel={`#${row.rank} ${name}, ${t('contest.pts', { count: row.points })}${me ? `, ${t('contest.youLabel')}` : ''}`}>
            {place === 0 && <View style={styles.crown}><Crown size={24} /></View>}
            <View style={[styles.ring, { borderColor: medal[place] ?? colors.line }]}>
              <Avatar uri={row.photoUrl} name={row.displayName ?? row.username ?? ''} size={place === 0 ? 58 : 48} />
            </View>
            <Text style={styles.stepName} numberOfLines={1}>{name}</Text>
            <Text style={styles.muted} numberOfLines={1}>{t('contest.pts', { count: row.points })}</Text>
            {me && <Text style={styles.you}>{t('contest.youLabel')}</Text>}
            <View style={[styles.block, { height: heights[place] ?? 40, backgroundColor: medal[place] ?? colors.line }]}>
              <Text style={styles.blockText}>{row.rank}</Text>
            </View>
          </Pressable>
        );
      })}
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
      <Avatar uri={row.photoUrl} name={row.displayName ?? row.username ?? ''} size={38} />
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={[styles.text, { fontWeight: '700', flexShrink: 1 }]} numberOfLines={1}>{name}</Text>
          {me && <Text style={styles.you}>{t('contest.youLabel')}</Text>}
        </View>
        {!!detail && <Text style={styles.muted} numberOfLines={1}>{detail}</Text>}
      </View>
      <Text style={styles.rankPts}>{row.points}</Text>
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  body:       { paddingHorizontal: Gutter, paddingBottom: Space.xxl, gap: Space.md },
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.md, padding: Gutter },
  card:       { padding: Space.md, gap: Space.sm },
  section:    { ...Type.label, fontWeight: '800', color: c.text },
  text:       { ...Type.body, color: c.text, flexShrink: 1 },
  muted:      { ...Type.caption, color: c.muted },
  test:       { position: 'absolute', top: Space.sm, right: Space.sm, ...Type.caption, fontSize: 11, lineHeight: 15, fontWeight: '800', color: '#FFFFFF',
                backgroundColor: LS.lantern, borderRadius: Radius.control, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  // The boarding pass.
  pass:       { borderRadius: Radius.hero, overflow: 'hidden', backgroundColor: c.bg2, borderWidth: 1, borderColor: c.line },
  passArt:    { height: 180, overflow: 'hidden' },
  tear:       { height: 0, borderTopWidth: 2, borderStyle: 'dashed', borderColor: c.ticketLine, marginHorizontal: 14 },
  notch:      { position: 'absolute', top: -11, width: 20, height: 20, borderRadius: 10, backgroundColor: c.bg },
  passBody:   { padding: Space.md, gap: Space.xs },
  prizeTitle: { ...Type.display, fontSize: 30, lineHeight: 35, letterSpacing: -0.6, color: c.text },
  prizeSub:   { ...Type.body, fontWeight: '700', color: c.primaryText },
  meta:       { flexDirection: 'row', gap: Space.sm, marginTop: Space.sm },
  metaCol:    { flex: 1 },
  metaLabel:  { ...Type.caption, color: c.muted, fontWeight: '600' },
  metaValue:  { ...Type.label, color: c.text },
  gift:       { marginTop: Space.sm, paddingTop: Space.sm, borderTopWidth: 1, borderTopColor: c.line },
  // The unlock.
  unlockHead: { flexDirection: 'row', alignItems: 'baseline', gap: Space.xs, flexWrap: 'wrap' },
  unlockCount:{ ...Type.display, color: c.text },
  unlockLabel:{ ...Type.label, fontWeight: '600', color: c.muted },
  flight:     { flexDirection: 'row', alignItems: 'center', gap: Space.xs, height: 40 },
  flightEnd:  { fontSize: 20 },
  flightTrack:{ flex: 1, height: 40, justifyContent: 'center' },
  flightDash: { position: 'absolute', left: 0, right: 0, height: 0, borderTopWidth: 3, borderStyle: 'dashed', borderColor: c.line },
  flightDone: { position: 'absolute', left: 0, height: 7, borderRadius: 4, backgroundColor: LS.orange },
  plane:      { position: 'absolute', left: -11, top: 9 },
  // The departure board (fixed dark, like an airport board, in every theme).
  board:      { backgroundColor: LS.board, borderRadius: Radius.card, padding: Space.md, gap: Space.sm },
  boardHead:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Space.sm },
  boardTitle: { ...Type.label, color: LS.boardText, flexShrink: 1 },
  boardMuted: { ...Type.caption, color: LS.boardMuted },
  tag:        { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.medalGold, borderTopLeftRadius: 6, borderBottomLeftRadius: 6,
                borderTopRightRadius: 12, borderBottomRightRadius: 12, paddingLeft: 8, paddingRight: 12, paddingVertical: 4, transform: [{ rotate: '-4deg' }] },
  tagHole:    { width: 7, height: 7, borderRadius: 4, backgroundColor: LS.board },
  tagText:    { ...Type.title, color: c.onMedal },
  tiles:      { flexDirection: 'row', gap: Space.xs },
  tile:       { flex: 1, backgroundColor: LS.boardTile, borderRadius: 12, paddingVertical: Space.sm, paddingHorizontal: 4, alignItems: 'center', overflow: 'hidden' },
  tileTotal:  { backgroundColor: LS.lantern },
  tileValue:  { fontSize: 28, lineHeight: 32, fontWeight: '800', color: LS.mango, fontVariant: ['tabular-nums'] },
  tileLabel:  { ...Type.caption, fontSize: 12, lineHeight: 15, color: LS.boardMuted, textAlign: 'center' },
  tileSplit:  { position: 'absolute', left: 0, right: 0, top: '50%', height: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  // The invite stamp.
  invite:     { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  stamp:      { width: 76, height: 76, borderRadius: 38, borderWidth: 3, borderStyle: 'dashed', borderColor: c.green, alignItems: 'center', justifyContent: 'center',
                transform: [{ rotate: '-10deg' }], padding: 4 },
  stampPts:   { fontSize: 24, lineHeight: 26, fontWeight: '800', color: c.green },
  stampSmall: { fontSize: 10, lineHeight: 12, fontWeight: '700', color: c.green, textAlign: 'center' },
  segments:   { flexDirection: 'row', gap: 4, marginTop: Space.xs },
  segment:    { flex: 1, height: 8, borderRadius: 4, backgroundColor: c.line },
  segmentOn:  { backgroundColor: c.green },
  friend:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  // The podium + rows.
  podium:     { flexDirection: 'row', alignItems: 'flex-end', gap: Space.sm, paddingTop: Space.md },
  step:       { flex: 1, alignItems: 'center', gap: 2 },
  crown:      { marginBottom: -2 },
  ring:       { borderWidth: 3, borderRadius: 999, padding: 2 },
  stepName:   { ...Type.caption, fontWeight: '800', color: c.text, maxWidth: '100%' },
  block:      { alignSelf: 'stretch', marginTop: Space.xs, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomLeftRadius: 4, borderBottomRightRadius: 4,
                alignItems: 'center', justifyContent: 'center' },
  blockText:  { ...Type.title, color: c.onMedal },
  you:        { ...Type.caption, fontSize: 11, lineHeight: 15, fontWeight: '800', color: c.onCta, backgroundColor: c.cta, borderRadius: Radius.control,
                paddingHorizontal: 8, paddingVertical: 1, overflow: 'hidden' },
  rankRow:    { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.sm, minHeight: 56 },
  rankRowMe:  { backgroundColor: c.primaryTint, borderRadius: Radius.control, marginHorizontal: -Space.sm, paddingHorizontal: Space.sm },
  rankNum:    { ...Type.label, fontWeight: '800', color: c.muted, width: 28, textAlign: 'center' },
  nameRow:    { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  rankPts:    { ...Type.label, fontWeight: '800', color: c.text },
  how:        { flexDirection: 'row', gap: Space.sm, alignItems: 'flex-start' },
  link:       { flexDirection: 'row', alignItems: 'center', gap: Space.xs, minHeight: 44 },
  linkText:   { ...Type.label, fontWeight: '800', color: c.primaryText },
});
