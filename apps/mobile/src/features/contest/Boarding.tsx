import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, Text, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Space, Radius, Type, IconSize, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { Avatar, Card, Sheet, SheetScrollView, SheetTitle } from '@/ui';
import { SharePanel } from '@/features/share/SharePanel';
import type { ShareContent } from '@/features/share/content';
import { contestDate, contestGoal, type ContestMeJoined, type ContestOverview, type ContestSeason } from './contest';
import { BoardingTicket } from './BoardingTicket';

/**
 * Boarding on the Trip's Overview, one row: the latest players' avatars, "186 players on board"
 * (below the server's showFrom: "Be among the first to board", never a count near 0) and Invite.
 * With a players' goal (Admin › Launch Season, may be empty), one short line under it: "Trip unlocks
 * at 500 players · details". The row opens the Boarding sheet: the whole explanation (the goal and
 * its progress, my boarding pass, what happens if it isn't reached) and the invite share right there.
 * Without a goal, nothing says "unlock" or "takes off": the prize is unconditional.
 */
type Counter = NonNullable<ContestOverview['counter']>;
const isOver = (s: ContestSeason) => s.phase === 'over' || s.phase === 'ended';

export function boardingState(counter: Counter) {
  const goal = contestGoal(counter);
  const reached = goal === null || (counter.reached ?? counter.players >= goal);
  const showCount = counter.players > 0 && (counter.players >= (counter.showFrom ?? 0) || (goal !== null && reached));
  return { goal, reached, showCount };
}

export function BoardingRow({ season: s, counter, onOpen, onInvite }: {
  season: ContestSeason; counter: Counter; onOpen: () => void; onInvite: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('me');
  const { goal, reached, showCount } = boardingState(counter);
  const status = showCount ? t('trip.board.onBoard', { count: counter.players }) : t('trip.board.first');
  const faces = (counter.recent ?? []).slice(0, 4);
  return (
    <Card style={styles.card}>
      <Pressable onPress={onOpen} style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]} accessibilityRole="button"
                 accessibilityLabel={status} accessibilityHint={t('trip.board.a11yOpen')} testID="trip-boarding">
        {faces.length > 0 && showCount ? (
          <View style={[styles.faces, { width: 28 + (faces.length - 1) * 18 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {faces.map((f, i) => (
              <View key={f.userId} style={[styles.face, { left: i * 18, zIndex: 10 - i }]}>
                <Avatar uri={f.photoUrl} name={f.name ?? ''} size={28} />
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.planeDot}><Ionicons name="airplane" size={16} color={colors.onCta} /></View>
        )}
        <Text style={[styles.status, !showCount && { color: colors.primaryText }]} numberOfLines={2}>{status}</Text>
        <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); onInvite(); }}
                   style={({ pressed }) => [styles.invite, pressed && { opacity: 0.8 }]} accessibilityRole="button" hitSlop={6} testID="trip-boarding-invite">
          <Ionicons name="person-add-outline" size={IconSize.sm} color={colors.onCta} />
          <Text style={styles.inviteText} numberOfLines={1}>{t('trip.board.invite')}</Text>
        </Pressable>
      </Pressable>
      {goal !== null && !isOver(s) && (
        <Pressable onPress={onOpen} accessibilityRole="button" hitSlop={4} style={styles.unlock} testID="trip-unlock-line">
          <Ionicons name={reached ? 'lock-open' : 'lock-closed-outline'} size={14} color={reached ? colors.green : colors.muted} />
          <Text style={styles.unlockText} numberOfLines={1}>
            {reached ? t('trip.board.unlocked') : t('trip.board.unlockLine', { count: goal })}
            <Text style={styles.unlockLink}>{' · '}{t('trip.board.details')}</Text>
          </Text>
        </Pressable>
      )}
    </Card>
  );
}

/** The Boarding sheet: the explanation, then my invite share (the Boarding card and the targets). */
export function BoardingSheet({ visible, season: s, counter, me, buildShare, onClose }: {
  visible: boolean; season: ContestSeason; counter: Counter; me: ContestOverview['me'] | null;
  buildShare: () => Promise<ShareContent | null>; onClose: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('me');
  const router = useRouter();
  const { account } = useApp();
  const { goal, reached, showCount } = boardingState(counter);
  const [content, setContent] = useState<ShareContent | null>(null);
  useEffect(() => {
    if (!visible) return;
    buildShare().then(setContent).catch(() => {});
  }, [visible]);   // eslint-disable-line react-hooks/exhaustive-deps

  const pct = goal === null ? 1 : showCount ? Math.min(1, counter.players / Math.max(1, goal)) : 0;
  const status = !showCount ? t('trip.board.first')
    : goal !== null ? t('trip.board.seats', { players: counter.players, threshold: goal }) : t('trip.board.onBoard', { count: counter.players });
  const fallback = s.fallbackPrize ?? '';
  const signUp = () => { onClose(); router.push(`/auth-gate?reason=contest&returnTo=${encodeURIComponent(s.phase === 'upcoming' ? '/trip' : '/contest-join')}` as never); };

  return (
    <Sheet visible={visible} onClose={onClose} closeLabel={t('back', { ns: 'daily' })}>
      <SheetScrollView contentContainerStyle={styles.sheet} testID="trip-boarding-sheet">
        <SheetTitle>{goal !== null && reached ? t('trip.board.full') : t('trip.board.title')}</SheetTitle>
        <Text style={showCount ? styles.seats : styles.seatsFirst}>{status}</Text>
        {goal !== null && <Track pct={pct} reached={reached} />}
        <Text style={styles.muted}>
          {goal === null ? t('trip.board.noGoalText')
            : reached ? t('trip.board.fullText') : `${t('trip.board.takeoff', { count: goal })} ${t('trip.board.what', { photos: counter.photos })}`}
        </Text>

        {/* My boarding pass (the ticket), or a guest's waiting for its passenger. */}
        {!isOver(s) && <TripTicket season={s} counter={counter} me={me} onPress={account ? () => {} : signUp} />}

        {goal !== null && !reached && (
          <View style={styles.fallback}>
            <Ionicons name="gift-outline" size={IconSize.sm} color={colors.primaryOnTint} />
            <Text style={styles.fallbackText}>
              {isOver(s) ? t('trip.board.notFullText', { prize: fallback }) : t('trip.board.fallback', { date: contestDate(s.endDate, i18n.language), prize: fallback })}
            </Text>
          </View>
        )}

        <Text style={[styles.inviteTitle]} accessibilityRole="header">{t('trip.board.inviteTitle')}</Text>
        <Text style={styles.muted}>{account ? t('trip.board.inviteText') : t('trip.board.inviteTextGuest')}</Text>
        {content ? <SharePanel content={content} source="trip_boarding" compact previewHeight={250} /> : <View style={{ height: 120 }} />}
      </SheetScrollView>
    </Sheet>
  );
}

/**
 * My boarding pass ticket from the overview: a guest's (passenger "You? 👀", the next free seat), a member
 * who hasn't joined yet (my handle, the next seat), or mine (my seat, my photos with a goal, the stamp).
 */
export function TripTicket({ season: s, counter, me, onPress }: {
  season: ContestSeason; counter: Counter; me: ContestOverview['me'] | null; onPress: () => void;
}) {
  const { account, city } = useApp();
  const goal = contestGoal(counter);
  const joined = account && me?.joined === true && !(me as ContestMeJoined).excluded && !(me as ContestMeJoined).disqualified ? (me as ContestMeJoined) : null;
  const photos = joined && goal !== null ? { n: joined.photos ?? 0, of: counter.photos } : null;
  const earned = !!joined && (goal === null || (joined.photos ?? 0) >= counter.photos);
  const handle = account ? (account.username ? '@' + account.username : account.display_name ?? null) : null;
  return (
    <BoardingTicket seasonId={s.id} from={city?.name ?? null} destination={s.tab?.destination || 'Vietnam'} startDate={s.startDate}
                    seat={joined?.seat ?? counter.seatNext ?? counter.players + 1} passenger={handle} photos={photos} earned={earned}
                    onPress={onPress} testID="trip-ticket" />
  );
}

/** "Create your account to get your boarding pass": the friendly locked card for people without an account. */
export function LockedPass({ onPress, text }: { onPress: () => void; text?: string }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('me');
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.locked, pressed && { opacity: 0.85 }]} accessibilityRole="button" testID="trip-locked">
      <View style={styles.lockedIcon}><Ionicons name="ticket-outline" size={20} color={colors.primaryText} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.lockedTitle}>{text ?? t('trip.board.locked')}</Text>
        <Text style={styles.muted}>{t('trip.board.lockedText')}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.primaryText} />
    </Pressable>
  );
}

function Track({ pct, reached }: { pct: number; reached: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
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
  return (
    <View style={styles.track} onLayout={e => setWidth(e.nativeEvent.layout.width)} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.trackBg} />
      <View style={[styles.trackFill, { width: `${pct * 100}%` }]} />
      <Animated.View style={[styles.trackPlane, { transform: [{ translateX: pos }] }]}>
        <Ionicons name="airplane" size={22} color={colors.primaryText} />
      </Animated.View>
      <View style={styles.trackGift}><Ionicons name="gift" size={22} color={reached ? colors.medalGold : colors.muted} /></View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:       { paddingVertical: Space.sm, paddingHorizontal: Space.md, gap: Space.xs },
  row:        { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 48 },
  faces:      { height: 32 },
  face:       { position: 'absolute', top: 0, borderRadius: 16, borderWidth: 2, borderColor: c.bg2, overflow: 'hidden' },
  planeDot:   { width: 32, height: 32, borderRadius: 16, backgroundColor: c.cta, alignItems: 'center', justifyContent: 'center' },
  status:     { ...Type.label, fontSize: 16, color: c.text, flex: 1, fontVariant: ['tabular-nums'] },
  invite:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.cta, borderRadius: Radius.control, paddingHorizontal: Space.md, minHeight: 38 },
  inviteText: { ...Type.caption, fontWeight: '800', color: c.onCta },
  unlock:     { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: Space.xs, borderTopWidth: 1, borderTopColor: c.line, minHeight: 32 },
  unlockText: { ...Type.caption, color: c.muted, flex: 1 },
  unlockLink: { fontWeight: '800', color: c.primaryText },
  sheet:      { gap: Space.sm, paddingBottom: Space.lg },
  seats:      { ...Type.title, color: c.text, fontVariant: ['tabular-nums'] },
  seatsFirst: { ...Type.title, color: c.primaryText },
  muted:      { ...Type.caption, color: c.muted },
  inviteTitle:{ ...Type.label, color: c.text, marginTop: Space.sm },
  locked:     { flexDirection: 'row', alignItems: 'center', gap: Space.sm, padding: Space.md, borderRadius: Radius.card,
                borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.primaryText, backgroundColor: c.primaryTint, minHeight: 64 },
  lockedIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-4deg' }] },
  lockedTitle:{ ...Type.label, fontSize: 15, color: c.primaryOnTint },
  track:      { height: 34, justifyContent: 'center', marginRight: 26 },
  trackBg:    { position: 'absolute', left: 0, right: 0, height: 12, borderRadius: 6, backgroundColor: c.primaryTint },
  trackFill:  { position: 'absolute', left: 0, height: 12, borderRadius: 6, backgroundColor: c.cta },
  trackPlane: { position: 'absolute', left: -11, top: 6 },
  trackGift:  { position: 'absolute', right: -28, top: 5 },
  fallback:   { flexDirection: 'row', gap: Space.xs, alignItems: 'flex-start', backgroundColor: c.primaryTint, borderRadius: Radius.inner, padding: Space.sm },
  fallbackText: { ...Type.caption, color: c.primaryOnTint, flex: 1 },
});
