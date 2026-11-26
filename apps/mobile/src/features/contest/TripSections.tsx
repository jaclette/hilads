import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Linking, Pressable, Text, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Space, Radius, Type, IconSize, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { useDailyToday } from '@/hooks/useDaily';
import { Avatar, Button, Card, Crown } from '@/ui';
import { shareTo } from '@/features/share/targets';
import type { Crew } from '@/features/invites/invite';
import { contestDate, notifyContest, type ContestMeJoined, type ContestMeNotJoined, type ContestOverview, type ContestRanking,
         type ContestRow, type ContestSeason } from './contest';
import { setContestOverview } from './useContestTab';
import { Podium } from './RankingParts';
import { SouvenirLine } from './SouvenirLine';
import { LS } from './HalongArt';

/**
 * The Trip tab's four sections (app/(tabs)/trip.tsx). Plain language, every number from the server:
 * the campaign's dates and goal (Admin › Launch Season), the regular Hilads points (config/scoring.php),
 * my friends (GET /me/invite, the regular invite rule).
 */
export const SECTIONS = ['overview', 'ranking', 'friends', 'rules'] as const;
export type TripSection = typeof SECTIONS[number];
type Cta = (name: string, extra?: Record<string, unknown>) => void;

const isOver = (s: ContestSeason) => s.phase === 'over' || s.phase === 'ended';
/** The day after the end date: the winner's day. */
function dayAfter(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function dayBefore(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ── Overview ──────────────────────────────────────────────────────────────────

export function TripOverview({ data, ranking, crew, onSection, onCta }: {
  data: ContestOverview; ranking: ContestRanking | null; crew: Crew | null; onSection: (s: TripSection) => void; onCta: Cta;
}) {
  const s = data.season!;
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('me');
  return (
    <View style={styles.stack}>
      {s.isTest && (
        <View style={styles.testNote} accessibilityRole="alert">
          <Ionicons name="flask-outline" size={IconSize.sm} color="#FFFFFF" />
          <Text style={styles.testNoteText}>{t('trip.testNote')}</Text>
        </View>
      )}
      {isOver(s) && <WinnerCard data={data} ranking={ranking} />}
      <PhaseTimeline season={s} />
      {data.counter && <GoalCard season={s} counter={data.counter} me={data.me ?? null} />}
      {!isOver(s) && <MyStatus data={data} />}
      <PrimaryCta data={data} crew={crew} onSection={onSection} onCta={onCta} />
    </View>
  );
}

/** Unlock the trip → Final week → Winner, the current phase highlighted, with dates. */
function PhaseTimeline({ season: s }: { season: ContestSeason }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('me');
  const d = (x: string) => contestDate(x, i18n.language);
  const now = s.phase === 'season' ? 0 : s.phase === 'final' ? 1 : isOver(s) ? 2 : -1;
  const steps = [
    { icon: 'lock-open-outline' as const, title: t('trip.phases.unlock'), when: `${d(s.startDate)} – ${d(dayBefore(s.finalWeekStart))}` },
    { icon: 'flag-outline' as const, title: t('trip.phases.final'), when: `${d(s.finalWeekStart)} – ${d(s.endDate)}` },
    { icon: 'trophy-outline' as const, title: t('trip.phases.winner'), when: d(dayAfter(s.endDate)) },
  ];
  return (
    <View style={styles.timeline}>
      {steps.map((st, i) => {
        const on = i === now, done = i < now;
        return (
          <View key={i} style={[styles.phase, on && styles.phaseOn, done && styles.phaseDone]} accessible
                accessibilityLabel={`${st.title}, ${st.when}${on ? `, ${t('trip.phases.now')}` : done ? `, ${t('trip.phases.done')}` : ''}`}>
            <Ionicons name={done ? 'checkmark-circle' : st.icon} size={22} color={on ? colors.onCta : done ? colors.green : colors.primaryText} />
            <Text style={[styles.phaseTitle, on && { color: colors.onCta }]} numberOfLines={2}>{st.title}</Text>
            <Text style={[styles.phaseWhen, on && { color: colors.onCta }]} numberOfLines={1}>{on ? t('trip.phases.now') : st.when}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** "186 / 500 players", the plane along the route to the gift, what counts, my photos, the fallback. */
function GoalCard({ season: s, counter, me }: { season: ContestSeason; counter: NonNullable<ContestOverview['counter']>; me: ContestOverview['me'] | null }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('me');
  const reached = counter.reached ?? counter.players >= counter.threshold;
  const pct = Math.min(1, counter.players / Math.max(1, counter.threshold));
  const [width, setWidth] = useState(0);
  const pos = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!width) return;
    const to = pct * width;
    AccessibilityInfo.isReduceMotionEnabled().then(still => {
      if (still) { pos.setValue(to); return; }
      Animated.timing(pos, { toValue: to, duration: 1200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }).catch(() => pos.setValue(to));
  }, [width, pct, pos]);
  const joined = me?.joined === true ? (me as ContestMeJoined) : null;
  const myPhotos = joined?.photos ?? null;
  const fallback = s.fallbackPrize ?? '';
  return (
    <Card style={[styles.card, reached && styles.cardReached]}>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle} accessibilityRole="header">{reached ? t('trip.goal.reached') : t('trip.goal.title')}</Text>
        {reached && <Ionicons name="sparkles" size={IconSize.md} color={colors.medalGold} />}
      </View>
      <View style={styles.goalCount} accessible accessibilityLabel={`${counter.players} / ${counter.threshold} ${t('trip.goal.players')}`}>
        <Text style={styles.goalN}>{counter.players}</Text>
        <Text style={styles.goalOf}>/ {counter.threshold} {t('trip.goal.players')}</Text>
      </View>
      <View style={styles.track} onLayout={e => setWidth(e.nativeEvent.layout.width)} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.trackBg} />
        <View style={[styles.trackFill, { width: `${pct * 100}%` }]} />
        <Animated.View style={[styles.trackPlane, { transform: [{ translateX: pos }] }]}>
          <Ionicons name="airplane" size={22} color={colors.primaryText} />
        </Animated.View>
        <View style={styles.trackGift}><Ionicons name="gift" size={22} color={reached ? colors.medalGold : colors.muted} /></View>
      </View>
      <Text style={styles.muted}>
        {reached ? t('trip.goal.reachedText', { players: counter.threshold }) : t('trip.goal.what', { photos: counter.photos })}
        {myPhotos !== null && !reached ? ' ' + (myPhotos >= counter.photos ? t('trip.goal.mineDone') : t('trip.goal.mine', { n: myPhotos, photos: counter.photos })) : ''}
      </Text>
      {!reached && (
        <View style={styles.fallback}>
          <Ionicons name="gift-outline" size={IconSize.sm} color={colors.primaryOnTint} />
          <Text style={styles.fallbackText}>
            {isOver(s) ? t('trip.goal.notReachedText', { prize: fallback })
              : t('trip.goal.fallback', { players: counter.threshold, date: contestDate(s.endDate, i18n.language), prize: fallback })}
          </Text>
        </View>
      )}
    </Card>
  );
}

/** My place: rank tag, points, the gap to the next rank; "Play to enter the race" before my first points (never "#1" with 0). */
function MyStatus({ data }: { data: ContestOverview }) {
  const styles = useThemedStyles(makeStyles);
  const { t, i18n } = useTranslation('me');
  const { account } = useApp();
  const s = data.season!;
  const me = data.me;
  if (s.phase === 'upcoming') {
    return (
      <View style={styles.board}>
        <Text style={styles.boardTitle}>{t('trip.me.upcomingTitle')}</Text>
        <Text style={styles.boardMuted}>{t('trip.me.upcomingText', { date: contestDate(s.startDate, i18n.language) })}</Text>
      </View>
    );
  }
  if (!account || !me) {
    return (
      <View style={styles.board}>
        <Text style={styles.boardTitle}>{t('trip.me.joinTitle')}</Text>
        <Text style={styles.boardMuted}>{t('trip.me.joinText')}</Text>
      </View>
    );
  }
  if (me.joined === false) {
    const why = (me as ContestMeNotJoined).reason;
    return (
      <View style={styles.board}>
        <Text style={styles.boardTitle}>{t('trip.me.joinTitle')}</Text>
        <Text style={styles.boardMuted}>{me.canJoin ? t('trip.me.joinText') : why === 'closed' ? t('trip.me.closed') : t('trip.me.cantJoin')}</Text>
      </View>
    );
  }
  const j = me as ContestMeJoined;
  if (j.disqualified) return <View style={styles.board}><Text style={styles.boardMuted}>{t('contest.dq')}</Text></View>;
  if (j.excluded) return <View style={styles.board}><Text style={styles.boardMuted}>{t('contest.excluded')}</Text></View>;
  const race = j.race;
  if (!race || race.rank === null || race.points <= 0) {
    return (
      <View style={styles.board} accessible accessibilityLabel={`${t('trip.me.notScored')}. ${t('trip.me.notScoredText')}`}>
        <View style={styles.boardTop}>
          <View style={styles.rankTagEmpty}><Ionicons name="flag-outline" size={20} color={LS.board} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.boardTitle}>{t('trip.me.notScored')}</Text>
            <Text style={styles.boardMuted}>{t(race?.part === 'final' ? 'trip.me.notScoredFinal' : 'trip.me.notScoredText')}</Text>
          </View>
        </View>
      </View>
    );
  }
  const moved = race.prevRank != null ? race.prevRank - race.rank : null;
  const final = race.part === 'final';
  const line = race.rank === 1 ? t('trip.me.leading')
    : race.gap === 0 ? t('trip.me.tie', { rank: race.rank - 1 })
    : t('trip.me.gap', { count: race.gap ?? 0, rank: race.rank - 1 });
  const above = race.gap != null ? race.points + race.gap : race.points;
  const pct = race.rank === 1 ? 1 : Math.max(0.04, Math.min(1, race.points / Math.max(1, above)));
  return (
    <View style={styles.board} accessible
          accessibilityLabel={`${t('trip.me.rank', { rank: race.rank })}. ${t('contest.pts', { count: race.points })}. ${line}`}>
      <View style={styles.boardTop}>
        <Text style={styles.rankTag}>#{race.rank}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.boardTitle}>{final ? t('trip.me.finalLive') : t('trip.me.inRace')}</Text>
          <Text style={styles.boardMuted}>{t('contest.pts', { count: race.points })} · {line}</Text>
        </View>
        {moved !== null && moved !== 0 && (
          <Text style={[styles.move, { color: moved > 0 ? '#7FD9A4' : '#FF9C8A' }]}>{moved > 0 ? `▲${moved}` : `▼${-moved}`}</Text>
        )}
      </View>
      <View style={styles.boardBar}><View style={[styles.boardBarFill, { width: `${pct * 100}%` }]} /></View>
      {final && race.headstart > 0 && <Text style={styles.boardMuted}>{t('trip.me.headstart', { count: race.headstart })}</Text>}
    </View>
  );
}

/** The one primary action of the moment. */
function PrimaryCta({ data, crew, onSection, onCta }: { data: ContestOverview; crew: Crew | null; onSection: (s: TripSection) => void; onCta: Cta }) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { t, i18n } = useTranslation('me');
  const { account, city } = useApp();
  const daily = useDailyToday(city?.channelId);
  const [busy, setBusy] = useState(false);
  const s = data.season!;
  const me = data.me;
  const signIn = () => { onCta('sign_in'); router.push('/auth-gate?reason=contest&returnTo=%2Ftrip' as never); };

  if (isOver(s)) {
    return <Button variant="secondary" icon="podium-outline" label={t('trip.cta.ranking')} onPress={() => { onCta('see_ranking'); onSection('ranking'); }} testID="trip-cta" />;
  }
  if (s.phase === 'upcoming') {
    const notified = me?.joined === true || !!(me && (me as ContestMeNotJoined).notified);
    if (!account) return <Button icon="notifications-outline" label={t('contest.notifyMe')} onPress={signIn} testID="trip-cta" />;
    return (
      <Button icon={notified ? 'checkmark-circle-outline' : 'notifications-outline'} variant={notified ? 'secondary' : 'primary'} loading={busy}
              label={t(notified ? 'contest.notifyOn' : 'contest.notifyMe')} testID="trip-cta"
              onPress={() => {
                if (notified || busy) return;
                onCta('notify');
                setBusy(true);
                notifyContest(s.id, i18n.language).then(setContestOverview).catch(() => {}).finally(() => setBusy(false));
              }} />
    );
  }
  if (!account || !me) return <Button icon="rocket-outline" label={t('trip.cta.signIn')} onPress={signIn} testID="trip-cta" />;
  if (me.joined === false) {
    return me.canJoin
      ? <Button icon="rocket-outline" label={t('trip.cta.join')} onPress={() => { onCta('join'); router.push('/contest-join' as never); }} testID="trip-cta" />
      : null;
  }
  if ((me as ContestMeJoined).disqualified || (me as ContestMeJoined).excluded) return null;
  const played = !!daily.data?.myProof;
  if (!played) {
    return <Button icon="camera-outline" label={t('trip.cta.play')} onPress={() => { onCta('play'); router.navigate('/(tabs)/today' as never); }} testID="trip-cta" />;
  }
  return (
    <View style={styles.played}>
      <View style={styles.playedRow}>
        <Ionicons name="checkmark-circle" size={IconSize.md} color={styles.playedText.color as string} />
        <Text style={styles.playedText}>{t('trip.cta.played')}</Text>
      </View>
      <Button icon="person-add-outline" label={t('trip.cta.invite')} testID="trip-cta"
              onPress={() => { onCta('invite', { friends: crew?.count ?? null }); onSection('friends'); }} />
    </View>
  );
}

/** Over: results being checked (the provisional top 3), then the winner once confirmed. */
function WinnerCard({ data, ranking }: { data: ContestOverview; ranking: ContestRanking | null }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('me');
  const s = data.season!;
  const reached = data.counter?.reached ?? false;
  const me = data.me?.joined === true ? (data.me as ContestMeJoined) : null;
  const w = s.winner;
  const name = w ? (w.username ? '@' + w.username : w.displayName ?? '') : '';
  return (
    <Card style={[styles.card, styles.cardReached, { alignItems: 'center' }]}>
      {w ? (
        <>
          <Crown size={34} />
          <Avatar uri={w.photoUrl} name={w.displayName ?? w.username ?? ''} size={88} />
          <Text style={[styles.cardTitle, { textAlign: 'center' }]} accessibilityRole="header">{t('trip.over.winnerTitle', { name })}</Text>
          <Text style={[styles.text, { textAlign: 'center' }]}>
            {reached ? t('trip.over.winnerTrip', { name, prize: s.prize?.title || s.name }) : t('trip.over.winnerFallback', { name, prize: s.fallbackPrize ?? '' })}
          </Text>
        </>
      ) : (
        <>
          <Ionicons name="hourglass-outline" size={34} color={styles.cardTitle.color as string} />
          <Text style={[styles.cardTitle, { textAlign: 'center' }]} accessibilityRole="header">{t('trip.over.title')}</Text>
          <Text style={[styles.muted, { textAlign: 'center' }]}>{t('trip.over.text')}</Text>
          {ranking && ranking.rows.length > 0 && <View style={{ alignSelf: 'stretch' }}><Podium rows={ranking.rows.slice(0, 3)} meId={me ? ranking.me?.userId ?? null : null} /></View>}
        </>
      )}
      {me?.finalRank ? <Text style={styles.youFinished}>{t('trip.over.yourRank', { rank: me.finalRank })}</Text> : null}
    </Card>
  );
}

// ── Ranking ───────────────────────────────────────────────────────────────────

export function TripRanking({ season: s, ranking, meId }: { season: ContestSeason; ranking: ContestRanking | null; meId: string | null }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('me');
  const final = ranking?.phase === 'final';
  const hs = s.rules.headstartTopN;
  const mine = ranking?.me ?? null;
  const rows = ranking?.rows ?? [];
  const meInList = !!mine && rows.some(r => r.userId === mine.userId);
  return (
    <View style={styles.stack}>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle} accessibilityRole="header">{t(final ? 'trip.ranking.final' : 'trip.ranking.before')}</Text>
        {s.phase === 'final' && (
          <View style={styles.livePill} accessible accessibilityLabel={t('trip.ranking.live')}>
            <View style={styles.liveDot} /><Text style={styles.liveText}>{t('trip.ranking.live')}</Text>
          </View>
        )}
      </View>
      {mine && mine.rank && (
        <View style={styles.pinned}>
          <Text style={styles.pinnedLabel}>{t('trip.ranking.you')}</Text>
          <RaceRow row={mine} me bonus={final ? mine.headstart : 0} />
        </View>
      )}
      {!ranking ? <Text style={styles.muted}>…</Text> : rows.length === 0 ? (
        <Card style={styles.card}>
          <Text style={styles.text}>{s.phase === 'upcoming' ? t('trip.ranking.emptyUpcoming', { date: contestDate(s.startDate, i18n.language) }) : t('trip.ranking.empty')}</Text>
        </Card>
      ) : (
        <Card style={styles.card}>
          <Podium rows={rows.slice(0, 3)} meId={meId} bonusFor={row => (final ? row.headstart : 0)} />
          <View style={{ marginTop: Space.sm }}>
            {rows.slice(3).map(r => <RaceRow key={r.userId} row={r} me={r.userId === meId} bonus={final ? r.headstart : 0} />)}
          </View>
          {mine && mine.rank && !meInList && <Text style={[styles.muted, { textAlign: 'center' }]}>…</Text>}
        </Card>
      )}
      <View style={styles.note}>
        <Ionicons name="flag-outline" size={IconSize.md} color={colors.primaryOnTint} />
        <Text style={styles.noteText}>
          {final ? t('trip.ranking.noteFinal', { date: contestDate(s.finalWeekStart, i18n.language), count: hs, end: contestDate(s.endDate, i18n.language) })
            : t('trip.ranking.noteBefore', { date: contestDate(s.finalWeekStart, i18n.language), count: hs })}
          {' '}{t('trip.ranking.ties')}
        </Text>
      </View>
    </View>
  );
}

/** One ranked player: rank, avatar, name (+ You, + head-start), movement since yesterday, points. */
function RaceRow({ row, me, bonus = 0 }: { row: ContestRow; me: boolean; bonus?: number }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('me');
  const router = useRouter();
  const name = row.username ? '@' + row.username : row.displayName ?? '';
  const moved = row.prevRank != null ? row.prevRank - row.rank : null;
  const move = moved === null ? (row.prevRank === null && row.rank ? t('trip.ranking.new') : null) : moved > 0 ? `▲${moved}` : moved < 0 ? `▼${-moved}` : null;
  const moveA11y = moved === null ? (move ? t('trip.ranking.new') : '') : moved > 0 ? t('trip.ranking.up', { count: moved }) : moved < 0 ? t('trip.ranking.down', { count: -moved }) : '';
  return (
    <Pressable style={[styles.raceRow, me && styles.raceRowMe]} onPress={() => router.push({ pathname: '/user/[id]', params: { id: row.userId } })}
               accessibilityRole="button" accessibilityLabel={`#${row.rank} ${name}${me ? `, ${t('contest.youLabel')}` : ''}, ${t('contest.pts', { count: row.points })}${moveA11y ? `, ${moveA11y}` : ''}`}>
      <Text style={styles.raceNum}>{row.rank}</Text>
      <Avatar uri={row.photoUrl} name={row.displayName ?? row.username ?? ''} size={36} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.nameRow}>
          <Text style={[styles.text, { fontWeight: '700', flexShrink: 1 }]} numberOfLines={1}>{me ? t('contest.youLabel') : name}</Text>
          {bonus > 0 && <Text style={styles.hs}>{t('contest.hsBadge', { count: bonus })}</Text>}
        </View>
      </View>
      {move && <Text style={[styles.raceMove, { color: moved === null ? colors.primaryText : moved > 0 ? colors.green : colors.red }]}>{move}</Text>}
      <Text style={styles.racePts}>{row.points}</Text>
    </Pressable>
  );
}

// ── Friends ───────────────────────────────────────────────────────────────────

export function TripFriends({ season: s, crew, onCta }: { season: ContestSeason; crew: Crew | null; onCta: Cta }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation('me');
  const { account } = useApp();
  const pts = s.points;
  const friendPts = crew?.points.friend ?? pts?.friend ?? 10;
  const crewPts = crew?.points.crew ?? pts?.crew ?? 50;
  const max = crew?.max ?? pts?.friendsPerMonth ?? 5;
  const [busy, setBusy] = useState(false);
  const share = async () => {
    if (!crew || busy) return;
    onCta('share_invite', { friends: crew.count });
    setBusy(true);
    try { await shareTo('share_sheet', { file: null, url: crew.link, text: t('invite.shareLine') }); } catch { /* cancelled */ } finally { setBusy(false); }
  };
  const steps = [
    { icon: 'share-social-outline' as const, text: t('trip.friends.step1') },
    { icon: 'person-add-outline' as const, text: t('trip.friends.step2') },
    { icon: 'camera-outline' as const, text: t('trip.friends.step3', { points: friendPts }) },
  ];
  return (
    <View style={styles.stack}>
      <Card style={styles.card}>
        <Text style={styles.cardTitle} accessibilityRole="header">{t('trip.friends.title', { points: friendPts })}</Text>
        <View style={styles.steps}>
          {steps.map((st, i) => (
            <View key={i} style={styles.stepBox} accessible accessibilityLabel={`${i + 1}. ${st.text}`}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View>
              <Ionicons name={st.icon} size={26} color={colors.primaryText} />
              <Text style={styles.stepText}>{st.text}</Text>
            </View>
          ))}
        </View>
      </Card>

      {!account ? (
        <Card style={styles.card}>
          <Text style={styles.text}>{t('trip.friends.signIn')}</Text>
          <Button icon="person-add-outline" label={t('trip.cta.signIn')} onPress={() => { onCta('sign_in'); router.push('/auth-gate?reason=invite&returnTo=%2Ftrip' as never); }} />
        </Card>
      ) : (
        <>
          <Card style={styles.card}>
            <View style={styles.slots} accessible accessibilityLabel={t('trip.friends.slots', { count: crew?.count ?? 0, max })}>
              {Array.from({ length: max }).map((_, i) => {
                const ok = i < (crew?.count ?? 0);
                const last = i === max - 1;
                return (
                  <View key={i} style={[styles.slot, ok && styles.slotOn]}>
                    {ok ? <Ionicons name="checkmark" size={20} color={colors.green} />
                      : last ? <Text style={styles.slotBonus}>+{crewPts}</Text>
                      : <Ionicons name="add" size={18} color={colors.muted} />}
                  </View>
                );
              })}
            </View>
            <Text style={styles.text}>{t('trip.friends.slots', { count: crew?.count ?? 0, max })}</Text>
            <Text style={styles.muted}>{crew?.bonus ? t('trip.friends.crewDone', { points: crewPts }) : t('trip.friends.crew', { size: max, points: crewPts })}</Text>
            <Button icon="share-outline" label={t('trip.friends.share')} onPress={share} loading={busy} disabled={!crew} testID="trip-share-invite" />
          </Card>
          <Card style={styles.card}>
            <Text style={styles.cardTitle} accessibilityRole="header">{t('trip.friends.list')}</Text>
            {!crew || crew.friends.length === 0 ? <Text style={styles.muted}>{t('trip.friends.none')}</Text> : crew.friends.map(f => {
              const status = f.status ?? (f.credited ? 'credited' : 'joined');
              return (
                <View key={f.id} style={styles.friendRow}>
                  <Avatar uri={f.photoUrl} name={f.displayName ?? f.username ?? ''} size={36} />
                  <Text style={[styles.text, { flex: 1, fontWeight: '700' }]} numberOfLines={1}>{f.username ? '@' + f.username : f.displayName ?? ''}</Text>
                  <Text style={[styles.friendStatus, status === 'credited' && { color: colors.green, backgroundColor: colors.localBg }]} numberOfLines={1}>
                    {status === 'credited' ? t('trip.friends.status.credited', { points: friendPts }) : t(`trip.friends.status.${status}`)}
                  </Text>
                </View>
              );
            })}
          </Card>
        </>
      )}
    </View>
  );
}

// ── Rules ─────────────────────────────────────────────────────────────────────

export function TripRules({ season: s, counter, onCta }: { season: ContestSeason; counter: ContestOverview['counter'] | null; onCta: Cta }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('me');
  const d = (x: string) => contestDate(x, i18n.language);
  const p = s.points ?? { play: 10, podium: [30, 20, 10] as [number, number, number], week: 30, friend: 10, crew: 50, crewSize: 5, friendsPerMonth: 5 };
  const hs = s.rules.headstartTopN;
  const table: [string, string][] = [
    [t('trip.rules.play'), `+${p.play}`],
    [t('trip.rules.podium'), `+${p.podium[0]} / +${p.podium[1]} / +${p.podium[2]}`],
    [t('trip.rules.week'), `+${p.week}`],
    [t('trip.rules.friend', { count: p.friendsPerMonth }), `+${p.friend}`],
    [t('trip.rules.crew', { size: p.crewSize }), `+${p.crew}`],
  ];
  return (
    <View style={styles.stack}>
      <Card style={styles.card}>
        <Text style={styles.cardTitle} accessibilityRole="header">{t('trip.rules.howTitle')}</Text>
        {[t('trip.rules.how1'), t('trip.rules.how2', { count: hs, date: d(s.finalWeekStart) }), t('trip.rules.how3', { date: d(s.endDate) })].map((line, i) => (
          <View key={i} style={styles.howRow}>
            <View style={[styles.howNum, i === 2 && { backgroundColor: colors.medalGold }]}><Text style={[styles.howNumText, i === 2 && { color: colors.onMedal }]}>{i + 1}</Text></View>
            <Text style={[styles.text, { flex: 1 }]}>{line}</Text>
          </View>
        ))}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle} accessibilityRole="header">{t('trip.rules.pointsTitle')}</Text>
        {table.map(([label, value], i) => (
          <View key={i} style={styles.tableRow} accessible accessibilityLabel={`${label}: ${value}`}>
            <Text style={[styles.text, { flex: 1 }]}>{label}</Text>
            <Text style={styles.tableValue}>{value}</Text>
          </View>
        ))}
        <Text style={styles.muted}>{t('trip.rules.pointsNote', { date: d(s.startDate) })}</Text>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle} accessibilityRole="header">{t('trip.rules.finalTitle')}</Text>
        <Text style={styles.text}>{t('trip.rules.final1', { date: d(s.finalWeekStart) })}</Text>
        {hs > 0 && <Text style={styles.text}>{t('trip.rules.final2', { count: hs })}</Text>}
        <Text style={styles.text}>{t('trip.rules.final3')}</Text>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle} accessibilityRole="header">{t('trip.rules.prizeTitle')}</Text>
        <Text style={[styles.text, { fontWeight: '800' }]}>{s.prize?.title || s.name}</Text>
        {!!s.prize?.subtitle && <Text style={styles.text}>{s.prize.subtitle}</Text>}
        {!!s.prize?.description && <Text style={styles.muted}>{s.prize.description}</Text>}
        <SouvenirLine souvenir={s.souvenir} />
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle} accessibilityRole="header">{t('trip.rules.goalTitle')}</Text>
        <Text style={styles.text}>{t('trip.rules.goalText', { players: counter?.threshold ?? 500, photos: counter?.photos ?? 10 })}</Text>
        <Text style={styles.text}>{t('trip.rules.fallbackText', { date: d(s.endDate), prize: s.fallbackPrize ?? '' })}</Text>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle} accessibilityRole="header">{t('trip.rules.whoTitle')}</Text>
        {[t('trip.rules.who1'), t('trip.rules.who2'), t('trip.rules.who3'), t('trip.rules.who4')].map((line, i) => (
          <View key={i} style={styles.whoRow}>
            <Ionicons name="checkmark" size={IconSize.sm} color={colors.green} />
            <Text style={[styles.text, { flex: 1 }]}>{line}</Text>
          </View>
        ))}
      </Card>

      <Button variant="secondary" icon="document-text-outline" label={t('trip.rules.full')} testID="trip-rules-full"
              onPress={() => { onCta('rules_full'); Linking.openURL(s.rulesUrl); }} />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

// The status card is a fixed dark "departure board" (LS) in every theme, like the share cards.
const makeStyles = (c: ThemeColors) => StyleSheet.create({
  stack:      { gap: Space.md },
  card:       { padding: Space.md, gap: Space.sm },
  cardReached:{ borderWidth: 2, borderColor: c.medalGold },
  cardTitle:  { ...Type.label, color: c.text },
  text:       { ...Type.body, color: c.text },
  muted:      { ...Type.caption, color: c.muted },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  testNote:   { flexDirection: 'row', alignItems: 'center', gap: Space.xs, backgroundColor: LS.lantern, borderRadius: Radius.inner, padding: Space.sm },
  testNoteText: { ...Type.caption, color: '#FFFFFF', flex: 1 },
  // Phase timeline.
  timeline:   { flexDirection: 'row', gap: Space.sm },
  phase:      { flex: 1, alignItems: 'center', gap: 2, paddingVertical: Space.sm, paddingHorizontal: Space.xs, borderRadius: 16, backgroundColor: c.primaryTint },
  phaseOn:    { backgroundColor: c.cta },
  phaseDone:  { opacity: 0.6 },
  phaseTitle: { ...Type.caption, fontWeight: '800', color: c.text, textAlign: 'center' },
  phaseWhen:  { ...Type.caption, fontSize: 11, lineHeight: 14, color: c.muted, textAlign: 'center' },
  // Goal.
  goalCount:  { flexDirection: 'row', alignItems: 'baseline', gap: Space.xs },
  goalN:      { ...Type.display, color: c.text, fontVariant: ['tabular-nums'] },
  goalOf:     { ...Type.label, fontSize: 15, color: c.muted },
  track:      { height: 34, justifyContent: 'center', marginRight: 26 },
  trackBg:    { position: 'absolute', left: 0, right: 0, height: 12, borderRadius: 6, backgroundColor: c.primaryTint },
  trackFill:  { position: 'absolute', left: 0, height: 12, borderRadius: 6, backgroundColor: c.cta },
  trackPlane: { position: 'absolute', left: -11, top: 6 },
  trackGift:  { position: 'absolute', right: -28, top: 5 },
  fallback:   { flexDirection: 'row', gap: Space.xs, alignItems: 'flex-start', backgroundColor: c.primaryTint, borderRadius: Radius.inner, padding: Space.sm },
  fallbackText: { ...Type.caption, color: c.primaryOnTint, flex: 1 },
  // My status (the dark board).
  board:      { backgroundColor: LS.board, borderRadius: Radius.card, padding: Space.md, gap: Space.sm },
  boardTop:   { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  boardTitle: { ...Type.label, color: LS.boardText },
  boardMuted: { ...Type.caption, color: LS.boardMuted },
  rankTag:    { ...Type.title, color: c.onMedal, backgroundColor: c.medalGold, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, overflow: 'hidden',
                transform: [{ rotate: '-4deg' }], fontVariant: ['tabular-nums'] },
  rankTagEmpty: { width: 44, height: 44, borderRadius: 12, backgroundColor: LS.mango, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-4deg' }] },
  move:       { ...Type.label, fontVariant: ['tabular-nums'] },
  boardBar:   { height: 8, borderRadius: 4, backgroundColor: LS.boardTile, overflow: 'hidden' },
  boardBarFill: { height: 8, borderRadius: 4, backgroundColor: c.medalGold },
  played:     { gap: Space.sm },
  playedRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.xs },
  playedText: { ...Type.label, fontSize: 15, color: c.green },
  youFinished:{ ...Type.label, color: c.primaryText },
  // Ranking.
  livePill:   { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.primaryTint, borderRadius: Radius.control, paddingHorizontal: Space.sm, paddingVertical: 3 },
  liveDot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: c.red },
  liveText:   { ...Type.caption, fontWeight: '800', color: c.primaryOnTint },
  pinned:     { gap: Space.xs },
  pinnedLabel:{ ...Type.caption, color: c.muted },
  raceRow:    { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.sm, minHeight: 52, borderTopWidth: 1, borderTopColor: c.line },
  raceRowMe:  { backgroundColor: c.primaryTint, borderRadius: Radius.inner, paddingHorizontal: Space.sm, borderTopWidth: 0 },
  raceNum:    { ...Type.label, fontSize: 15, color: c.muted, width: 26, textAlign: 'center', fontVariant: ['tabular-nums'] },
  raceMove:   { ...Type.caption, fontWeight: '800', fontVariant: ['tabular-nums'] },
  racePts:    { ...Type.label, fontSize: 16, color: c.text, minWidth: 40, textAlign: 'right', fontVariant: ['tabular-nums'] },
  nameRow:    { flexDirection: 'row', alignItems: 'center', gap: Space.xs, flexWrap: 'wrap' },
  hs:         { ...Type.caption, fontSize: 11, lineHeight: 15, fontWeight: '800', color: c.text, backgroundColor: c.goldTint, borderRadius: Radius.control,
                paddingHorizontal: 7, paddingVertical: 1, overflow: 'hidden' },
  note:       { flexDirection: 'row', gap: Space.sm, alignItems: 'flex-start', backgroundColor: c.primaryTint, borderRadius: Radius.card, padding: Space.md },
  noteText:   { ...Type.body, color: c.primaryOnTint, flex: 1 },
  // Friends.
  steps:      { flexDirection: 'row', gap: Space.sm },
  stepBox:    { flex: 1, alignItems: 'center', gap: Space.xs, backgroundColor: c.bg, borderRadius: 16, padding: Space.sm, paddingTop: Space.md },
  stepNum:    { position: 'absolute', top: -8, width: 22, height: 22, borderRadius: 11, backgroundColor: c.cta, alignItems: 'center', justifyContent: 'center' },
  stepNumText:{ ...Type.caption, fontSize: 12, lineHeight: 15, fontWeight: '900', color: c.onCta },
  stepText:   { ...Type.caption, color: c.text, textAlign: 'center' },
  slots:      { flexDirection: 'row', gap: Space.xs },
  slot:       { flex: 1, height: 42, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: c.line, alignItems: 'center', justifyContent: 'center' },
  slotOn:     { borderStyle: 'solid', borderColor: c.green, backgroundColor: c.localBg },
  slotBonus:  { ...Type.caption, fontWeight: '900', color: c.primaryText },
  friendRow:  { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 48 },
  friendStatus: { ...Type.caption, color: c.muted, backgroundColor: c.bg, borderRadius: Radius.control, paddingHorizontal: Space.sm, paddingVertical: 3, overflow: 'hidden', maxWidth: '50%' },
  // Rules.
  howRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm },
  howNum:     { width: 26, height: 26, borderRadius: 13, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  howNumText: { ...Type.caption, fontWeight: '900', color: c.primaryOnTint },
  tableRow:   { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.xs, borderTopWidth: 1, borderTopColor: c.line },
  tableValue: { ...Type.label, fontSize: 16, color: c.primaryText, fontVariant: ['tabular-nums'] },
  whoRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm },
});
