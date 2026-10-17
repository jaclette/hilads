import { thumbUrl } from '@/lib/imageThumb';
/**
 * Public profile screen - /user/[id]
 *
 * Layout:
 *   1. Sticky identity header (always visible): avatar, name, badge, city,
 *      vibe card, mode card, from/age rows
 *   2. Tab bar: Events | Friends | Vibes | City Picks (legend only)
 *   3. Scrollable tab content
 *   4. Sticky action bar at bottom
 */

import { useState, useEffect } from 'react';
import {
  View, Text, Image, ScrollView, TouchableOpacity,
  ActivityIndicator, StyleSheet, Alert, Modal, Pressable,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { fetchPublicProfile, fetchUserEvents, fetchUserFriends, removeFriend, fetchUserVibes, postVibe, type UserVibe } from '@/api/users';
import {
  sendFriendRequest, acceptFriendRequest, cancelFriendRequest,
} from '@/api/friendRequests';
import { socket } from '@/lib/socket';
import { useApp } from '@/context/AppContext';
import { canAccessProfile } from '@/lib/profileAccess';
import { Border, FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { Avatar, Button, Chip, EmptyState, IconButton, ScreenHeader, TextField } from '@/ui';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import type { HiladsEvent, PublicProfile, UserDTO } from '@/types';
import { BADGE_META } from '@/types';
import { EventPill } from '@/features/events/EventPill';
import { fetchUserHangouts, type ProfileHangout } from '@/api/topics';
import { fetchUserChallenges, type ProfileChallenge } from '@/api/challenges';
import { ReportModal } from '@/features/profile/ReportModal';
import { ProfileActionSheet } from '@/features/profile/ProfileActionSheet';
import { ProfileRankRow } from '@/components/ProfileRankRow';
import { fetchReportStatus, type ExistingReport } from '@/api/reports';
import { submitBlock } from '@/api/blocks';
import { formatDateLabel } from '@/lib/messageTime';
import { DailyProfileStats } from '@/features/daily/DailyProfileStats';
import { VIBE_ICONS } from '@/features/profile/vibes';

// ── Badge microcopy ────────────────────────────────────────────────────────────

const BADGE_MICROCOPY: Record<string, string> = {
  ghost:   'Just browsing 👀',
  fresh:   'Just landed 👶',
  regular: 'Shows up often',
  local:   'Knows the city',
  host:    'Makes it happen 🔥',
};

// ── City flag ─────────────────────────────────────────────────────────────────

function cityFlag(countryCode?: string): string {
  if (!countryCode || countryCode.length !== 2) return '';
  return [...countryCode.toUpperCase()]
    .map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
    .join('');
}

// ── Mode meta ─────────────────────────────────────────────────────────────────

const MODE_META: Record<string, { emoji: string; label: string }> = {
  local:     { emoji: '🌍', label: 'Local'     },
  exploring: { emoji: '🧭', label: 'Exploring' },
};

// ── Vibe meta ─────────────────────────────────────────────────────────────────

const VIBE_META: Record<string, { emoji: string; label: string; caption: string }> = {
  party:       { emoji: '🔥', label: 'Party',       caption: 'Always down to party 🎉'        },
  board_games: { emoji: '🎲', label: 'Board Games', caption: 'Game night, every night'        },
  coffee:      { emoji: '☕', label: 'Coffee',       caption: 'Best conversations over coffee' },
  music:       { emoji: '🎧', label: 'Music',        caption: 'Life is a playlist 🎶'          },
  food:        { emoji: '🍜', label: 'Food',         caption: 'Eats first, questions later'    },
  chill:       { emoji: '🧘', label: 'Chill',        caption: 'Easy vibes only 😌'             },
};

// EventPill + eventIcon + formatEventTime live in
// src/features/events/EventPill.tsx - reused by the event-limit screen too.

// ── Tabs ──────────────────────────────────────────────────────────────────────

type TabKey = 'challenges' | 'hangouts' | 'events' | 'friends' | 'vibes' | 'picks';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const HANGOUT_ICONS: Record<string, IconName> = {
  general: 'chatbubbles-outline', tips: 'bulb-outline', food: 'restaurant-outline', drinks: 'beer-outline', help: 'hand-left-outline', meetup: 'people-outline',
};

const CHALLENGE_ICONS: Record<string, IconName> = {
  food: 'restaurant-outline', place: 'location-outline', culture: 'color-palette-outline', help: 'hand-left-outline',
};

// ── Screen ────────────────────────────────────────────────────────────────────

export default function PublicProfileScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const router  = useRouter();
  const { t }   = useTranslation('publicProfile');
  const insets  = useSafeAreaInsets();
  const { id }  = useLocalSearchParams<{ id: string }>();
  const { account, identity, city, addBlocked, removeBlocked } = useApp();

  const [user,         setUser]         = useState<PublicProfile | null>(null);
  const [events,       setEvents]       = useState<HiladsEvent[]>([]);
  const [hangouts,     setHangouts]     = useState<ProfileHangout[]>([]);
  const [challenges,      setChallenges]      = useState<ProfileChallenge[]>([]);
  /** Sub-filter on the Défi tab (parallels me.tsx). */
  const [challengeSubTab, setChallengeSubTab] = useState<'all' | 'local' | 'international'>('all');
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  // 4-state machine driven by isFriend + pendingFriendRequest from the profile
  // payload. WS events flip state without a re-fetch.
  type FriendState = 'none' | 'pending_out' | 'pending_in' | 'friend';
  const [friendState,  setFriendState]  = useState<FriendState>('none');
  const [pendingReqId, setPendingReqId] = useState<string | null>(null);
  const [friendBusy,   setFriendBusy]   = useState(false);
  const [friends,      setFriends]      = useState<UserDTO[]>([]);
  const [vibes,        setVibes]        = useState<UserVibe[]>([]);
  const [vibeScore,    setVibeScore]    = useState<number | null>(null);
  const [vibeCount,    setVibeCount]    = useState(0);
  const [myVibe,       setMyVibe]       = useState<{ rating: number; message?: string } | null>(null);
  const [vibeBusy,     setVibeBusy]     = useState(false);
  const [vibeRating,   setVibeRating]   = useState(0);
  const [vibeMessage,  setVibeMessage]  = useState('');
  const [showVibeForm,       setShowVibeForm]       = useState(false);
  const [showAvatarLightbox, setShowAvatarLightbox] = useState(false);
  const [showReportModal,    setShowReportModal]    = useState(false);
  const [showActionSheet,    setShowActionSheet]    = useState(false);
  const [blockBusy,          setBlockBusy]          = useState(false);
  const [existingReport,     setExistingReport]     = useState<ExistingReport | null>(null);
  // Challenges first - primary activity surface (mirrors NOW + me.tsx ordering).
  const [activeTab,    setActiveTab]    = useState<TabKey>('challenges');

  useEffect(() => {
    if (!canAccessProfile(account)) {
      router.replace('/auth-gate');
    }
  }, [account]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);

    Promise.all([fetchPublicProfile(id), fetchUserEvents(id), fetchUserHangouts(id), fetchUserChallenges(id)])
      .then(([u, evs, hgs, chs]) => {
        setUser(u);
        setEvents(evs);
        setHangouts(hgs);
        setChallenges(chs);
        // Derive friendState from server payload. isFriend wins because once
        // accepted, the request row is no longer pending.
        if (u.isFriend) {
          setFriendState('friend');
          setPendingReqId(null);
        } else if (u.pendingFriendRequest) {
          setFriendState(u.pendingFriendRequest.direction === 'outgoing' ? 'pending_out' : 'pending_in');
          setPendingReqId(u.pendingFriendRequest.id);
        } else {
          setFriendState('none');
          setPendingReqId(null);
        }
        if (u.vibeScore != null) setVibeScore(u.vibeScore);
        if (u.vibeCount != null) setVibeCount(u.vibeCount);
      })
      .catch(() => setError(t('loadError')))
      .finally(() => setLoading(false));

    fetchUserFriends(id).then(fr => setFriends(fr.friends)).catch(() => {});

    // Preflight: already-reported state (logged-in users only - guests can't
    // report from this screen, gated by `account` at the button site).
    if (account && account.id !== id) {
      fetchReportStatus({ targetUserId: id })
        .then(r => setExistingReport(r.reported ? (r.existing ?? null) : null))
        .catch(() => {});
    } else {
      setExistingReport(null);
    }
    fetchUserVibes(id)
      .then(vib => {
        setVibes(vib.vibes);
        setVibeScore(vib.score);
        setVibeCount(vib.count);
        setMyVibe(vib.myVibe);
        if (vib.myVibe) { setVibeRating(vib.myVibe.rating); setVibeMessage(vib.myVibe.message ?? ''); }
      })
      .catch(() => {});
  }, [id]);

  function handleFriendToggle() {
    if (!user || friendBusy) return;

    if (friendState === 'friend') {
      Alert.alert(
        t('unfriendTitle'),
        t('unfriendBody', { name: user.displayName }),
        [
          { text: t('cancel', { ns: 'common' }), style: 'cancel' },
          {
            text: t('unfriendConfirm'), style: 'destructive',
            onPress: async () => {
              setFriendBusy(true);
              try { await removeFriend(user.id); setFriendState('none'); } catch { /* ignore */ }
              finally { setFriendBusy(false); }
            },
          },
        ],
      );
      return;
    }

    if (friendState === 'pending_out') {
      Alert.alert(
        t('cancelReqTitle'),
        t('cancelReqBody', { name: user.displayName }),
        [
          { text: t('keep'), style: 'cancel' },
          {
            text: t('cancelReqConfirm'), style: 'destructive',
            onPress: async () => {
              if (!pendingReqId) return;
              setFriendBusy(true);
              try {
                await cancelFriendRequest(pendingReqId);
                setFriendState('none');
                setPendingReqId(null);
              } catch { /* ignore */ }
              finally { setFriendBusy(false); }
            },
          },
        ],
      );
      return;
    }

    if (friendState === 'pending_in') {
      // The other user already sent us a request - accept it directly.
      (async () => {
        if (!pendingReqId) return;
        setFriendBusy(true);
        try {
          await acceptFriendRequest(pendingReqId);
          setFriendState('friend');
          setPendingReqId(null);
        } catch { /* ignore */ }
        finally { setFriendBusy(false); }
      })();
      return;
    }

    // friendState === 'none' - send a fresh request. Server may auto-accept
    // if the receiver had already sent us a pending request (mutual add); in
    // that case we flip straight to "Friend" without the in-between state.
    (async () => {
      setFriendBusy(true);
      try {
        const result = await sendFriendRequest(user.id);
        if (result.friend) {
          setFriendState('friend');
          setPendingReqId(null);
        } else if (result.request) {
          setFriendState('pending_out');
          setPendingReqId(result.request.id);
        }
      } catch { /* ignore */ }
      finally { setFriendBusy(false); }
    })();
  }

  // Live state-flip when the OTHER user accepts/declines/cancels while this
  // screen is open. WS events come through the per-user channel that
  // useAppBoot subscribes to.
  useEffect(() => {
    if (!user) return;
    const offAccepted = socket.on('friendRequestAccepted', (data) => {
      // I sent a request, they accepted → flip to friend.
      if (data.requestId === pendingReqId) {
        setFriendState('friend');
        setPendingReqId(null);
      }
    });
    const offDeclined = socket.on('friendRequestDeclined', (data) => {
      // I sent a request, they declined → reset to none.
      if (data.requestId === pendingReqId) {
        setFriendState('none');
        setPendingReqId(null);
      }
    });
    const offCancelled = socket.on('friendRequestCancelled', (data) => {
      // They sent me a request, then cancelled → reset to none.
      if (data.requestId === pendingReqId) {
        setFriendState('none');
        setPendingReqId(null);
      }
    });
    const offReceived = socket.on('friendRequestReceived', (data) => {
      // They sent me a request while I'm viewing their profile → flip to pending_in.
      const req = data.request as { id: string; sender_id: string } | undefined;
      if (req && req.sender_id === user.id) {
        setFriendState('pending_in');
        setPendingReqId(req.id);
      }
    });
    return () => { offAccepted(); offDeclined(); offCancelled(); offReceived(); };
  }, [user, pendingReqId]);

  async function handleSubmitVibe() {
    if (!id || vibeBusy || vibeRating === 0) return;
    setVibeBusy(true);
    try {
      await postVibe(id, { rating: vibeRating, message: vibeMessage.trim() || undefined });
      const fresh = await fetchUserVibes(id);
      setVibes(fresh.vibes);
      setVibeScore(fresh.score);
      setVibeCount(fresh.count);
      setMyVibe(fresh.myVibe);
      setShowVibeForm(false);
    } catch { /* ignore */ }
    finally { setVibeBusy(false); }
  }

  function handleDm() {
    if (!user?.id) return;
    if (!canAccessProfile(account)) { router.push('/auth-gate?reason=send_dm'); return; }
    router.push({ pathname: '/dm/[id]', params: { id: user.id, name: user.displayName } });
  }

  function handleEventPress(eventId: string) {
    router.push({ pathname: '/event/[id]', params: { id: eventId } });
  }

  function handleBlockPress() {
    if (!user || blockBusy) return;
    Alert.alert(
      t('blockTitle', { ns: 'dm', name: user.displayName }),
      t('blockBody', { ns: 'dm', name: user.displayName }),
      [
        { text: t('cancel', { ns: 'common' }), style: 'cancel' },
        {
          text: t('blockConfirm', { ns: 'dm' }), style: 'destructive',
          onPress: async () => {
            setBlockBusy(true);
            try {
              // Optimistic: patch the local set BEFORE the API call so any
              // currently-rendered list filters update instantly.
              addBlocked({ userId: user.id });
              await submitBlock({
                targetUserId:   user.id,
                targetNickname: user.displayName,
                guestId:        account ? undefined : identity?.guestId,
              });
              router.back();
            } catch (err) {
              // Roll back the optimistic patch on failure.
              if (user) removeBlocked({ userId: user.id });
              Alert.alert(t('blockFailTitle', { ns: 'dm' }), t('blockFailBody', { ns: 'dm' }));
            } finally {
              setBlockBusy(false);
            }
          },
        },
      ],
    );
  }

  const name   = user?.displayName ?? '?';
  const isSelf = account?.id === id;
  // First badge that carries microcopy → a single sub-line under the meta row
  // (mirrors My Profile's vibe sub-line), instead of one caption per badge.
  const heroBadgeWithCopy = user?.badges?.find(b => BADGE_MICROCOPY[b]) ?? null;
  const heroMicrocopy = heroBadgeWithCopy
    ? t(`microcopy.${heroBadgeWithCopy}`, { defaultValue: BADGE_MICROCOPY[heroBadgeWithCopy] })
    : null;

  // Legend = user has ambassador picks
  const hasPicks = !!(
    user?.ambassadorPicks &&
    Object.values(user.ambassadorPicks).some(v => v)
  );

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'challenges', label: challenges.length > 0 ? `${t('tabChallenges')} · ${challenges.length}` : t('tabChallenges') },
    { key: 'hangouts', label: hangouts.length > 0 ? `${t('tabHangouts')} · ${hangouts.length}` : t('tabHangouts') },
    { key: 'events',  label: events.length  > 0 ? `${t('tabEvents')} · ${events.length}` : t('tabEvents') },
    { key: 'friends', label: friends.length > 0 ? `${t('tabFriends')} · ${friends.length}` : t('tabFriends') },
    { key: 'vibes',   label: vibeCount      > 0 ? `${t('tabVibes')} · ${vibeCount}` : t('tabVibes') },
    ...(hasPicks ? [{ key: 'picks' as TabKey, label: t('tabPicks') }] : []),
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* ── Header ── */}
      <ScreenHeader title={t('title')}
                    right={user && !isSelf && account ? <IconButton icon="ellipsis-horizontal" label={t('moreOptions')} onPress={() => setShowActionSheet(true)} /> : undefined} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <EmptyState icon="person-outline" body={error}
                      action={<Button variant="secondary" label={t('goBack')} onPress={() => router.back()} />} />
        </View>
      ) : user ? (
        <>
          {/* Scrollable page body. Identity + tab bar live INSIDE so they
              scroll away with the rest of the content; only the top header
              and the bottom action bar stay pinned. */}
          <ScrollView
            style={styles.tabContent}
            contentContainerStyle={[styles.tabContentBody, { paddingBottom: Math.max(100, insets.bottom + 80) }]}
            showsVerticalScrollIndicator={false}
          >
          {/* Identity section */}
          <View style={styles.identitySection}>

            {/* Identity row: avatar left + name / badges / city right.
                Mirrors My Profile (me.tsx) so the two screens align. */}
            <View style={styles.identityRow}>
              {user.avatarUrl ? (
                <TouchableOpacity activeOpacity={0.85} onPress={() => setShowAvatarLightbox(true)} accessibilityRole="imagebutton" accessibilityLabel={name}>
                  <Avatar uri={thumbUrl(user.thumbAvatarUrl ?? user.avatarUrl)} name={name} size={72} ring />
                </TouchableOpacity>
              ) : (
                <Avatar name={name} size={72} fallback="color" ring />
              )}

              <View style={styles.identityInfo}>
                <Text style={styles.displayName} numberOfLines={1}>{name}</Text>
                <View style={styles.identityMetaRow}>
                  {user.badges.map(badgeKey => {
                    const meta = BADGE_META[badgeKey as keyof typeof BADGE_META];
                    if (!meta) return null;
                    return <Chip key={badgeKey} label={t(`badge.${badgeKey}`, { ns: 'common', defaultValue: meta.label })} />;
                  })}
                  {city ? (
                    <Text style={styles.identityMetaCity} numberOfLines={1}>
                      {cityFlag(city.country)}{cityFlag(city.country) ? ' ' : ''}{city.name}
                    </Text>
                  ) : null}
                </View>
                {heroMicrocopy ? (
                  <Text style={styles.badgeMicrocopy}>{heroMicrocopy}</Text>
                ) : null}
              </View>
            </View>

            {/* Monthly rank - full-width banner below the identity row (same
                ProfileRankRow + placement as My Profile). Renders nothing when
                the user has no current city + no monthly score. */}
            <ProfileRankRow
              rank={user.monthlyRank ?? null}
              cityName={user.currentCity ?? null}
              cityCountry={user.currentCityCountry ?? null}
            />

            {/* About me */}
            {user.aboutMe ? (
              <Text style={styles.aboutMe}>{user.aboutMe}</Text>
            ) : null}

            {/* Identity cards: vibe + mode - side by side */}
            {(user.vibe && VIBE_META[user.vibe] || user.mode && MODE_META[user.mode]) ? (
              <View style={styles.identityCards}>
                {user.vibe && VIBE_META[user.vibe] ? (
                  <View style={styles.identityCard}>
                    <Ionicons name={VIBE_ICONS[user.vibe] ?? 'sparkles-outline'} size={22} color={colors.primaryText} />
                    <Text style={styles.identityCardTitle}>{t(`vibe.${user.vibe}`, { ns: 'common', defaultValue: VIBE_META[user.vibe].label })}</Text>
                    <Text style={styles.identityCardSub}>{t(`vibeCaption.${user.vibe}`, { defaultValue: VIBE_META[user.vibe].caption })}</Text>
                  </View>
                ) : null}
                {user.mode && MODE_META[user.mode] ? (
                  <View style={styles.identityCard}>
                    <Ionicons name={user.mode === 'local' ? 'location-outline' : 'compass-outline'} size={22} color={user.mode === 'local' ? colors.primaryText : colors.travelerText} />
                    <Text style={styles.identityCardTitle}>{t(`mode.${user.mode}.label`, { ns: 'common' })}</Text>
                    <Text style={styles.identityCardSub}>
                      {user.mode === 'local'
                        ? t('localIn', { city: user.homeCity ?? city?.name ?? t('thisCity') })
                        : t('exploringIn', { city: city?.name ?? t('thisCity') })}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Info rows: From + Age */}
            {(user.homeCity || user.age != null) ? (
              <View style={styles.detailsCard}>
                {user.homeCity ? (
                  <View style={[styles.detailRow, styles.detailRowFirst]}>
                    <Text style={styles.detailLabel}>{t('from')}</Text>
                    <Text style={styles.detailValue}>{user.homeCity}</Text>
                  </View>
                ) : null}
                {user.age != null ? (
                  <View style={[styles.detailRow, !user.homeCity && styles.detailRowFirst]}>
                    <Text style={styles.detailLabel}>{t('age')}</Text>
                    <Text style={styles.detailValue}>{user.age}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          {/* Tab bar - scrolls with content */}
          <View style={styles.tabBarWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tabBar}
            >
              {tabs.map(tab => (
                <Chip key={tab.key} variant="filter" label={tab.label} selected={activeTab === tab.key} onPress={() => setActiveTab(tab.key)} />
              ))}
            </ScrollView>
          </View>

            {/* Challenges tab */}
            {activeTab === 'challenges' && (() => {
              const filteredChallenges = challengeSubTab === 'all'
                ? challenges
                : challenges.filter(c => (c.mode ?? 'local') === challengeSubTab);
              return (
                <>
                  {!!id && <DailyProfileStats userId={id} isMe={id === account?.id} />}

                  {/* Mode sub-tabs - All / Local / International. */}
                  <View style={styles.profileSubTabsRow}>
                    {(['all', 'local', 'international'] as const).map(key => (
                      <Chip key={key} variant="filter" selected={challengeSubTab === key} onPress={() => setChallengeSubTab(key)}
                            label={key === 'all' ? t('modeFilter.all', { ns: 'challenge' }) : t(`mode.${key}`, { ns: 'challenge' })} />
                    ))}
                  </View>
                  {filteredChallenges.length === 0 ? (
                    <EmptyState body={t('noChallenges')} />
                  ) : (
                    <View style={styles.eventList}>
                      {filteredChallenges.map(c => (
                        <TouchableOpacity
                          key={c.id}
                          style={styles.hangoutRow}
                          activeOpacity={0.75}
                          onPress={() => router.push(`/challenge/${c.id}` as never)}
                        >
                          <Ionicons name={CHALLENGE_ICONS[c.challenge_type] ?? 'flame-outline'} size={20} color={colors.primaryText} />
                          <Text style={styles.hangoutTitle} numberOfLines={1}>{c.title}</Text>
                          {(c.mode ?? 'local') === 'international' && (
                            <Ionicons name="globe-outline" size={18} color={colors.travelerText} accessibilityLabel={t('mode.international', { ns: 'challenge' })} />
                          )}
                          {c.status === 'validated' && (
                            <Ionicons name="checkmark-circle" size={18} color={colors.localText} />
                          )}
                          {c.is_owner && <View style={styles.hostTag}><Text style={styles.hostTagText}>{t('host')}</Text></View>}
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </>
              );
            })()}

            {/* Hangouts tab */}
            {activeTab === 'hangouts' && (
              hangouts.length === 0 ? (
                <EmptyState body={t('noHangouts')} />
              ) : (
                <View style={styles.eventList}>
                  {hangouts.map(h => (
                    <TouchableOpacity
                      key={h.id}
                      style={styles.hangoutRow}
                      activeOpacity={0.75}
                      onPress={() => router.push({ pathname: '/topic/[id]', params: { id: h.id } })}
                    >
                      <Ionicons name={HANGOUT_ICONS[h.category ?? 'general'] ?? 'chatbubbles-outline'} size={20} color={colors.primaryText} />
                      <Text style={styles.hangoutTitle} numberOfLines={1}>{h.title}</Text>
                      {h.is_owner && <View style={styles.hostTag}><Text style={styles.hostTagText}>{t('host')}</Text></View>}
                    </TouchableOpacity>
                  ))}
                </View>
              )
            )}

            {/* Events tab */}
            {activeTab === 'events' && (
              events.length === 0 ? (
                <EmptyState body={t('noEvents')} />
              ) : (
                <View style={styles.eventList}>
                  {events.map(event => (
                    <EventPill
                      key={event.id}
                      event={event}
                      onPress={() => handleEventPress(event.id)}
                    />
                  ))}
                </View>
              )
            )}

            {/* Friends tab */}
            {activeTab === 'friends' && (
              friends.length === 0 ? (
                <EmptyState body={t('noFriends')} />
              ) : (
                <View style={styles.friendList}>
                  {friends.map(f => (
                    <TouchableOpacity
                      key={f.id}
                      style={styles.friendRow}
                      onPress={() => router.push({ pathname: '/user/[id]', params: { id: f.id } })}
                      activeOpacity={0.7}
                    >
                      <Avatar uri={f.avatarUrl ? thumbUrl(f.thumbAvatarUrl ?? f.avatarUrl) : null} name={f.displayName} size={40} fallback="color" />
                      <View style={styles.friendInfo}>
                        <Text style={styles.friendName} numberOfLines={1}>{f.displayName}</Text>
                        {f.badges[0] && (
                          <Text style={styles.friendBadge}>{t(`badge.${f.badges[0]}`, { ns: 'common', defaultValue: BADGE_META[f.badges[0] as keyof typeof BADGE_META]?.label ?? f.badges[0] })}</Text>
                        )}
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                    </TouchableOpacity>
                  ))}
                </View>
              )
            )}

            {/* Vibes tab */}
            {activeTab === 'vibes' && (
              <>
                {vibeCount > 0 && (
                  <View style={styles.vibeScoreCard}>
                    <View style={styles.vibeStarsRow}>
                      {[1,2,3,4,5].map(s => (
                        <Ionicons key={s} name={s <= Math.round(vibeScore ?? 0) ? 'star' : 'star-outline'} size={24} color={colors.gold} />
                      ))}
                    </View>
                    <Text style={styles.vibeScoreAvg}>{t('vibeScore', { score: vibeScore?.toFixed(1) })}</Text>
                    <Text style={styles.vibeScoreCount}>{t('vibeBasis', { count: vibeCount })}</Text>
                  </View>
                )}

                {!isSelf && account && (
                  !showVibeForm ? (
                    <Button variant="secondary" icon="star-outline" label={myVibe ? t('updateNote', { rating: myVibe.rating }) : t('leaveNote')}
                            onPress={() => setShowVibeForm(true)} />
                  ) : (
                    <View style={styles.vibeForm}>
                      <View style={styles.vibeFormStars}>
                        {[1,2,3,4,5].map(s => (
                          <TouchableOpacity key={s} style={styles.vibeFormStar} onPress={() => setVibeRating(s)} activeOpacity={0.7}
                                            accessibilityRole="button" accessibilityLabel={`${s}/5`} accessibilityState={{ selected: vibeRating >= s }}>
                            <Ionicons name={vibeRating >= s ? 'star' : 'star-outline'} size={30} color={colors.gold} />
                          </TouchableOpacity>
                        ))}
                      </View>
                      <TextField
                        placeholder={t('vibePlaceholder')}
                        value={vibeMessage}
                        onChangeText={setVibeMessage}
                        maxLength={300}
                        multiline
                      />
                      <View style={styles.vibeFormActions}>
                        <Button variant="secondary" label={t('cancel', { ns: 'common' })} style={styles.flex1}
                                onPress={() => { setShowVibeForm(false); setVibeRating(myVibe?.rating ?? 0); setVibeMessage(myVibe?.message ?? ''); }} />
                        <Button label={vibeBusy ? t('sending') : t('sendNote')} onPress={handleSubmitVibe} disabled={vibeBusy || vibeRating === 0} style={styles.flex1} />
                      </View>
                    </View>
                  )
                )}

                {vibes.length > 0 ? (
                  <View style={styles.vibeList}>
                    {vibes.map(v => (
                      <View key={v.id} style={styles.vibeRow}>
                        <Avatar uri={v.authorPhoto ? thumbUrl(v.authorPhoto) : null} name={v.authorName || '?'} size={36} fallback="color" />
                        <View style={styles.vibeContent}>
                          <View style={styles.vibeHeader}>
                            <Text style={styles.vibeAuthor}>{v.authorName}</Text>
                            <View style={styles.vibeRating}>
                              {Array.from({ length: v.rating }, (_, i) => <Ionicons key={i} name="star" size={12} color={colors.gold} />)}
                            </View>
                          </View>
                          {v.message ? <Text style={styles.vibeMsg}>{v.message}</Text> : null}
                        </View>
                      </View>
                    ))}
                  </View>
                ) : (
                  <EmptyState icon="star-outline" title={t('noNotesTitle')} body={t('noNotesSub')} />
                )}
              </>
            )}

            {/* City Picks tab - legend only */}
            {activeTab === 'picks' && hasPicks && (
              <View style={styles.picksGrid}>
                {[
                  { key: 'restaurant', label: t('picks.restaurant'), val: user.ambassadorPicks?.restaurant },
                  { key: 'spot',       label: t('picks.spot'),       val: user.ambassadorPicks?.spot       },
                  { key: 'tip',        label: t('picks.tip'),        val: user.ambassadorPicks?.tip        },
                  { key: 'story',      label: t('picks.story'),      val: user.ambassadorPicks?.story      },
                ].filter(p => p.val).map(p => (
                  <View key={p.key} style={styles.pickCard}>
                    <Text style={styles.pickCardTitle}>{p.label}</Text>
                    <Text style={styles.pickCardContent}>{p.val}</Text>
                  </View>
                ))}
              </View>
            )}

          </ScrollView>
        </>
      ) : null}

      {/* ── 4. Sticky action bar ── */}
      {user && !isSelf && account && (
        <View style={[styles.stickyBar, { paddingBottom: Math.max(12, insets.bottom) }]}>
          <Button icon="chatbubble-outline" label={t('message')} onPress={handleDm} style={styles.flex1} />
          <Button
            variant="secondary"
            icon={
              friendState === 'friend'      ? 'person-remove-outline' :
              friendState === 'pending_out' ? 'time-outline'         :
              friendState === 'pending_in'  ? 'checkmark-outline'    :
                                              'person-add-outline'
            }
            label={
              friendState === 'friend'      ? t('friend')        :
              friendState === 'pending_out' ? t('requestSent')  :
              friendState === 'pending_in'  ? t('acceptRequest'):
                                              t('addFriend')
            }
            onPress={handleFriendToggle}
            loading={friendBusy}
            style={styles.flex1}
          />
        </View>
      )}

      {/* ── Action sheet (Report / Block) ── */}
      {user && !isSelf && (
        <ProfileActionSheet
          visible={showActionSheet}
          title={user.displayName}
          actions={[
            {
              key:      'report',
              label:    existingReport ? t('alreadyReported') : t('reportUser'),
              icon:     'flag-outline',
              disabled: !!existingReport,
              onPress:  () => {
                if (existingReport) {
                  Alert.alert(
                    t('alreadyReported'),
                    t('alreadyReportedBody', { date: formatDateLabel(existingReport.created_at) }),
                  );
                  return;
                }
                setShowReportModal(true);
              },
            },
            {
              key:         'block',
              label:       blockBusy ? t('blocking') : t('blockUser'),
              icon:        'ban-outline',
              destructive: true,
              disabled:    blockBusy,
              onPress:     handleBlockPress,
            },
          ]}
          onClose={() => setShowActionSheet(false)}
        />
      )}

      {/* ── Report modal ── */}
      {user && !isSelf && (
        <ReportModal
          visible={showReportModal}
          reporterGuestId={account ? undefined : identity?.guestId}
          targetUserId={user.id}
          targetNickname={user.displayName}
          onClose={() => setShowReportModal(false)}
        />
      )}

      {/* ── Avatar lightbox ── */}
      {user?.avatarUrl ? (
        <Modal
          visible={showAvatarLightbox}
          transparent
          animationType="fade"
          statusBarTranslucent
          onRequestClose={() => setShowAvatarLightbox(false)}
        >
          <Pressable style={styles.lightboxOverlay} onPress={() => setShowAvatarLightbox(false)}>
            <Image source={{ uri: user.avatarUrl }} style={styles.lightboxImage} resizeMode="contain" />
            <IconButton icon="close" tone="onPhoto" label={t('close', { ns: 'common' })} onPress={() => setShowAvatarLightbox(false)} style={styles.lightboxClose} />
          </Pressable>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────


const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container:      { flex: 1, backgroundColor: c.bg },
  center:         { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  flex1:          { flex: 1 },
  tabContent:     { flex: 1 },
  tabContentBody: { paddingHorizontal: Spacing.md, gap: 12 },

  // ── Identity ──
  identitySection:  { gap: 12 },
  identityRow:      { flexDirection: 'row', alignItems: 'center', gap: 14 },
  identityInfo:     { flex: 1, gap: 6 },
  displayName:      { fontSize: FontSizes.xl, fontWeight: '800', color: c.text },
  identityMetaRow:  { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  identityMetaCity: { fontSize: 12, fontWeight: '600', color: c.muted },
  badgeMicrocopy:   { fontSize: FontSizes.xs, fontWeight: '400', color: c.muted },
  aboutMe:          { fontSize: FontSizes.sm, fontWeight: '400', color: c.text, lineHeight: 20 },
  identityCards:    { flexDirection: 'row', gap: 10 },
  identityCard:     { flex: 1, gap: 4, padding: 14, borderRadius: Radius.card, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  identityCardTitle:{ fontSize: 15, fontWeight: '700', color: c.text },
  identityCardSub:  { fontSize: 12, fontWeight: '400', color: c.muted },
  detailsCard:      { borderRadius: Radius.card, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2, paddingHorizontal: 14 },
  detailRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, borderTopWidth: 1, borderTopColor: c.line },
  detailRowFirst:   { borderTopWidth: 0 },
  detailLabel:      { fontSize: FontSizes.sm, fontWeight: '400', color: c.muted },
  detailValue:      { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },

  // ── Tabs ──
  tabBarWrap:        { marginHorizontal: -Spacing.md },
  tabBar:            { gap: 8, paddingHorizontal: Spacing.md },
  profileSubTabsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  // ── Lists ──
  eventList:    { gap: 8 },
  hangoutRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 14, borderRadius: Radius.card,
                  borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  hangoutTitle: { flex: 1, fontSize: FontSizes.sm, fontWeight: '600', color: c.text },
  hostTag:      { height: 22, justifyContent: 'center', paddingHorizontal: 8, borderRadius: Radius.full, backgroundColor: c.primaryTint },
  hostTagText:  { fontSize: 11, fontWeight: '700', color: c.primaryOnTint },
  friendList:   { borderRadius: Radius.card, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2, paddingHorizontal: 14 },
  friendRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.line },
  friendInfo:   { flex: 1, minWidth: 0, gap: 2 },
  friendName:   { fontSize: 15, fontWeight: '700', color: c.text },
  friendBadge:  { fontSize: 12, fontWeight: '400', color: c.muted },

  // ── Vibes ──
  vibeScoreCard:  { alignItems: 'center', gap: 4, padding: 16, borderRadius: Radius.card, borderWidth: Border, borderColor: c.gold, backgroundColor: c.bg2 },
  vibeStarsRow:   { flexDirection: 'row', gap: 4 },
  vibeScoreAvg:   { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  vibeScoreCount: { fontSize: 12, fontWeight: '400', color: c.muted },
  vibeForm:        { gap: 10, padding: 14, borderRadius: Radius.card, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  vibeFormStars:   { flexDirection: 'row', justifyContent: 'center' },
  vibeFormStar:    { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  vibeFormActions: { flexDirection: 'row', gap: 10 },
  vibeList:    { borderRadius: Radius.card, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2, paddingHorizontal: 14 },
  vibeRow:     { flexDirection: 'row', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.line },
  vibeContent: { flex: 1, gap: 3 },
  vibeHeader:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  vibeAuthor:  { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  vibeRating:  { flexDirection: 'row', gap: 1 },
  vibeMsg:     { fontSize: FontSizes.sm, fontWeight: '400', color: c.text, lineHeight: 20 },

  // ── City Picks (legends) ──
  picksGrid:       { gap: 10 },
  pickCard:        { gap: 4, padding: 14, borderRadius: Radius.card, borderWidth: Border, borderColor: c.gold, backgroundColor: c.bg2 },
  pickCardTitle:   { fontSize: 12, fontWeight: '700', color: c.gold },
  pickCardContent: { fontSize: FontSizes.sm, fontWeight: '400', color: c.text, lineHeight: 20 },

  // ── Bottom bar ──
  stickyBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, paddingHorizontal: Spacing.md, paddingTop: 12,
               borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.bg },

  // ── Avatar lightbox ──
  lightboxOverlay: { flex: 1, backgroundColor: c.photoScrim, alignItems: 'center', justifyContent: 'center' },
  lightboxImage:   { width: '100%', height: '80%' },
  lightboxClose:   { position: 'absolute', top: 56, right: 16 },
});
