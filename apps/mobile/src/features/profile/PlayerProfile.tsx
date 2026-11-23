import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { Space, Radius, Type, Gutter, IconSize, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { Avatar, Button, Crown, EmptyState, Photo } from '@/ui';
import { FlagSticker, themeColor } from '@/ui/joy';
import { RankMedal } from '@/features/daily/RankMedal';
import { CityPage } from '@/features/passport/CityPage';
import { SpecialStamps } from '@/features/passport/SpecialStamps';
import { PioneerBadges } from '@/features/passport/PioneerBadges';
import { SeasonMedals } from '@/features/passport/ScoringCards';
import { ReportModal } from '@/features/profile/ReportModal';
import { ProfileActionSheet } from '@/features/profile/ProfileActionSheet';
import { EventPill } from '@/features/events/EventPill';
import { openPhotoFeed } from '@/features/daily/openFeed';
import { themeName } from '@/features/daily/themes';
import { shortCityName } from '@/i18n/cityName';
import { fetchPublicProfile, fetchUserEvents, fetchUserFriends, removeFriend } from '@/api/users';
import { acceptFriendRequest, cancelFriendRequest, sendFriendRequest } from '@/api/friendRequests';
import { fetchUserDaily } from '@/api/daily';
import { fetchProfileCard, type Duel, type ProfileCard } from '@/api/profile';
import { fetchReportStatus, type ExistingReport } from '@/api/reports';
import { submitBlock } from '@/api/blocks';
import { socket } from '@/lib/socket';
import { goBack } from '@/lib/nav';
import { track } from '@/services/analytics';
import type { DailyLocalPassProgress, DailyUserStats, HiladsEvent, PublicProfile } from '@/types';

type FriendState = 'none' | 'pending_out' | 'pending_in' | 'friend';

/**
 * The player profile, a "mini Passport" (docs/mockups/hilads_profile_mockup.html): who they
 * are, where they stand in the game, their photos and you vs them. The same screen for my own
 * profile preview ("View as others see me": `preview`, no actions, no duel).
 *
 * Data: GET /users/{id} (identity, friendship), /users/{id}/daily (streak, stats, stamps, Local
 * Pass, Pioneer, season medals), /users/{id}/card (wins, this season's ranks as in World, the
 * best photos, the duels), /users/{id}/friends (the count), /users/{id}/events (plans they host).
 */
export function PlayerProfile({ userId, preview = false }: { userId: string; preview?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('publicProfile');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { account, identity, addBlocked, removeBlocked } = useApp();
  const isSelf = account?.id === userId;
  const showActions = !preview && !isSelf && !!account;

  const [user, setUser] = useState<PublicProfile | null>(null);
  const [stats, setStats] = useState<DailyUserStats | null>(null);
  const [card, setCard] = useState<ProfileCard | null>(null);
  const [friends, setFriends] = useState<number | null>(null);
  const [plans, setPlans] = useState<HiladsEvent[]>([]);
  const [failed, setFailed] = useState<'gone' | 'error' | null>(null);
  const [friendState, setFriendState] = useState<FriendState>('none');
  const [pendingReqId, setPendingReqId] = useState<string | null>(null);
  const [friendBusy, setFriendBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [report, setReport] = useState(false);
  const [existingReport, setExistingReport] = useState<ExistingReport | null>(null);
  // Past the cover: a compact bar (handle, back, ⋯) so nothing scrolls under the status bar.
  const [scrolled, setScrolled] = useState(false);

  const load = useCallback(() => {
    setFailed(null);
    fetchPublicProfile(userId).then(u => {
      setUser(u);
      if (u.isFriend) { setFriendState('friend'); setPendingReqId(null); }
      else if (u.pendingFriendRequest) {
        setFriendState(u.pendingFriendRequest.direction === 'outgoing' ? 'pending_out' : 'pending_in');
        setPendingReqId(u.pendingFriendRequest.id);
      } else { setFriendState('none'); setPendingReqId(null); }
    }).catch((e: { status?: number }) => setFailed(e?.status === 404 || e?.status === 403 ? 'gone' : 'error'));
    fetchUserDaily(userId).then(setStats).catch(() => {});
    fetchProfileCard(userId).then(setCard).catch(() => {});
    fetchUserFriends(userId, 1, 1).then(f => setFriends(f.total)).catch(() => {});
    // Plans they host, still to come (Hi plans are live on the Map).
    fetchUserEvents(userId).then(evs => {
      const now = Date.now() / 1000;
      setPlans(evs.filter(e => e.created_by === userId && (e.ends_at ?? e.starts_at) > now).slice(0, 3));
    }).catch(() => {});
    if (showActions) {
      fetchReportStatus({ targetUserId: userId }).then(r => setExistingReport(r.reported ? (r.existing ?? null) : null)).catch(() => {});
    }
  }, [userId, showActions]);
  useEffect(() => { load(); track('viewed_profile', { self: isSelf, preview }); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  // The other player answers my request while I'm here.
  useEffect(() => {
    if (!user || !showActions) return;
    const offs = [
      socket.on('friendRequestAccepted', d => { if (d.requestId === pendingReqId) { setFriendState('friend'); setPendingReqId(null); } }),
      socket.on('friendRequestDeclined', d => { if (d.requestId === pendingReqId) { setFriendState('none'); setPendingReqId(null); } }),
      socket.on('friendRequestCancelled', d => { if (d.requestId === pendingReqId) { setFriendState('none'); setPendingReqId(null); } }),
      socket.on('friendRequestReceived', d => {
        const req = d.request as { id: string; sender_id: string } | undefined;
        if (req && req.sender_id === user.id) { setFriendState('pending_in'); setPendingReqId(req.id); }
      }),
    ];
    return () => offs.forEach(off => off());
  }, [user, pendingReqId, showActions]);

  const handle = user?.username ? `@${user.username}` : user?.displayName ?? '';

  const friendPress = () => {
    if (!user || friendBusy) return;
    const run = async (fn: () => Promise<void>) => { setFriendBusy(true); try { await fn(); } catch { /* unchanged */ } finally { setFriendBusy(false); } };
    if (friendState === 'friend') {
      Alert.alert(t('unfriendTitle'), t('unfriendBody', { name: handle }), [
        { text: t('cancel', { ns: 'common' }), style: 'cancel' },
        { text: t('unfriendConfirm'), style: 'destructive', onPress: () => run(async () => { await removeFriend(user.id); setFriendState('none'); }) },
      ]);
    } else if (friendState === 'pending_out') {
      Alert.alert(t('cancelReqTitle'), t('cancelReqBody', { name: handle }), [
        { text: t('keep'), style: 'cancel' },
        { text: t('cancelReqConfirm'), style: 'destructive', onPress: () => run(async () => {
          if (pendingReqId) await cancelFriendRequest(pendingReqId);
          setFriendState('none'); setPendingReqId(null);
        }) },
      ]);
    } else if (friendState === 'pending_in') {
      run(async () => { if (pendingReqId) await acceptFriendRequest(pendingReqId); setFriendState('friend'); setPendingReqId(null); });
    } else {
      run(async () => {
        const r = await sendFriendRequest(user.id);
        if (r.friend) { setFriendState('friend'); setPendingReqId(null); }
        else if (r.request) { setFriendState('pending_out'); setPendingReqId(r.request.id); }
      });
    }
  };
  const block = () => {
    if (!user) return;
    Alert.alert(t('blockTitle', { ns: 'dm', name: handle }), t('blockBody', { ns: 'dm', name: handle }), [
      { text: t('cancel', { ns: 'common' }), style: 'cancel' },
      { text: t('blockConfirm', { ns: 'dm' }), style: 'destructive', onPress: async () => {
        addBlocked({ userId: user.id });
        try {
          await submitBlock({ targetUserId: user.id, targetNickname: user.displayName, guestId: account ? undefined : identity?.guestId });
          goBack();
        } catch {
          removeBlocked({ userId: user.id });
          Alert.alert(t('blockFailTitle', { ns: 'dm' }), t('blockFailBody', { ns: 'dm' }));
        }
      } },
    ]);
  };

  // ── States ────────────────────────────────────────────────────────────────
  const back = (
    <Pressable onPress={() => goBack()} style={[styles.navBtn, { top: insets.top + Space.sm, left: Gutter }]} accessibilityRole="button"
               accessibilityLabel={t('back', { ns: 'common' })} hitSlop={8}>
      <Ionicons name="chevron-back" size={22} color="#2B1A12" />
    </Pressable>
  );
  if (failed) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        {back}
        <EmptyState icon={failed === 'gone' ? 'person-remove-outline' : 'cloud-offline-outline'}
                    title={failed === 'gone' ? t('p2.goneTitle') : t('p2.errorTitle')}
                    body={failed === 'gone' ? t('p2.goneBody') : t('loadError')}
                    action={<Button variant="secondary" label={failed === 'gone' ? t('goBack') : t('p2.retry')} onPress={failed === 'gone' ? () => goBack() : load} />} />
      </View>
    );
  }

  const home = stats?.homeCity ?? null;
  const cityName = home?.name ? shortCityName(home.name) : user?.currentCity ? shortCityName(user.currentCity) : null;
  const cityCountry = home?.country ?? user?.currentCityCountry ?? null;
  const streak = stats?.currentStreak ?? 0;
  const since = stats?.memberSince ? new Date(stats.memberSince * 1000).toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' }) : null;
  const photos = card?.photos.items ?? [];
  const progress: DailyLocalPassProgress[] = [...(stats?.localPassProgress ?? [])].sort((a, b) => Number(b.earned) - Number(a.earned) || b.done - a.done);
  const mainPass = progress[0] ?? null;
  const tile = (width - Gutter * 2 - Space.sm * 2) / 3;
  const openPhoto = (id: string) => openPhotoFeed(photos.map(p => p.proof), id, 'profile');

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: showActions ? 96 + insets.bottom : Space.xl + insets.bottom }} scrollEventThrottle={32}
                  onScroll={e => { const y = e.nativeEvent.contentOffset.y > 110; if (y !== scrolled) setScrolled(y); }}>
        {/* Cover: the wavy orange band, then the avatar over its edge. */}
        <LinearGradient colors={['#FFB07A', '#F2783A', '#C24E1C']} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                        style={[styles.cover, { height: 118 + insets.top }]}>
          <Svg viewBox="0 0 330 26" preserveAspectRatio="none" style={styles.wave}>
            <Path d="M0 18 C60 28 110 2 170 8 C230 13 270 26 330 12 L330 27 L0 27Z" fill={colors.bg} />
          </Svg>
        </LinearGradient>
        {preview && (
          <View style={[styles.previewBanner, { top: insets.top + Space.sm }]} accessibilityRole="header">
            <Ionicons name="eye-outline" size={IconSize.sm} color="#2B1A12" />
            <Text style={styles.previewText}>{t('p2.previewBanner')}</Text>
          </View>
        )}

        <View style={styles.head}>
          <View style={styles.avatarRing}>
            {user ? <Avatar uri={user.avatarUrl ?? user.thumbAvatarUrl ?? null} name={user.displayName ?? ''} size={86} />
                  : <View style={[styles.skel, { width: 86, height: 86, borderRadius: 43 }]} />}
            {card?.crown && <View style={styles.crown} accessibilityLabel={t('p2.crownA11y')}><Crown size={30} /></View>}
          </View>
          {user ? <Text style={styles.name} accessibilityRole="header">{handle}</Text> : <View style={[styles.skel, { width: 140, height: 22 }]} />}
          <View style={styles.tags}>
            {!!cityName && (
              <View style={styles.tag}><FlagSticker country={cityCountry} size={16} /><Text style={styles.tagText}>{cityName}</Text></View>
            )}
            {!!user?.mode && (
              <View style={[styles.tag, user.mode === 'local' && styles.tagLocal]}>
                <Text style={[styles.tagText, user.mode === 'local' && styles.tagLocalText]}>{t(user.mode === 'local' ? 'local' : 'traveler', { ns: 'daily' })}</Text>
              </View>
            )}
            {streak > 0 && <View style={styles.tag}><Text style={styles.tagText}>🔥 {t('streak', { ns: 'daily', count: streak })}</Text></View>}
          </View>
          {!!since && <Text style={styles.since}>{t('p2.since', { date: since })}</Text>}
          {friends !== null && friends > 0 && <Text style={styles.since}>{t('p2.friends', { count: friends })}</Text>}
          {!!stats?.invitedBy && <Text style={styles.since}>{t('crew.invitedBy', { ns: 'me', name: stats.invitedBy.username ? '@' + stats.invitedBy.username : stats.invitedBy.displayName ?? '' })}</Text>}
        </View>

        <View style={styles.body}>
          {/* Photos, likes received, World wins. */}
          <View style={styles.stats}>
            <Stat value={stats?.photos ?? null} label={t('p2.photos', { count: stats?.photos ?? 0 })} />
            <Stat value={stats?.likesReceived ?? null} label={t('p2.likes', { count: stats?.likesReceived ?? 0 })} />
            <Stat value={card?.wins ?? null} label={t('p2.wins', { count: card?.wins ?? 0 })} />
          </View>

          {/* This season: the same numbers as World › Players. */}
          {card && (card.season.city || card.season.world) && (
            <>
              <Section title={card.season.pre ? t('p2.preSeason') : t('p2.season')} />
              <View style={styles.ranks}>
                {card.season.city && (
                  <RankCard colors={['#F6B93B', '#E08E0B']} rank={card.season.city.rank}
                            label={t('p2.inCity', { city: shortCityName(card.season.city.city.name ?? '') })}
                            sub={t('ranks.pts', { ns: 'daily', count: card.season.city.points })} flag={card.season.city.city.country} />
                )}
                {card.season.world && (
                  <RankCard colors={['#5B8DEF', '#3461C9']} rank={card.season.world.rank} label={t('p2.world')}
                            sub={t('ranks.pts', { ns: 'daily', count: card.season.world.points })} globe />
                )}
              </View>
            </>
          )}

          {/* Stamps, Local Pass, Pioneer, season medals. */}
          {mainPass && mainPass.done > 0 && (
            <>
              <Section title={t('p2.stamps')} />
              <CityPage cityName={shortCityName(mainPass.city.name ?? '')} country={mainPass.city.country} themes={mainPass.themes}
                        stamps={mainPass.stamps} total={mainPass.total} earned={mainPass.earned} todayTheme={null} tomorrowTheme={null}
                        onStamp={s => router.push(`/daily/${s.date}?proof=${s.proofId}` as never)} />
            </>
          )}
          {(stats?.specialStamps?.length ?? 0) > 0 && <SpecialStamps stamps={stats!.specialStamps!} />}
          {(stats?.pioneerOf?.length ?? 0) > 0 && <PioneerBadges pioneers={stats!.pioneerOf!} />}
          {(stats?.seasonMedals?.length ?? 0) > 0 && <SeasonMedals medals={stats!.seasonMedals!} />}

          {/* Photos: best first, the podium's medal, the likes. */}
          <Section title={t('p2.photosTitle')}
                   aside={card && card.photos.total > photos.length ? t('p2.seeAll', { n: card.photos.total }) : undefined}
                   onAside={() => router.push(`/user/photos/${userId}` as never)} />
          {!card ? (
            <View style={styles.grid}>{[0, 1, 2].map(i => <View key={i} style={[styles.skel, { width: tile, height: tile, borderRadius: Radius.inner }]} />)}</View>
          ) : photos.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyEmoji} accessibilityElementsHidden importantForAccessibility="no">📸</Text>
              <Text style={styles.emptyTitle}>{isSelf ? t('p2.noPhotosSelf') : t('p2.noPhotos', { name: handle })}</Text>
              <Text style={styles.emptyText}>{t('p2.noPhotosText')}</Text>
            </View>
          ) : (
            <View style={styles.grid}>
              {photos.map(p => (
                <Pressable key={p.proof.id} onPress={() => openPhoto(p.proof.id)} accessibilityRole="imagebutton"
                           accessibilityLabel={[p.podium ? t('p2.podiumA11y', { rank: p.podium }) : null,
                                                t('a11y.likes', { ns: 'daily', count: p.proof.voteCount })].filter(Boolean).join(', ')}
                           style={{ width: tile, height: tile }}>
                  <Photo thumb={p.proof.thumbUrl} full={p.proof.photoUrl} hash={p.proof.thumbHash ?? null} style={styles.tile} />
                  {!!p.podium && p.podium <= 3 && <View style={styles.tileMedal}><RankMedal rank={p.podium} podium size={22} /></View>}
                  <View style={styles.tileLikes}><Text style={styles.tileLikesText}>❤️ {p.proof.voteCount}</Text></View>
                </Pressable>
              ))}
            </View>
          )}

          {/* You vs them. */}
          {!isSelf && !preview && card?.duels && (
            <>
              <Section title={t('p2.vsTitle', { name: handle })}
                       aside={card.duels.total > 0 ? t('p2.duels', { count: card.duels.total }) : undefined}
                       onAside={card.duels.total > card.duels.duels.length ? () => router.push(`/duels/${userId}` as never) : undefined} />
              {card.duels.total === 0 ? (
                <View style={styles.emptyCard}><Text style={styles.emptyText}>{t('p2.noDuels')}</Text></View>
              ) : (
                <View style={styles.vs}>
                  <View style={styles.score} accessible accessibilityLabel={t('p2.scoreA11y', { me: card.duels.me, them: card.duels.them, name: handle })}>
                    <Text style={styles.scoreNum}>{card.duels.me}</Text><Text style={styles.scoreWho}>{t('p2.you')}</Text>
                    <View style={styles.vsBadge}><Text style={styles.vsBadgeText}>VS</Text></View>
                    <Text style={styles.scoreWho}>{handle}</Text><Text style={styles.scoreNum}>{card.duels.them}</Text>
                  </View>
                  {card.duels.duels.map(d => <DuelRow key={d.date} duel={d} />)}
                  {card.duels.total > card.duels.duels.length && (
                    <Button variant="secondary" label={t('p2.seeAllDuels')} onPress={() => router.push(`/duels/${userId}` as never)} />
                  )}
                </View>
              )}
            </>
          )}

          {/* Plans they host (Hi plans, still to come). */}
          {plans.length > 0 && (
            <>
              <Section title={t('p2.plans')} />
              {plans.map(e => <EventPill key={e.id} event={e} onPress={() => router.push({ pathname: '/event/[id]', params: { id: e.id } })} />)}
            </>
          )}
        </View>
      </ScrollView>

      {scrolled && (
        <View style={[styles.topBar, { height: insets.top + 60, paddingTop: insets.top }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={styles.topBarTitle} numberOfLines={1}>{handle}</Text>
        </View>
      )}
      {back}
      {showActions && (
        <Pressable onPress={() => setMenu(true)} style={[styles.navBtn, { top: insets.top + Space.sm, right: Gutter }]} accessibilityRole="button"
                   accessibilityLabel={t('moreOptions')} hitSlop={8}>
          <Ionicons name="ellipsis-horizontal" size={20} color="#2B1A12" />
        </Pressable>
      )}

      {/* Message (primary) and the friendship. */}
      {showActions && user && (
        <View style={[styles.bar, { paddingBottom: Space.md + insets.bottom }]}>
          <Button icon="chatbubble-outline" label={t('p2.message')} style={styles.barBtn}
                  onPress={() => router.push({ pathname: '/dm/[id]', params: { id: user.id, name: user.displayName } })} />
          <Button variant="secondary" style={styles.barBtn} disabled={friendBusy}
                  icon={friendState === 'friend' ? 'checkmark-circle-outline' : friendState === 'pending_out' ? 'time-outline' : 'person-add-outline'}
                  label={friendState === 'friend' ? t('p2.friendsState') : friendState === 'pending_out' ? t('p2.requested')
                    : friendState === 'pending_in' ? t('p2.accept') : t('p2.addFriend')}
                  onPress={friendPress} />
        </View>
      )}
      {!user && !failed && <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>}

      <ProfileActionSheet visible={menu} onClose={() => setMenu(false)} title={handle} actions={[
        { key: 'report', label: existingReport ? t('p2.reported') : t('p2.report'), icon: 'flag-outline', disabled: !!existingReport,
          onPress: () => { setMenu(false); setReport(true); } },
        { key: 'block', label: t('p2.block'), icon: 'ban-outline', destructive: true, onPress: () => { setMenu(false); block(); } },
      ]} />
      {user && (
        <ReportModal visible={report} reporterGuestId={identity?.guestId} targetUserId={user.id} targetNickname={user.displayName}
                     onClose={() => { setReport(false); fetchReportStatus({ targetUserId: user.id }).then(r => setExistingReport(r.reported ? (r.existing ?? null) : null)).catch(() => {}); }} />
      )}
    </View>
  );
}

function Section({ title, aside, onAside }: { title: string; aside?: string; onAside?: () => void }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
      {!!aside && (onAside
        ? <Pressable onPress={onAside} accessibilityRole="button" hitSlop={10}><Text style={styles.sectionAside}>{aside}</Text></Pressable>
        : <Text style={styles.sectionAside}>{aside}</Text>)}
    </View>
  );
}

function Stat({ value, label }: { value: number | null; label: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.stat} accessible accessibilityLabel={value !== null ? `${value} ${label}` : label}>
      {value !== null ? <Text style={styles.statValue} maxFontSizeMultiplier={1.4}>{value}</Text> : <View style={[styles.skel, { width: 32, height: 22 }]} />}
      <Text style={styles.statLabel} numberOfLines={1} maxFontSizeMultiplier={1.3}>{label}</Text>
    </View>
  );
}

function RankCard({ colors, rank, label, sub, flag, globe }: { colors: [string, string]; rank: number; label: string; sub: string; flag?: string | null; globe?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.rankCard}>
      <View accessible accessibilityLabel={`#${rank} ${label}, ${sub}`} style={styles.rankInner}>
        <Text style={styles.rankNum} maxFontSizeMultiplier={1.3}>#{rank}</Text>
        <View style={styles.rankBody}>
          <Text style={styles.rankLabel} numberOfLines={1}>{label}</Text>
          <View style={styles.rankSubRow}>
            {globe ? <Text style={styles.rankSub}>🌍</Text> : <FlagSticker country={flag} size={14} />}
            <Text style={styles.rankSub}>{sub}</Text>
          </View>
        </View>
      </View>
    </LinearGradient>
  );
}

function DuelRow({ duel }: { duel: Duel }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('publicProfile');
  const tc = themeColor(duel.theme);
  return (
    <Pressable style={styles.duel} onPress={() => openPhotoFeed([duel.mine, duel.theirs], duel.mine.id, 'profile_duel')} accessibilityRole="button"
               accessibilityLabel={t('p2.duelA11y', { theme: themeName(duel.theme), winner: duel.winner === 'me' ? t('p2.you') : '' })}>
      <View style={styles.duelPhoto}>
        <Photo thumb={duel.mine.thumbUrl} full={duel.mine.photoUrl} hash={duel.mine.thumbHash ?? null} style={styles.tile} />
        {duel.winner === 'me' && <View style={styles.duelCrown}><Crown size={20} /></View>}
      </View>
      <View style={styles.duelMid}>
        <Text style={[styles.duelTheme, { color: tc.textLight }]} numberOfLines={1}>{themeName(duel.theme)}</Text>
        <Text style={styles.duelLikes}>{duel.mine.voteCount} – {duel.theirs.voteCount}</Text>
      </View>
      <View style={styles.duelPhoto}>
        <Photo thumb={duel.theirs.thumbUrl} full={duel.theirs.photoUrl} hash={duel.theirs.thumbHash ?? null} style={styles.tile} />
        {duel.winner === 'them' && <View style={styles.duelCrown}><Crown size={20} /></View>}
      </View>
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container:   { flex: 1, backgroundColor: c.bg },
  center:      { alignItems: 'center', justifyContent: 'center' },
  loading:     { position: 'absolute', top: 260, left: 0, right: 0, alignItems: 'center' },
  cover:       { width: '100%', justifyContent: 'flex-end' },
  wave:        { width: '100%', height: 26, marginBottom: -1 },
  topBar:      { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: c.bg, borderBottomWidth: 1, borderBottomColor: c.line,
                 alignItems: 'center', justifyContent: 'center', paddingHorizontal: 72 },
  topBarTitle: { ...Type.label, color: c.text },
  navBtn:      { position: 'absolute', width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  previewBanner: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: Space.xs,
                   backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: Radius.control, paddingHorizontal: Space.md, minHeight: 32 },
  previewText: { ...Type.caption, color: '#2B1A12' },
  head:        { alignItems: 'center', marginTop: -52, paddingHorizontal: Gutter, gap: Space.xs },
  avatarRing:  { borderWidth: 4, borderColor: c.bg, borderRadius: 50, backgroundColor: c.bg },
  crown:       { position: 'absolute', right: -10, bottom: -4, transform: [{ rotate: '12deg' }] },
  name:        { ...Type.title, fontSize: 21, color: c.text, marginTop: Space.xs },
  tags:        { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Space.xs },
  tag:         { flexDirection: 'row', alignItems: 'center', gap: Space.xxs, backgroundColor: c.bg2, borderRadius: Radius.control, paddingHorizontal: Space.sm, minHeight: 26 },
  tagLocal:    { backgroundColor: c.primaryTint },
  tagText:     { ...Type.caption, fontWeight: '800', color: c.text },
  tagLocalText:{ color: c.primaryOnTint },
  since:       { ...Type.caption, color: c.muted },
  body:        { paddingHorizontal: Gutter, gap: Space.sm, marginTop: Space.md },
  stats:       { flexDirection: 'row', gap: Space.sm },
  stat:        { flex: 1, backgroundColor: c.bg2, borderRadius: Radius.card, paddingVertical: Space.sm, alignItems: 'center', gap: Space.xxs },
  statValue:   { fontSize: 19, lineHeight: 24, fontWeight: '900', color: c.text },
  statLabel:   { ...Type.caption, color: c.muted },
  section:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: Space.md, gap: Space.sm },
  sectionTitle:{ ...Type.label, color: c.text, flexShrink: 1 },
  sectionAside:{ ...Type.caption, fontWeight: '800', color: c.primaryText },
  ranks:       { flexDirection: 'row', gap: Space.sm },
  rankCard:    { flex: 1, borderRadius: Radius.card, padding: Space.md },
  rankInner:   { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  rankNum:     { fontSize: 22, lineHeight: 28, fontWeight: '900', color: '#fff' },
  rankBody:    { flex: 1 },
  rankLabel:   { ...Type.caption, fontWeight: '900', color: '#fff' },
  rankSubRow:  { flexDirection: 'row', alignItems: 'center', gap: Space.xxs },
  rankSub:     { fontSize: 11, lineHeight: 15, fontWeight: '700', color: '#fff' },
  grid:        { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  tile:        { width: '100%', height: '100%', borderRadius: Radius.inner, backgroundColor: c.bg3 },
  tileMedal:   { position: 'absolute', top: 4, left: 4 },
  tileLikes:   { position: 'absolute', right: 4, bottom: 4, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 8, paddingHorizontal: 5 },
  tileLikesText: { fontSize: 11, lineHeight: 16, fontWeight: '900', color: '#fff' },
  emptyCard:   { backgroundColor: c.bg2, borderRadius: Radius.card, padding: Space.lg, alignItems: 'center', gap: Space.xs },
  emptyEmoji:  { fontSize: 32, lineHeight: 40 },
  emptyTitle:  { ...Type.label, color: c.text, textAlign: 'center' },
  emptyText:   { ...Type.body, color: c.muted, textAlign: 'center' },
  vs:          { backgroundColor: c.bg2, borderRadius: Radius.card, padding: Space.md, gap: Space.sm },
  score:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.sm },
  scoreNum:    { fontSize: 22, lineHeight: 28, fontWeight: '900', color: c.text },
  scoreWho:    { ...Type.caption, color: c.muted, maxWidth: 90 },
  vsBadge:     { width: 36, height: 36, borderRadius: 18, backgroundColor: c.gold, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-8deg' }] },
  vsBadgeText: { fontSize: 12, fontWeight: '900', color: c.onGold },
  duel:        { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 44 },
  duelPhoto:   { flex: 1, aspectRatio: 4 / 3 },
  duelCrown:   { position: 'absolute', top: -8, right: -4 },
  duelMid:     { width: 64, alignItems: 'center' },
  duelTheme:   { ...Type.caption, fontWeight: '800' },
  duelLikes:   { ...Type.caption, color: c.muted },
  bar:         { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: Space.sm, paddingHorizontal: Gutter, paddingTop: Space.md,
                 backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.line },
  barBtn:      { flex: 1 },
  skel:        { backgroundColor: c.bg3, borderRadius: 8 },
});
