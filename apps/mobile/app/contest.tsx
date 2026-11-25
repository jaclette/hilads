import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Easing, Linking, Pressable, ScrollView, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Space, Gutter, Radius, Type, IconSize, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { Button, Card, Screen, ScreenHeader, Sheet, SheetTitle } from '@/ui';
import { contestDate, fetchContest, fetchContestRanking, type ContestOverview, type ContestRanking, type ContestMeJoined } from '@/features/contest/contest';
import { LS } from '@/features/contest/HalongArt';
import { PrizeCover } from '@/features/contest/PrizePhotos';
import { CountdownBoard, countdownTarget } from '@/features/contest/Countdown';
import { Podium, RankRow } from '@/features/contest/RankingParts';
import { useContestShare } from '@/features/contest/useContestShare';
import { HowToWin } from '@/features/contest/HowToWin';
import { track } from '@/services/analytics';

/**
 * Launch Season home, the essentials only: the prize in one row (to the Prize screen), the
 * countdown, the players' unlock as a flight path, my score as a departure board (+ Share), the
 * invites (+20 per friend), the top 3 with "See full ranking", and How it works / Rules as links.
 * Every number comes from GET /contest and /contest/ranking; visual only.
 */
export default function ContestScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { t, i18n } = useTranslation('me');
  const { account } = useApp();
  const [data, setData] = useState<ContestOverview | null>(null);
  const [ranking, setRanking] = useState<ContestRanking | null>(null);
  const [failed, setFailed] = useState(false);
  const [how, setHow] = useState(false);
  const share = useContestShare(data);

  const load = useCallback(() => {
    setFailed(false);
    fetchContest(i18n.language).then(d => {
      setData(d);
      const phase = d.season?.phase === 'final' || d.season?.phase === 'over' ? 'final' : 'season';
      if (d.season) return fetchContestRanking(phase).then(setRanking);
    }).catch(() => setFailed(true));
  }, [i18n.language]);
  useFocusEffect(useCallback(() => { load(); track('contest_viewed', {}); }, [load]));

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
  const target = countdownTarget(s);
  const mine = ranking?.me ?? null;
  const above = mine && mine.rank > 1 ? ranking?.rows.find(x => x.rank === mine.rank - 1) : null;
  const behind = mine && above ? above.points - mine.points : null;
  const rank = final ? joined?.finalRank : joined?.seasonRank;

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title={s.name} subtitle={phaseLine} onBack={back} testID="contest" />
      <ScrollView contentContainerStyle={styles.body}>
        {/* The prize in one row: the Prize screen. */}
        <Pressable style={({ pressed }) => [styles.prize, pressed && { opacity: 0.85 }]} onPress={() => router.push('/contest-prize' as never)}
                   accessibilityRole="button" accessibilityLabel={`${s.prize?.title || s.name}. ${t('contest.winLine')} ${t('contest.seePrize')}`} testID="contest-prize-row">
          <View style={styles.prizeArt}><View style={StyleSheet.absoluteFill}><PrizeCover photos={s.photos} width="100%" height="100%" /></View></View>
          <View style={styles.prizeBody}>
            <Text style={styles.prizeTitle} numberOfLines={2}>{s.prize?.title || s.name}</Text>
            <Text style={styles.winLine} numberOfLines={2}>{t('contest.winLine')}</Text>
            <Text style={styles.prizeLink}>{t('contest.seePrize')}</Text>
          </View>
          {s.isTest && <Text style={styles.test}>{t('contest.test')}</Text>}
          <Ionicons name="chevron-forward" size={IconSize.md} color={colors.muted} />
        </Pressable>

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

        {target && <CountdownBoard target={target} />}
        {data.counter && <Unlock players={data.counter.players} max={data.counter.threshold} photos={data.counter.photos} />}

        {joined && joined.disqualified && <Card style={styles.card}><Text style={styles.text}>{t('contest.dq')}</Text></Card>}
        {joined && joined.excluded && <Card style={styles.card}><Text style={styles.text}>{t('contest.excluded')}</Text></Card>}

        {/* My score: a departure board, and Share. */}
        {joined && joined.points && !joined.disqualified && (
          <View style={styles.board}>
            <View style={styles.boardHead}>
              <Text style={styles.boardTitle}>{t(final ? 'contest.myFinalScore' : 'contest.myScore')}</Text>
              {rank ? <View style={styles.tag}><View style={styles.tagHole} /><Text style={styles.tagText}>#{rank}</Text></View>
                : <Text style={styles.boardMuted}>{t('contest.notRanked')}</Text>}
            </View>
            <View style={styles.tiles}>
              <Tile label={t('contest.votes')} value={final ? joined.points.finalVotes : joined.points.votes} />
              <Tile label={t('contest.referral')} value={joined.points.referral} />
              {final && <Tile label={t('contest.headstart')} value={joined.points.headstart} />}
              <Tile label={t('contest.total')} value={final ? joined.points.final : joined.points.season} total />
            </View>
            <View style={styles.boardFoot}>
              <Text style={[styles.boardMuted, { flex: 1 }]}>
                {t('contest.photosDays', { photos: joined.photos ?? 0, days: joined.days ?? 0 })}
                {behind !== null && above ? ` · ${t('contest.behind', { count: behind, rank: above.rank })}` : ''}
              </Text>
              <Pressable onPress={share.open} style={styles.shareBtn} accessibilityRole="button" hitSlop={6} testID="contest-share">
                <Ionicons name="share-outline" size={IconSize.sm} color={LS.board} />
                <Text style={styles.shareText}>{t('contest.share')}</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Invites: +20 per friend. */}
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
            {joined.referrals.friends.slice(0, 3).map((f, i) => (
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

        {/* The top 3, then the full ranking. */}
        <Card style={styles.card}>
          <View style={styles.rankHead}>
            <Text style={styles.section}>{t(final ? 'contest.tabFinal' : 'contest.tabSeason')}</Text>
          </View>
          {!ranking ? <ActivityIndicator color={colors.muted} style={{ marginVertical: Space.md }} />
            : ranking.rows.length === 0 ? <Text style={styles.muted}>{t('contest.empty')}</Text> : (
              <>
                <Podium rows={ranking.rows.slice(0, 3)} meId={account?.id ?? null}
                        bonusFor={row => final ? row.headstart : row.points > 0 && row.rank <= r.headstartTopN ? r.headstartTopN - row.rank + 1 : 0} />
                {mine && mine.rank > 3 && <RankRow row={mine} me bonus={final ? mine.headstart : mine.points > 0 && mine.rank <= r.headstartTopN ? r.headstartTopN - mine.rank + 1 : 0} />}
              </>
            )}
          <Pressable onPress={() => router.push({ pathname: '/contest-ranking', params: { tab: final ? 'final' : 'season' } } as never)}
                     style={styles.seeAll} accessibilityRole="button" testID="contest-see-ranking">
            <Text style={styles.linkText}>{t('contest.seeRanking')}</Text>
            <Ionicons name="chevron-forward" size={IconSize.sm} color={colors.primaryText} />
          </Pressable>
        </Card>

        <View style={styles.links}>
          <Pressable onPress={() => setHow(true)} accessibilityRole="button" hitSlop={8} style={styles.link}>
            <Ionicons name="help-circle-outline" size={IconSize.sm} color={colors.primaryText} />
            <Text style={styles.linkText}>{t('contest.howWinTitle')}</Text>
          </Pressable>
          <Pressable onPress={() => Linking.openURL(s.rulesUrl)} accessibilityRole="link" hitSlop={8} style={styles.link}>
            <Text style={styles.linkText}>{t('contest.rulesShort')}</Text>
            <Ionicons name="open-outline" size={IconSize.sm} color={colors.primaryText} />
          </Pressable>
        </View>
      </ScrollView>

      <Sheet visible={how} onClose={() => setHow(false)} closeLabel={t('back', { ns: 'common' })}>
        <SheetTitle>{t('contest.howWinTitle')}</SheetTitle>
        <View style={{ gap: Space.sm, paddingBottom: Space.md }}>
          <HowToWin season={s} />
          <Pressable onPress={() => Linking.openURL(s.rulesUrl)} accessibilityRole="link" hitSlop={8} style={styles.link}>
            <Text style={styles.linkText}>{t('contest.rules')}</Text>
            <Ionicons name="open-outline" size={IconSize.sm} color={colors.primaryText} />
          </Pressable>
        </View>
      </Sheet>
      {share.sheet}
    </Screen>
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
      {/* The competition first (the #1 of the final week wins), the players' threshold second. */}
      <View style={styles.unlockWin}>
        <Ionicons name="trophy" size={20} color={LS.mango} />
        <Text style={styles.unlockWinText}>{t('contest.unlockWin')}</Text>
      </View>
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

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  body:       { paddingHorizontal: Gutter, paddingBottom: Space.xxl, gap: Space.md },
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.md, padding: Gutter },
  card:       { padding: Space.md, gap: Space.sm },
  section:    { ...Type.label, fontWeight: '800', color: c.text },
  text:       { ...Type.body, color: c.text, flexShrink: 1 },
  muted:      { ...Type.caption, color: c.muted },
  test:       { ...Type.caption, fontSize: 11, lineHeight: 15, fontWeight: '800', color: '#FFFFFF', backgroundColor: LS.lantern, borderRadius: Radius.control,
                paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  // The prize row.
  prize:      { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 84, borderRadius: Radius.card, overflow: 'hidden',
                backgroundColor: c.bg2, borderWidth: 1, borderColor: c.line, paddingRight: Space.sm },
  prizeArt:   { width: 96, alignSelf: 'stretch', overflow: 'hidden' },
  prizeBody:  { flex: 1, paddingVertical: Space.sm, gap: 2 },
  prizeTitle: { ...Type.label, fontWeight: '800', color: c.text },
  prizeLink:  { ...Type.caption, fontWeight: '800', color: c.primaryText },
  winLine:    { ...Type.caption, fontWeight: '700', color: c.text },
  // The unlock.
  unlockHead: { flexDirection: 'row', alignItems: 'baseline', gap: Space.xs, flexWrap: 'wrap' },
  unlockWin:  { flexDirection: 'row', alignItems: 'flex-start', gap: Space.xs },
  unlockWinText: { ...Type.label, fontSize: 17, lineHeight: 23, fontWeight: '800', color: c.text, flex: 1 },
  unlockCount:{ ...Type.title, color: c.text },
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
  boardFoot:  { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  shareBtn:   { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: LS.mango, borderRadius: Radius.control, paddingHorizontal: Space.sm, minHeight: 32 },
  shareText:  { ...Type.caption, fontWeight: '800', color: LS.board },
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
  // Invites.
  invite:     { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  stamp:      { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderStyle: 'dashed', borderColor: c.green, alignItems: 'center', justifyContent: 'center',
                transform: [{ rotate: '-10deg' }], padding: 4 },
  stampPts:   { fontSize: 22, lineHeight: 24, fontWeight: '800', color: c.green },
  stampSmall: { fontSize: 10, lineHeight: 12, fontWeight: '700', color: c.green, textAlign: 'center' },
  segments:   { flexDirection: 'row', gap: 4, marginTop: Space.xs },
  segment:    { flex: 1, height: 8, borderRadius: 4, backgroundColor: c.line },
  segmentOn:  { backgroundColor: c.green },
  friend:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  // Ranking preview + links.
  rankHead:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  seeAll:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.xs, minHeight: 44 },
  links:      { flexDirection: 'row', justifyContent: 'center', gap: Space.lg },
  link:       { flexDirection: 'row', alignItems: 'center', gap: Space.xs, minHeight: 44 },
  linkText:   { ...Type.label, fontWeight: '800', color: c.primaryText },
});
