/**
 * Me / My Profile screen
 *
 * Layout (registered users):
 *   STICKY  — page header
 *   STICKY  — identity row (avatar · name · badge · description)
 *   STICKY  — compact mode selector (Local / Exploring)
 *   STICKY  — filter pills (Personal Info · Friends · Vibes)
 *   SCROLL  — tab content
 *   STICKY  — save CTA + sign-out / delete account
 *
 * Guest users see a compact guest card + mode selector + upgrade CTA
 * inside the scroll (no sticky filter bar needed).
 */

import { useState, useEffect, useRef } from 'react';
import {
  View, Text, Image, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, StyleSheet, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { useMyEvents } from '@/hooks/useMyEvents';
import { saveIdentity } from '@/lib/identity';
import { updateProfile, deleteAccount, checkUsernameAvailability } from '@/api/auth';
import { uploadFile } from '@/api/uploads';
import { deleteEvent } from '@/api/events';
import { fetchUserFriends, fetchUserVibes } from '@/api/users';
import { fetchUserHangouts, type ProfileHangout } from '@/api/topics';
import { fetchUserChallenges, type ProfileChallenge } from '@/api/challenges';
import { fetchIncomingFriendRequestCount } from '@/api/friendRequests';
import { socket } from '@/lib/socket';
import type { UserVibe } from '@/api/users';
import { Colors, FontSizes, Spacing, Radius, APP_VERSION } from '@/constants';
import { avatarColor as avatarBg } from '@/lib/avatarColors';
import type { HiladsEvent, UserDTO } from '@/types';
import { BADGE_META } from '@/types';
import { AppHeader } from '@/features/shell/AppHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { LanguageRow } from '@/features/settings/LanguageRow';
import { formatRecurrence } from '@/lib/recurrence';

// ── Constants — must match backend allowed lists ──────────────────────────────

const MODES = [
  { key: 'local',     emoji: '🌍' },
  { key: 'exploring', emoji: '🧭' },
] as const;

const VIBES = [
  { key: 'party',       emoji: '🔥' },
  { key: 'board_games', emoji: '🎲' },
  { key: 'coffee',      emoji: '☕' },
  { key: 'music',       emoji: '🎧' },
  { key: 'food',        emoji: '🍜' },
  { key: 'chill',       emoji: '🧘' },
] as const;

const INTERESTS = [
  'drinks', 'party', 'nightlife', 'music', 'live music',
  'culture', 'art', 'food', 'coffee', 'sport',
  'fitness', 'hiking', 'beach', 'wellness', 'travel',
  'hangout', 'socializing', 'gaming', 'tech', 'dating',
];

const EVENT_ICONS: Record<string, string> = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
};

type ProfileTab = 'interests' | 'challenges' | 'hangouts' | 'events' | 'friends' | 'vibes';

// Challenges placed before Hangouts/Events to mirror the NOW-screen filter
// ordering (Phase 4) — challenges are the primary activity type now.
const PROFILE_TABS: ProfileTab[] = ['interests', 'challenges', 'hangouts', 'events', 'friends', 'vibes'];

const HANGOUT_ICONS: Record<string, string> = {
  general: '🗣️', tips: '💡', food: '🍴', drinks: '🍺', help: '🙋', meetup: '👋',
};

const CHALLENGE_ICONS: Record<string, string> = {
  food: '🍜', place: '📍', culture: '🎭', help: '🤝',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function cityFlag(countryCode?: string): string {
  if (!countryCode || countryCode.length !== 2) return '';
  return [...countryCode.toUpperCase()]
    .map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
    .join('');
}

// ── Badge helpers ─────────────────────────────────────────────────────────────

const ME_BADGE_BG: Record<string, object> = {
  ghost:   { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.10)' },
  fresh:   { backgroundColor: 'rgba(74,222,128,0.12)',  borderColor: 'rgba(74,222,128,0.22)'  },
  regular: { backgroundColor: 'rgba(96,165,250,0.12)',  borderColor: 'rgba(96,165,250,0.22)'  },
  local:   { backgroundColor: 'rgba(52,211,153,0.12)',  borderColor: 'rgba(52,211,153,0.22)'  },
  host:    { backgroundColor: 'rgba(251,191,36,0.15)',  borderColor: 'rgba(251,191,36,0.28)'  },
};
const ME_BADGE_COLOR: Record<string, object> = {
  // ghost previously hardcoded '#666' (~3.4:1) — failed WCAG AA on the dark
  // bg. Routed through the theme token so future contrast fixes propagate.
  ghost: { color: Colors.muted2 }, fresh: { color: '#4ade80' },
  regular: { color: '#60a5fa' }, local: { color: '#34d399' }, host: { color: '#fbbf24' },
};
function meBadgeBg(key: string): object    { return ME_BADGE_BG[key]    ?? ME_BADGE_BG.regular; }
function meBadgeColor(key: string): object { return ME_BADGE_COLOR[key] ?? ME_BADGE_COLOR.regular; }

// ── Screen ────────────────────────────────────────────────────────────────────

export default function MeScreen() {
  const router  = useRouter();
  const { t }   = useTranslation('me');
  const insets  = useSafeAreaInsets();
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const { identity, account, setAccount, setIdentity, logout, city } = useApp();
  const { events: rawEvents, loading: eventsLoading } = useMyEvents();

  // Hangouts / Events tab labels are now translated (Vibes stays English — brand term).
  const tabLabel = (key: ProfileTab): string =>
    key === 'interests'  ? t('tabInterests')
    : key === 'friends'  ? t('tabFriends')
    : key === 'hangouts' ? t('tabHangouts')
    : key === 'events'   ? t('tabEvents')
    : key === 'challenges' ? t('tabChallenges')
    : 'Vibes';

  const validTabs = PROFILE_TABS;
  const initialTab = (validTabs.includes(tabParam as ProfileTab) ? tabParam : 'interests') as ProfileTab;
  const [activeTab,          setActiveTab]          = useState<ProfileTab>(initialTab);
  const [username,           setUsername]           = useState(account?.username ?? '');
  const [aboutMe,            setAboutMe]            = useState(account?.about_me ?? '');
  const [homeCity,           setHomeCity]            = useState(account?.home_city ?? '');
  const [ageStr,             setAgeStr]              = useState(account?.age != null ? String(account.age) : '');
  const [selectedVibe,       setSelectedVibe]        = useState<string>(account?.vibe ?? 'chill');
  const [selectedMode,       setSelectedMode]        = useState<string | null>(account?.mode ?? identity?.mode ?? null);
  const [selectedInterests,  setSelectedInterests]  = useState<string[]>(account?.interests ?? []);
  const [pendingPhotoUri,    setPendingPhotoUri]     = useState<string | null>(null);
  const [photoUploading,     setPhotoUploading]     = useState(false);
  const [localEvents,        setLocalEvents]         = useState<HiladsEvent[]>([]);
  const [saving,             setSaving]             = useState(false);
  const [saved,              setSaved]              = useState(false);
  const [saveError,          setSaveError]          = useState<string | null>(null);
  const [myFriends,          setMyFriends]          = useState<UserDTO[]>([]);
  const [myHangouts,         setMyHangouts]         = useState<ProfileHangout[]>([]);
  const [myChallenges,       setMyChallenges]       = useState<ProfileChallenge[]>([]);
  /** Sub-filter inside the Challenges tab — All / Local / International.
   *  Asymmetric per spec (Local is the hero) but symmetric here because
   *  the user might have lots of both kinds and needs a quick switcher. */
  const [challengeSubTab,    setChallengeSubTab]    = useState<'all' | 'local' | 'international'>('all');
  const [friendsLoading,     setFriendsLoading]     = useState(false);
  const [myReceivedVibes,    setMyReceivedVibes]    = useState<UserVibe[]>([]);
  const [myVibeScore,        setMyVibeScore]        = useState<number | null>(null);
  const [myVibeCount,        setMyVibeCount]        = useState(0);
  const [vibesLoading,       setVibesLoading]       = useState(true);

  useEffect(() => { setLocalEvents(rawEvents); }, [rawEvents]);

  // If navigated here via push notification with a tab param, switch to that tab
  useEffect(() => {
    if (tabParam && validTabs.includes(tabParam as ProfileTab)) {
      setActiveTab(tabParam as ProfileTab);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam]);

  useEffect(() => {
    if (!account?.id) return;
    setFriendsLoading(true);
    fetchUserFriends(account.id)
      .then(data => setMyFriends(data.friends))
      .catch(() => {})
      .finally(() => setFriendsLoading(false));
  }, [account?.id]);

  useEffect(() => {
    if (!account?.id) { setMyHangouts([]); return; }
    fetchUserHangouts(account.id).then(setMyHangouts).catch(() => {});
  }, [account?.id]);

  useEffect(() => {
    if (!account?.id) { setMyChallenges([]); return; }
    fetchUserChallenges(account.id).then(setMyChallenges).catch(() => {});
  }, [account?.id]);

  // Pending incoming friend-request count for the inbox badge. Cheap COUNT
  // endpoint; bumped/decremented via WS so the badge stays fresh without a
  // re-fetch on every focus.
  const [friendReqCount, setFriendReqCount] = useState(0);
  useEffect(() => {
    if (!account?.id) { setFriendReqCount(0); return; }
    fetchIncomingFriendRequestCount().then(setFriendReqCount).catch(() => {});

    const offReceived  = socket.on('friendRequestReceived',  () => setFriendReqCount(c => c + 1));
    const offCancelled = socket.on('friendRequestCancelled', () => setFriendReqCount(c => Math.max(0, c - 1)));
    // Accept/decline both happen on this device → already handled by the
    // hook on the inbox screen. Re-sync from the server when we come back to
    // the Me tab to cover the edge case of multi-device users.
    return () => { offReceived(); offCancelled(); };
  }, [account?.id]);

  useEffect(() => {
    if (!account?.id) { setVibesLoading(false); return; }
    fetchUserVibes(account.id)
      .then(data => {
        setMyReceivedVibes(data.vibes ?? []);
        setMyVibeScore(data.score);
        setMyVibeCount(data.count ?? 0);
      })
      .catch(() => {})
      .finally(() => setVibesLoading(false));
  }, [account?.id]);

  useEffect(() => {
    setUsername(account?.username ?? '');
    setAboutMe(account?.about_me ?? '');
    setHomeCity(account?.home_city ?? '');
    setAgeStr(account?.age != null ? String(account.age) : '');
    setSelectedVibe(account?.vibe ?? 'chill');
    setSelectedMode(account?.mode ?? identity?.mode ?? null);
    setSelectedInterests(account?.interests ?? []);
  }, [account?.username, account?.about_me, account?.home_city, account?.age, account?.vibe, account?.mode, account?.interests]);

  // Version tap easter egg
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleVersionTap() {
    tapCount.current += 1;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => { tapCount.current = 0; }, 2000);
    if (tapCount.current >= 5) { tapCount.current = 0; router.push('/debug'); }
  }

  const myGuestId     = account?.guest_id ?? identity?.guestId ?? '';
  const hostingEvents = localEvents.filter(e => e.guest_id === myGuestId);
  const goingEvents   = localEvents.filter(e => e.guest_id !== myGuestId);

  const isGuest      = !account;
  const avatarBgColor = avatarBg(account?.display_name ?? identity?.nickname ?? '');
  const initials     = (account?.display_name ?? identity?.nickname ?? '?').slice(0, 2).toUpperCase();
  const photoSrc     = pendingPhotoUri ?? account?.thumbAvatarUrl ?? account?.profile_photo_url ?? null;

  // ── Photo picker ─────────────────────────────────────────────────────────────

  async function handlePickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('photoPermTitle'), t('photoPermBody'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setPendingPhotoUri(asset.uri);
    setPhotoUploading(true);
    try {
      const { url, thumbUrl } = await uploadFile(asset.uri, asset.mimeType);
      const { user } = await updateProfile({
        profile_photo_url:       url,
        profile_thumb_photo_url: thumbUrl ?? null,
      } as Parameters<typeof updateProfile>[0]);
      setAccount(user);
      setPendingPhotoUri(null);
    } catch {
      setPendingPhotoUri(null);
      Alert.alert(t('uploadFailTitle'), t('uploadFailBody'));
    } finally {
      setPhotoUploading(false);
    }
  }

  function toggleInterest(interest: string) {
    setSelectedInterests(prev => {
      if (prev.includes(interest)) return prev.filter(i => i !== interest);
      if (prev.length >= 5) return prev;
      return [...prev, interest];
    });
  }

  function handleDeleteEvent(event: HiladsEvent) {
    Alert.alert(t('deleteEventTitle'), t('deleteEventBody', { title: event.title }), [
      { text: t('cancel', { ns: 'common' }), style: 'cancel' },
      {
        text: t('delete'), style: 'destructive',
        onPress: async () => {
          const before = localEvents;
          setLocalEvents(prev => prev.filter(e => e.id !== event.id));
          try {
            await deleteEvent(event.id, account?.guest_id ?? identity?.guestId ?? '');
          } catch {
            setLocalEvents(before);
          }
        },
      },
    ]);
  }

  // Username availability — debounced check (backend excludes the caller's own row).
  type UStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';
  const [uStatus, setUStatus] = useState<UStatus>('idle');
  const [uReason, setUReason] = useState<string | null>(null);
  const uTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleUsernameChange(val: string) {
    const cleaned = val.toLowerCase().replace(/[^a-z0-9_]/g, '');
    setUsername(cleaned);
    setUReason(null);
    if (uTimer.current) clearTimeout(uTimer.current);
    if (cleaned === (account?.username ?? '')) { setUStatus('idle'); return; } // unchanged
    if (cleaned.length < 3) { setUStatus(cleaned.length === 0 ? 'idle' : 'invalid'); return; }
    setUStatus('checking');
    uTimer.current = setTimeout(async () => {
      try {
        const r = await checkUsernameAvailability(cleaned);
        if (!r.valid)         { setUStatus('invalid');   setUReason(r.reason); }
        else if (r.available) { setUStatus('available'); }
        else                  { setUStatus('taken');     setUReason(r.reason); }
      } catch { setUStatus('idle'); }
    }, 450);
  }

  async function handleSave() {
    // Username is the single identity field — it doubles as the display name.
    const handle        = username.trim().toLowerCase();
    const handleChanged = handle !== (account?.username ?? '');
    if (handle.length < 3)     { setSaveError(t('errUsernameShort')); return; }
    if (handleChanged) {
      if (uStatus === 'taken')   { setSaveError(t('errUsernameTaken')); return; }
      if (uStatus === 'invalid') { setSaveError(uReason ?? t('errUsernameInvalid')); return; }
    }
    setSaving(true);
    setSaveError(null);
    try {
      const ageNum = parseInt(ageStr, 10);
      const birthYear = !ageStr.trim()
        ? null
        : (!isNaN(ageNum) && ageNum >= 18 && ageNum <= 100)
          ? new Date().getFullYear() - ageNum
          : undefined;
      const fields = {
        // display_name == username (single identity field).
        username:          handle,
        display_name:      handle,
        about_me:          aboutMe.trim() || null,
        home_city:         homeCity.trim() || null,
        interests:         selectedInterests,
        vibe:              selectedVibe,
        mode:              selectedMode,
        profile_photo_url: account?.profile_photo_url ?? null,
        ...(birthYear !== undefined ? { birth_year: birthYear } : {}),
      } as unknown as Parameters<typeof updateProfile>[0];
      const { user } = await updateProfile(fields);
      setAccount(user);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setSaveError(t('errSave'));
    } finally {
      setSaving(false);
    }
  }

  function handleGuestMode(key: string) {
    const next = selectedMode === key ? null : key;
    setSelectedMode(next);
    if (identity) {
      const updated = { ...identity, mode: next ?? undefined };
      setIdentity(updated);
      saveIdentity(updated).catch(() => {});
    }
  }

  function handleLogout() {
    Alert.alert(t('signOutTitle'), t('signOutBody'), [
      { text: t('cancel', { ns: 'common' }), style: 'cancel' },
      { text: t('signOut'), style: 'destructive', onPress: () => logout() },
    ]);
  }

  function handleDeleteAccount() {
    Alert.alert(
      t('deleteAccountTitle'),
      t('deleteAccountBody'),
      [
        { text: t('cancel', { ns: 'common' }), style: 'cancel' },
        {
          text: t('deleteAccountConfirm'), style: 'destructive',
          onPress: async () => {
            try { await deleteAccount(); await logout(); }
            catch { Alert.alert(t('errorTitle'), t('deleteAccountFail')); }
          },
        },
      ],
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* Persistent app header */}
      <View style={styles.appHeaderWrap}>
        <AppHeader />
      </View>

      {/* ══ STICKY: Page header ══════════════════════════════════════════════ */}
      <View style={styles.header}>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('title')}</Text>
        </View>
        <View style={styles.headerRight}>
          <LanguageRow trigger="flag" />
        </View>
      </View>

      {/* ══ SCROLLABLE CONTENT ═══════════════════════════════════════════════ */}
      {/* Identity block (avatar + mode + filter pills) now lives INSIDE the
          ScrollView as its first child so it scrolls away with the rest of
          the page. Only the top AppHeader stays pinned. */}
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}
      >

        {/* Identity + Mode + Filter pills (registered only) */}
        {!isGuest && (
          <View style={styles.stickyIdentity}>

            {/* Identity row — avatar + name + badge + description */}
            <View style={styles.identityRow}>
              <TouchableOpacity
                style={styles.avatarWrap}
                onPress={handlePickPhoto}
                activeOpacity={0.8}
                disabled={photoUploading}
              >
                {photoSrc ? (
                  <Image source={{ uri: photoSrc }} style={styles.avatarSm} resizeMode="cover" />
                ) : (
                  <View style={[styles.avatarSmFallback, { backgroundColor: avatarBgColor }]}>
                    <Text style={styles.avatarSmInitials}>{initials}</Text>
                  </View>
                )}
                {photoUploading ? (
                  <View style={styles.avatarSmOverlay}>
                    <ActivityIndicator color="#fff" size="small" />
                  </View>
                ) : (
                  <View style={styles.cameraBadgeSm}>
                    <Text style={styles.cameraEmoji}>📷</Text>
                  </View>
                )}
              </TouchableOpacity>

              <View style={styles.identityInfo}>
                <Text style={styles.identityName} numberOfLines={1}>
                  {account?.username ? `@${account.username}` : (account?.display_name ?? '—')}
                </Text>
                <View style={styles.identityMetaRow}>
                  {account?.primaryBadge && (
                    <View style={[styles.memberBadge, meBadgeBg(account.primaryBadge.key)]}>
                      <Text style={[styles.memberBadgeText, meBadgeColor(account.primaryBadge.key)]}>
                        {t(`badge.${account.primaryBadge.key}`, { ns: 'common', defaultValue: account.primaryBadge.label })}
                      </Text>
                    </View>
                  )}
                  {homeCity ? (
                    <Text style={styles.identityMetaCity} numberOfLines={1}>📍 {homeCity}</Text>
                  ) : null}
                </View>
                {selectedVibe && VIBES.find(v => v.key === selectedVibe) ? (
                  <Text style={styles.identityMetaVibe}>
                    {VIBES.find(v => v.key === selectedVibe)!.emoji}{' '}
                    {t(`vibe.${selectedVibe}`, { ns: 'common' })}
                  </Text>
                ) : null}
              </View>
            </View>

            {/* Mode selector — compact 2-button toggle */}
            <View style={styles.modeSection}>
              <Text style={styles.modeSectionLabel}>{t('modeHeading', { ns: 'common' })}</Text>
              <View style={styles.modeSelectorRow}>
                {MODES.map(m => {
                  const active = selectedMode === m.key;
                  return (
                    <TouchableOpacity
                      key={m.key}
                      style={[styles.modeBtn, active && styles.modeBtnActive]}
                      onPress={() => setSelectedMode(active ? null : m.key)}
                      activeOpacity={0.75}
                    >
                      <Text style={styles.modeBtnEmoji}>{m.emoji}</Text>
                      <Text style={[styles.modeBtnLabel, active && styles.modeBtnLabelActive]}>{t(`mode.${m.key}.label`, { ns: 'common' })}</Text>
                      <Text style={styles.modeBtnDesc}>{t(`mode.${m.key}.desc`, { ns: 'common' })}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Filter pills — scrollable for 5 tabs */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterBar}
            >
              {PROFILE_TABS.map(key => (
                <TouchableOpacity
                  key={key}
                  style={[styles.filterPill, activeTab === key && styles.filterPillActive]}
                  onPress={() => setActiveTab(key)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.filterPillLabel, activeTab === key && styles.filterPillLabelActive]}>
                    {tabLabel(key)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── Guest: avatar + mode + upgrade CTA ── */}
        {isGuest && (
          <>
            <View style={[styles.avatarSection, { paddingTop: Spacing.md, paddingBottom: Spacing.xs }]}>
              <View style={[styles.avatarFallback, { backgroundColor: avatarBgColor }]}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
              <Text style={styles.avatarName}>{identity?.nickname ?? '—'}</Text>
              <View style={styles.badgeBlock}>
                <View style={[styles.memberBadge, meBadgeBg('ghost')]}>
                  <Text style={[styles.memberBadgeText, meBadgeColor('ghost')]}>{t('badge.ghost', { ns: 'common' })}</Text>
                </View>
                <Text style={styles.badgeMicrocopy}>{t('ghostBrowsing')}</Text>
              </View>
              <Text style={styles.accountType}>{t('guestSession')}</Text>
            </View>

            <View style={styles.guestModeCard}>
              <Text style={styles.guestModeLabel}>{t('modeHeading', { ns: 'common' })}</Text>
              <View style={styles.modeSelectorRow}>
                {MODES.map(m => {
                  const active = selectedMode === m.key;
                  return (
                    <TouchableOpacity
                      key={m.key}
                      style={[styles.modeBtn, active && styles.modeBtnActive]}
                      onPress={() => handleGuestMode(m.key)}
                      activeOpacity={0.75}
                    >
                      <Text style={styles.modeBtnEmoji}>{m.emoji}</Text>
                      <Text style={[styles.modeBtnLabel, active && styles.modeBtnLabelActive]}>{t(`mode.${m.key}.label`, { ns: 'common' })}</Text>
                      <Text style={styles.modeBtnDesc}>{t(`mode.${m.key}.desc`, { ns: 'common' })}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.upgradeCard}>
              <Text style={styles.upgradeTitle}>{t('makeItYours')}</Text>
              <Text style={styles.upgradeSub}>{t('upgradeSub')}</Text>
              <PrimaryButton label={t('createAccount')} onPress={() => router.push('/sign-up')} />
              <Text style={styles.upgradeSignInHint}>{t('haveAccount')}</Text>
              <TouchableOpacity style={styles.upgradeSecondary} onPress={() => router.push('/sign-in')} activeOpacity={0.8}>
                <Text style={styles.upgradeSecondaryText}>{t('signIn')}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ── Tab: Interests ── */}
        {!isGuest && activeTab === 'interests' && (
          <>
            <View style={styles.fieldsCard}>
              {/* USERNAME */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{t('fieldUsername')}</Text>
                <View style={styles.usernameRow}>
                  <Text style={styles.usernameAt}>@</Text>
                  <TextInput
                    style={styles.usernameInput}
                    value={username}
                    onChangeText={handleUsernameChange}
                    placeholder={t('usernamePlaceholder')}
                    placeholderTextColor={Colors.muted2}
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={20}
                  />
                  {uStatus === 'checking' && <ActivityIndicator size="small" color={Colors.muted} />}
                  {uStatus === 'available' && <Text style={styles.uOk}>✓</Text>}
                  {(uStatus === 'taken' || uStatus === 'invalid') && <Text style={styles.uBad}>✗</Text>}
                </View>
                {uStatus === 'available' && <Text style={styles.uOkHint}>{t('available', { username })}</Text>}
                {(uStatus === 'taken' || uStatus === 'invalid') && uReason && (
                  <Text style={styles.uBadHint}>{uReason}</Text>
                )}
              </View>

              {/* ABOUT ME */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{t('fieldAbout')} <Text style={styles.fieldLabelMeta}>{t('aboutLeft', { count: 150 - aboutMe.length })}</Text></Text>
                <TextInput
                  style={[styles.fieldInput, styles.fieldInputMultiline]}
                  value={aboutMe}
                  onChangeText={setAboutMe}
                  placeholder={t('aboutPlaceholder')}
                  placeholderTextColor={Colors.muted2}
                  maxLength={150}
                  multiline
                  numberOfLines={2}
                  textAlignVertical="top"
                />
              </View>

              {/* EMAIL — read only */}
              {account?.email ? (
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>{t('fieldEmail')}</Text>
                  <TextInput
                    style={[styles.fieldInput, styles.fieldInputReadOnly]}
                    value={account.email}
                    editable={false}
                    selectTextOnFocus={false}
                  />
                </View>
              ) : null}

              {/* HOME CITY */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{t('fieldHomeCity')}</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={homeCity}
                  onChangeText={setHomeCity}
                  placeholder={t('homeCityPlaceholder')}
                  placeholderTextColor={Colors.muted2}
                  maxLength={60}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>

              {/* AGE */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{t('fieldAge')}</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={ageStr}
                  onChangeText={text => setAgeStr(text.replace(/[^0-9]/g, ''))}
                  placeholder={t('agePlaceholder')}
                  placeholderTextColor={Colors.muted2}
                  keyboardType="number-pad"
                  maxLength={3}
                />
              </View>

              {/* MY VIBE */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{t('fieldMyVibe')}</Text>
                <View style={styles.chipsWrap}>
                  {VIBES.map(v => {
                    const active = selectedVibe === v.key;
                    return (
                      <TouchableOpacity
                        key={v.key}
                        style={[styles.vibeChip, active && styles.vibeChipActive]}
                        onPress={() => setSelectedVibe(v.key)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.vibeChipText, active && styles.vibeChipTextActive]}>
                          {v.emoji} {t(`vibe.${v.key}`, { ns: 'common' })}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* INTERESTS */}
              <View style={[styles.fieldGroup, styles.fieldGroupLast]}>
                <Text style={styles.fieldLabel}>
                  {t('fieldInterests')}{' '}
                  <Text style={styles.fieldLabelHint}>{t('interestsHint')}</Text>
                </Text>
                <View style={styles.chipsWrap}>
                  {INTERESTS.map(interest => {
                    const selected = selectedInterests.includes(interest);
                    return (
                      <TouchableOpacity
                        key={interest}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => toggleInterest(interest)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                          {t(`interest.${interest}`, { defaultValue: interest })}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>

            {/* Version tap */}
            <TouchableOpacity onPress={handleVersionTap} activeOpacity={1} style={styles.versionWrap}>
              <Text style={styles.version}>v{APP_VERSION}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Tab: Challenges (created + accepted; owner tagged "Host") ── */}
        {!isGuest && activeTab === 'challenges' && (() => {
          // Filter by sub-tab (Local / International / All). Local default
          // for rows that pre-date the migration (server returns 'local').
          const filteredChallenges = challengeSubTab === 'all'
            ? myChallenges
            : myChallenges.filter(c => (c.mode ?? 'local') === challengeSubTab);
          return (
          <>
            {/* PR2: entry-point to per-acceptance threads. Sits above the
                list of created/accepted challenges so the user finds their
                1:1 conversations quickly. */}
            <TouchableOpacity
              style={styles.friendReqRow}
              onPress={() => router.push('/threads' as never)}
              activeOpacity={0.7}
            >
              <View style={styles.friendReqIcon}>
                <Ionicons name="chatbubbles-outline" size={18} color={Colors.accent} />
              </View>
              <Text style={styles.friendReqLabel}>{t('threads.title', { ns: 'challenge' })}</Text>
              <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
            </TouchableOpacity>

            {/* Mode sub-tabs — All / Local / International. */}
            <View style={styles.subTabsRow}>
              {(['all', 'local', 'international'] as const).map(key => {
                const active = challengeSubTab === key;
                const emoji  = key === 'all' ? '✨' : key === 'local' ? '🏙️' : '🌐';
                return (
                  <TouchableOpacity
                    key={key}
                    style={[styles.subTabBtn, active && styles.subTabBtnActive]}
                    onPress={() => setChallengeSubTab(key)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.subTabText, active && styles.subTabTextActive]}>
                      {emoji} {key === 'all'
                        ? t('modeFilter.all',   { ns: 'challenge' })
                        : t(`mode.${key}`,      { ns: 'challenge' })}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

          <View style={styles.eventsCard}>
            {filteredChallenges.length === 0 ? (
              <Text style={styles.eventsEmpty}>{t('noChallenges')}</Text>
            ) : filteredChallenges.map((c, idx) => (
              <View key={c.id}>
                {idx > 0 && <View style={styles.divider} />}
                <TouchableOpacity
                  style={styles.eventRow}
                  onPress={() => router.push(`/challenge/${c.id}` as never)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.eventIcon}>{CHALLENGE_ICONS[c.challenge_type] ?? '🔥'}</Text>
                  <View style={styles.eventInfo}>
                    <Text style={styles.eventTitle} numberOfLines={1}>{c.title}</Text>
                  </View>
                  {(c.mode ?? 'local') === 'international' && (
                    <View style={[styles.hostTag, { backgroundColor: 'rgba(56,189,248,0.10)', borderColor: 'rgba(56,189,248,0.30)' }]}>
                      <Text style={[styles.hostTagText, { color: '#38bdf8' }]}>🌐</Text>
                    </View>
                  )}
                  {c.status === 'validated' && (
                    <View style={[styles.hostTag, { backgroundColor: 'rgba(34,197,94,0.10)', borderColor: 'rgba(34,197,94,0.20)' }]}>
                      <Text style={[styles.hostTagText, { color: '#4ade80' }]}>✓</Text>
                    </View>
                  )}
                  {c.is_owner && (
                    <View style={styles.hostTag}><Text style={styles.hostTagText}>{t('host')}</Text></View>
                  )}
                </TouchableOpacity>
              </View>
            ))}
          </View>
          </>
          )
        })()}

        {/* ── Tab: Hangouts (joined + owned; owner tagged "Host") ── */}
        {!isGuest && activeTab === 'hangouts' && (
          <View style={styles.eventsCard}>
            {myHangouts.length === 0 ? (
              <Text style={styles.eventsEmpty}>{t('noHangouts')}</Text>
            ) : myHangouts.map((h, idx) => (
              <View key={h.id}>
                {idx > 0 && <View style={styles.divider} />}
                <TouchableOpacity
                  style={styles.eventRow}
                  onPress={() => router.push(`/topic/${h.id}`)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.eventIcon}>{HANGOUT_ICONS[h.category ?? 'general'] ?? '💬'}</Text>
                  <View style={styles.eventInfo}>
                    <Text style={styles.eventTitle} numberOfLines={1}>{h.title}</Text>
                  </View>
                  {h.is_owner && <View style={styles.hostTag}><Text style={styles.hostTagText}>{t('host')}</Text></View>}
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* ── Tab: Events (Going + Hosting) ── */}
        {!isGuest && activeTab === 'events' && (
          <View style={styles.eventsCard}>
            {eventsLoading ? (
              <ActivityIndicator color={Colors.muted} style={{ paddingVertical: Spacing.md }} />
            ) : (
              <>
                <Text style={styles.eventsLabel}>{t('going')}</Text>
                {goingEvents.length === 0 ? (
                  <Text style={styles.eventsEmpty}>{t('noPlans')}</Text>
                ) : goingEvents.map((event, idx) => {
                  const now    = Date.now() / 1000;
                  const isLive = event.starts_at <= now && event.expires_at > now;
                  const icon   = EVENT_ICONS[event.event_type] ?? '📌';
                  const recur  = formatRecurrence(event);
                  return (
                    <View key={event.id}>
                      {idx > 0 && <View style={styles.divider} />}
                      <TouchableOpacity
                        style={styles.eventRow}
                        onPress={() => router.push(`/event/${event.id}`)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.eventIcon}>{icon}</Text>
                        <View style={styles.eventInfo}>
                          <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
                          {recur && (
                            <Text style={styles.eventRecurrence}>{recur}</Text>
                          )}
                          <View style={styles.eventBadgeRow}>
                            {isLive && (
                              <View style={styles.livePill}>
                                <Text style={styles.livePillText}>{t('live')}</Text>
                              </View>
                            )}
                          </View>
                        </View>
                      </TouchableOpacity>
                    </View>
                  );
                })}

                <Text style={[styles.eventsLabel, { marginTop: 20 }]}>{t('hosting')}</Text>
                {hostingEvents.length === 0 ? (
                  <Text style={styles.eventsEmpty}>{t('nothingHosted')}</Text>
                ) : hostingEvents.map((event, idx) => {
                  const now    = Date.now() / 1000;
                  const isLive = event.starts_at <= now && event.expires_at > now;
                  const icon   = EVENT_ICONS[event.event_type] ?? '📌';
                  const recur  = formatRecurrence(event);
                  return (
                    <View key={event.id}>
                      {idx > 0 && <View style={styles.divider} />}
                      <TouchableOpacity
                        style={styles.eventRow}
                        onPress={() => router.push(`/event/${event.id}`)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.eventIcon}>{icon}</Text>
                        <View style={styles.eventInfo}>
                          <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
                          {recur && (
                            <Text style={styles.eventRecurrence}>{recur}</Text>
                          )}
                          <View style={styles.eventBadgeRow}>
                            {isLive && (
                              <View style={styles.livePill}>
                                <Text style={styles.livePillText}>{t('live')}</Text>
                              </View>
                            )}
                            {recur && (
                              <View style={styles.recurPill}>
                                <Ionicons name="refresh" size={10} color={Colors.violet} />
                                <Text style={styles.recurPillText}>{t('recurring')}</Text>
                              </View>
                            )}
                          </View>
                        </View>
                        <TouchableOpacity
                          style={styles.deleteBtn}
                          onPress={() => handleDeleteEvent(event)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={styles.deleteBtnText}>×</Text>
                        </TouchableOpacity>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </>
            )}
          </View>
        )}

        {/* ── Tab: Friends ── */}
        {!isGuest && activeTab === 'friends' && (
          <>
            {/* Friend requests inbox row — always visible on the Friends tab.
                Badge shows pending incoming count; tapping opens the inbox. */}
            <TouchableOpacity
              style={styles.friendReqRow}
              onPress={() => router.push('/friend-requests' as never)}
              activeOpacity={0.7}
            >
              <View style={styles.friendReqIcon}>
                <Ionicons name="person-add-outline" size={18} color={Colors.accent} />
              </View>
              <Text style={styles.friendReqLabel}>{t('friendRequests')}</Text>
              {friendReqCount > 0 && (
                <View style={styles.friendReqBadge}>
                  <Text style={styles.friendReqBadgeText}>{friendReqCount > 9 ? '9+' : friendReqCount}</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
            </TouchableOpacity>

          <View style={styles.eventsCard}>
            <Text style={styles.eventsLabel}>{t('myFriends')}</Text>
            {friendsLoading ? (
              <ActivityIndicator color={Colors.muted} style={{ paddingVertical: Spacing.md }} />
            ) : myFriends.length === 0 ? (
              <Text style={styles.eventsEmpty}>{t('noFriends')}</Text>
            ) : (
              myFriends.map((f, idx) => (
                <View key={f.id}>
                  {idx > 0 && <View style={styles.divider} />}
                  <TouchableOpacity
                    style={styles.friendRow}
                    onPress={() => router.push({ pathname: '/user/[id]', params: { id: f.id, name: f.displayName } })}
                    activeOpacity={0.7}
                  >
                    {f.avatarUrl ? (
                      <Image source={{ uri: f.avatarUrl }} style={styles.friendAvatar} />
                    ) : (
                      <View style={[styles.friendAvatarFallback, { backgroundColor: avatarBg(f.displayName) }]}>
                        <Text style={styles.friendAvatarInitial}>{f.displayName[0]?.toUpperCase()}</Text>
                      </View>
                    )}
                    <View style={styles.friendInfo}>
                      <Text style={styles.friendName} numberOfLines={1}>{f.displayName}</Text>
                      {f.badges[0] && (
                        <Text style={styles.friendBadgeText}>
                          {t(`badge.${f.badges[0]}`, { ns: 'common', defaultValue: BADGE_META[f.badges[0] as keyof typeof BADGE_META]?.label ?? f.badges[0] })}
                        </Text>
                      )}
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
          </>
        )}

        {/* ── Tab: Vibes ── */}
        {!isGuest && activeTab === 'vibes' && (
          <View style={styles.eventsCard}>
            <Text style={styles.eventsLabel}>{t('vibesReceived')}</Text>
            {vibesLoading ? (
              <ActivityIndicator color={Colors.muted} style={{ paddingVertical: Spacing.md }} />
            ) : (
              <>
                {myVibeCount > 0 && (
                  <View style={styles.vibeScoreCard}>
                    <View style={styles.vibeStarsRow}>
                      {[1,2,3,4,5].map(s => (
                        <Text key={s} style={s <= Math.round(myVibeScore ?? 0) ? styles.vibeStarOn : styles.vibeStarOff}>★</Text>
                      ))}
                    </View>
                    <Text style={styles.vibeScoreAvg}>{t('vibeScore', { score: myVibeScore?.toFixed(1) })}</Text>
                    <Text style={styles.vibeScoreCount}>{t('vibeBasis', { count: myVibeCount })}</Text>
                  </View>
                )}
                {myReceivedVibes.length > 0 ? (
                  myReceivedVibes.map((v, idx) => (
                    <View key={v.id}>
                      {(idx > 0 || myVibeCount > 0) && <View style={styles.divider} />}
                      <View style={styles.receivedVibeRow}>
                        {v.authorPhoto ? (
                          <Image source={{ uri: v.authorPhoto }} style={styles.receivedVibeAvatar} resizeMode="cover" />
                        ) : (
                          <View style={[styles.receivedVibeAvatar, styles.receivedVibeAvatarFallback, { backgroundColor: avatarBg(v.authorName) }]}>
                            <Text style={styles.receivedVibeAvatarInitial}>{(v.authorName || '?')[0].toUpperCase()}</Text>
                          </View>
                        )}
                        <View style={styles.receivedVibeContent}>
                          <View style={styles.receivedVibeHeader}>
                            <Text style={styles.receivedVibeAuthor}>{v.authorName}</Text>
                            <Text style={styles.receivedVibeRating}>{'★'.repeat(v.rating)}</Text>
                          </View>
                          {v.message ? <Text style={styles.receivedVibeMsg}>{v.message}</Text> : null}
                        </View>
                      </View>
                    </View>
                  ))
                ) : (
                  <>
                    <Text style={styles.eventsEmpty}>{t('noVibes')}</Text>
                    <Text style={styles.eventsEmpty}>{t('noVibesSub')}</Text>
                  </>
                )}
              </>
            )}
          </View>
        )}

        {/* ── Settings (registered only) — Apple G1.2 requires reachable Block management ── */}
        {!isGuest && (
          <View style={styles.settingsCard}>
            <Text style={styles.settingsLabel}>{t('settings')}</Text>
            <TouchableOpacity
              style={styles.settingsRow}
              onPress={() => router.push('/blocked-users' as never)}
              activeOpacity={0.7}
            >
              <Ionicons name="ban-outline" size={18} color={Colors.muted} />
              <Text style={styles.settingsRowLabel}>{t('blockedUsers')}</Text>
              <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>

      {/* ══ STICKY: Save CTA (registered only) ══════════════════════════════ */}
      {!isGuest && (
        <View style={[styles.stickyCta, { paddingBottom: Math.max(12, insets.bottom) }]}>
          {saveError ? <Text style={styles.saveError}>{saveError}</Text> : null}
          <PrimaryButton
            label={saved ? t('saved') : t('saveProfile')}
            onPress={handleSave}
            disabled={photoUploading}
            loading={saving}
          />
          <View style={styles.stickyBottomRow}>
            <TouchableOpacity style={styles.stickySignOut} onPress={handleLogout} activeOpacity={0.6}>
              <Text style={styles.stickySignOutText}>{t('signOut')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.stickyDeleteAccount} onPress={handleDeleteAccount} activeOpacity={0.6}>
              <Text style={styles.stickyDeleteAccountText}>{t('deleteAccount')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: Colors.bg },
  scrollView: { flex: 1 },

  // ── Page header ───────────────────────────────────────────────────────────
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    minHeight:         56,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor:   Colors.bg,
  },
  // No borderBottom — header flows directly into the tab sub-header,
  // matching MY CITY's look.
  appHeaderWrap: {
    paddingHorizontal: Spacing.md,
    paddingTop:        10,
    paddingBottom:     12,
    backgroundColor:   Colors.bg2,
  },
  headerCenter: {
    flex:       1,
    alignItems: 'center',
  },
  // Absolute-right so the title stays optically centered regardless of the
  // flag button's width.
  headerRight: {
    position:       'absolute',
    right:          Spacing.md,
    top:            0,
    bottom:         0,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize:      FontSizes.xl,
    fontWeight:    '700',
    color:         Colors.text,
    letterSpacing: -0.3,
  },

  // ── Sticky identity block ─────────────────────────────────────────────────
  stickyIdentity: {
    backgroundColor:   Colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingBottom:     Spacing.xs,
  },

  // Identity row: avatar left, info right
  identityRow: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingTop:        Spacing.md,
    paddingBottom:     Spacing.sm,
    gap:               Spacing.md,
  },
  avatarWrap: { position: 'relative' },
  avatarSm: {
    width:        68,
    height:       68,
    borderRadius: Radius.full,
    borderWidth:  2,
    borderColor:  Colors.accent,
  },
  avatarSmFallback: {
    width:           68,
    height:          68,
    borderRadius:    Radius.full,
    alignItems:      'center',
    justifyContent:  'center',
  },
  avatarSmInitials: {
    fontSize:   FontSizes.xl,
    fontWeight: '700',
    color:      Colors.white,
  },
  avatarSmOverlay: {
    position:        'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    borderRadius:    Radius.full,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  cameraBadgeSm: {
    position:        'absolute',
    bottom:          0,
    right:           0,
    width:           22,
    height:          22,
    borderRadius:    11,
    backgroundColor: Colors.bg2,
    borderWidth:     1.5,
    borderColor:     Colors.border,
    alignItems:      'center',
    justifyContent:  'center',
  },
  cameraEmoji:   { fontSize: 11 },
  identityInfo:  { flex: 1, gap: 4 },
  identityName: {
    fontSize:      FontSizes.lg,
    fontWeight:    '700',
    color:         Colors.text,
    letterSpacing: -0.3,
  },
  identityHandle: {
    fontSize:   FontSizes.sm,
    color:      Colors.muted,
    fontWeight: '500',
  },
  identityMetaRow: {
    flexDirection: 'row',
    alignItems:    'center',
    flexWrap:      'wrap',
    gap:           6,
  },
  identityMetaCity: {
    fontSize:   FontSizes.xs,
    color:      Colors.muted,
    fontWeight: '500',
  },
  identityMetaVibe: {
    fontSize:   FontSizes.xs,
    color:      Colors.muted,
    fontWeight: '500',
  },

  // Mode selector (compact, inside sticky identity block)
  modeSection: {
    paddingHorizontal: Spacing.md,
    paddingBottom:     Spacing.sm,
    gap:               8,
  },
  modeSectionLabel: {
    fontSize:      FontSizes.xs,
    fontWeight:    '800',
    color:         '#60a5fa',
    letterSpacing: 1,
  },
  modeSelectorRow: {
    flexDirection: 'row',
    gap:           10,
  },
  modeBtn: {
    flex:              1,
    paddingVertical:   10,
    paddingHorizontal: 8,
    borderRadius:      Radius.md,
    borderWidth:       1.5,
    borderColor:       Colors.border,
    backgroundColor:   'transparent',
    alignItems:        'center',
    gap:               2,
  },
  modeBtnActive: {
    borderColor:     '#60a5fa',
    backgroundColor: 'rgba(96,165,250,0.16)',
  },
  modeBtnEmoji:  { fontSize: 22, lineHeight: 26 },
  modeBtnLabel: {
    fontSize:   FontSizes.sm,
    fontWeight: '700',
    color:      Colors.muted,
  },
  modeBtnLabelActive: { color: '#fff' },
  modeBtnDesc: {
    fontSize:   FontSizes.xs,
    color:      Colors.muted2,
    textAlign:  'center',
    lineHeight: 15,
  },

  // Filter pills — used as contentContainerStyle of horizontal ScrollView
  filterBar: {
    flexDirection:  'row',
    paddingLeft:    Spacing.md,
    paddingRight:   Spacing.md,
    paddingBottom:  Spacing.sm,
    gap:            8,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical:   6,
    borderRadius:      20,
    borderWidth:       1,
    borderColor:       Colors.border,
    backgroundColor:   Colors.bg2,
  },
  filterPillActive: {
    borderColor:     Colors.accent,
    backgroundColor: Colors.accent + '18',
  },
  filterPillLabel: {
    fontSize:   FontSizes.sm,
    fontWeight: '600',
    color:      Colors.muted,
  },
  filterPillLabelActive: {
    color: Colors.accent,
  },

  // ── Guest avatar section (scroll content) ─────────────────────────────────
  avatarSection: {
    alignItems:    'center',
    paddingTop:    Spacing.xl,
    paddingBottom: Spacing.lg,
    gap:           Spacing.sm,
  },
  avatarFallback: {
    width:           96,
    height:          96,
    borderRadius:    Radius.full,
    alignItems:      'center',
    justifyContent:  'center',
  },
  avatarInitials: {
    fontSize:   FontSizes.xxl,
    fontWeight: '700',
    color:      Colors.white,
  },
  avatarName: {
    fontSize:      FontSizes.xl,
    fontWeight:    '700',
    color:         Colors.text,
    letterSpacing: -0.3,
    marginTop:     Spacing.xs,
  },
  accountType: {
    fontSize: FontSizes.sm,
    color:    Colors.muted,
  },
  badgeBlock:    { alignItems: 'center', gap: 4 },
  badgeMicrocopy: { fontSize: FontSizes.xs, color: Colors.muted2, textAlign: 'center' },

  memberBadge: {
    borderRadius:      Radius.full,
    paddingHorizontal: 10,
    paddingVertical:   3,
    borderWidth:       1,
  },
  memberBadgeText: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    letterSpacing: 0.3,
  },

  // ── Guest mode card ───────────────────────────────────────────────────────
  guestModeCard: {
    marginHorizontal: Spacing.md,
    marginBottom:     Spacing.md,
    padding:          Spacing.md,
    backgroundColor:  Colors.bg2,
    borderRadius:     Radius.lg,
    borderWidth:      1,
    borderColor:      Colors.border,
    gap:              10,
  },
  guestModeLabel: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         Colors.muted,
    letterSpacing: 0.8,
  },

  // ── Fields card ───────────────────────────────────────────────────────────
  fieldsCard: {
    marginHorizontal: Spacing.md,
    marginTop:        Spacing.md,
    marginBottom:     Spacing.md,
    backgroundColor:  Colors.bg2,
    borderRadius:     Radius.lg,
    borderWidth:      1,
    borderColor:      Colors.border,
    overflow:         'hidden',
    padding:          Spacing.md,
    gap:              Spacing.md,
  },
  fieldGroup: {
    gap:               8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingBottom:     Spacing.md,
  },
  fieldGroupLast: { borderBottomWidth: 0, paddingBottom: 0 },
  fieldLabel: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         Colors.muted,
    letterSpacing: 0.8,
  },
  fieldLabelHint: {
    fontSize:      FontSizes.xs,
    fontWeight:    '400',
    color:         Colors.muted2,
    letterSpacing: 0,
  },
  fieldInput: {
    backgroundColor:   Colors.bg3,
    borderRadius:      Radius.md,
    borderWidth:       1,
    borderColor:       Colors.border,
    paddingHorizontal: 14,
    paddingVertical:   Platform.OS === 'ios' ? 13 : 10,
    color:             Colors.text,
    fontSize:          FontSizes.md,
  },
  fieldInputReadOnly: {
    color:           Colors.muted,
    backgroundColor: Colors.bg,
  },
  usernameRow: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               6,
    backgroundColor:   Colors.bg3,
    borderRadius:      Radius.md,
    borderWidth:       1,
    borderColor:       Colors.border,
    paddingHorizontal: 14,
  },
  usernameAt:    { fontSize: FontSizes.md, color: Colors.muted2, fontWeight: '600' },
  usernameInput: { flex: 1, color: Colors.text, fontSize: FontSizes.md, paddingVertical: Platform.OS === 'ios' ? 13 : 10 },
  uOk:           { color: '#4ade80', fontSize: FontSizes.md, fontWeight: '700' },
  uBad:          { color: Colors.red, fontSize: FontSizes.md, fontWeight: '700' },
  uOkHint:       { fontSize: FontSizes.xs, color: '#4ade80', marginTop: 4 },
  uBadHint:      { fontSize: FontSizes.xs, color: Colors.red, marginTop: 4 },
  fieldInputMultiline: {
    minHeight:        56,
    textAlignVertical: 'top',
    paddingTop:        Platform.OS === 'ios' ? 13 : 10,
  },
  fieldLabelMeta: {
    fontSize:      FontSizes.xs,
    fontWeight:    '400',
    color:         Colors.muted2,
    letterSpacing: 0,
  },

  // Chips
  chipsWrap:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical:   8,
    borderRadius:      Radius.full,
    backgroundColor:   'rgba(255,122,60,0.06)',
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.20)',
  },
  chipSelected:      { backgroundColor: Colors.accent, borderColor: Colors.accent },
  chipText:          { fontSize: FontSizes.sm, color: Colors.muted, fontWeight: '500' },
  chipTextSelected:  { color: Colors.white, fontWeight: '700' },
  vibeChip: {
    paddingHorizontal: 14,
    paddingVertical:   9,
    borderRadius:      Radius.full,
    backgroundColor:   'rgba(255,255,255,0.04)',
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.12)',
  },
  vibeChipActive:     { backgroundColor: 'rgba(255,122,60,0.18)', borderColor: Colors.accent },
  vibeChipText:       { fontSize: FontSizes.sm, color: Colors.muted, fontWeight: '500' },
  vibeChipTextActive: { color: Colors.text, fontWeight: '700' },

  hostTag: {
    backgroundColor: 'rgba(96,165,250,0.14)', borderRadius: Radius.full,
    paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: 'rgba(96,165,250,0.25)',
  },
  hostTagText: { fontSize: 10, fontWeight: '700', color: '#60a5fa' },

  // ── Sub-tabs (mode filter inside the Challenges tab) ──────────────────────
  subTabsRow: {
    flexDirection:    'row',
    marginHorizontal: Spacing.md,
    marginTop:        Spacing.xs,
    gap:              6,
  },
  subTabBtn: {
    paddingHorizontal: 10,
    paddingVertical:   5,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.10)',
    backgroundColor:   'rgba(255,255,255,0.04)',
  },
  subTabBtnActive: {
    borderColor:     'rgba(255,122,60,0.45)',
    backgroundColor: 'rgba(255,122,60,0.14)',
  },
  subTabText:       { fontSize: 12, fontWeight: '700', color: Colors.muted, letterSpacing: -0.2 },
  subTabTextActive: { color: '#FF7A3C' },

  // ── Events / generic card ─────────────────────────────────────────────────
  eventsCard: {
    marginHorizontal: Spacing.md,
    marginTop:        Spacing.xs,
    marginBottom:     Spacing.md,
    backgroundColor:  Colors.bg2,
    borderRadius:     Radius.lg,
    borderWidth:      1,
    borderColor:      Colors.border,
    overflow:         'hidden',
    padding:          Spacing.md,
  },
  eventsLabel: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         Colors.muted,
    letterSpacing: 0.8,
    marginBottom:  Spacing.sm,
  },
  eventsEmpty: { fontSize: FontSizes.sm, color: Colors.muted2, paddingVertical: Spacing.sm },
  divider:     { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.sm },

  // ── Settings card ─────────────────────────────────────────────────────────
  settingsCard: {
    marginHorizontal: Spacing.md,
    marginTop:        Spacing.xs,
    marginBottom:     Spacing.md,
    backgroundColor:  Colors.bg2,
    borderRadius:     Radius.lg,
    borderWidth:      1,
    borderColor:      Colors.border,
    overflow:         'hidden',
    padding:          Spacing.md,
  },
  settingsLabel: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         Colors.muted,
    letterSpacing: 0.8,
    marginBottom:  Spacing.sm,
  },
  settingsRow: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            12,
    paddingVertical: Spacing.xs,
  },
  settingsRowLabel: {
    flex:       1,
    fontSize:   FontSizes.md,
    fontWeight: '600',
    color:      Colors.text,
  },

  eventRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  eventIcon:      { fontSize: 18, marginTop: 2 },
  eventInfo:      { flex: 1, gap: 4 },
  eventTitle:     { fontSize: FontSizes.md, fontWeight: '600', color: Colors.text },
  eventRecurrence: { fontSize: FontSizes.sm, color: Colors.muted },
  eventBadgeRow:  { flexDirection: 'row', gap: 6, marginTop: 2 },
  livePill: {
    backgroundColor:   'rgba(255,122,60,0.18)',
    borderRadius:      Radius.full,
    paddingHorizontal: 7,
    paddingVertical:   2,
  },
  livePillText:   { fontSize: 10, fontWeight: '700', color: Colors.accent, letterSpacing: 0.4 },
  recurPill: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    backgroundColor:   'rgba(139,92,246,0.15)',
    borderRadius:      Radius.full,
    paddingHorizontal: 7,
    paddingVertical:   2,
  },
  recurPillText:  { fontSize: 10, fontWeight: '700', color: Colors.violet, letterSpacing: 0.4 },
  deleteBtn:      { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginTop: -2 },
  deleteBtnText:  { fontSize: 22, color: Colors.muted2, lineHeight: 26 },

  // Friend requests inbox row (above MY FRIENDS card on the Friends tab)
  friendReqRow: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             12,
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    paddingVertical:   Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    marginBottom:    Spacing.sm,
    borderWidth:     1,
    borderColor:     Colors.border,
  },
  friendReqIcon: {
    width:           32,
    height:          32,
    borderRadius:    16,
    backgroundColor: 'rgba(255,122,60,0.10)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  friendReqLabel: { flex: 1, fontSize: FontSizes.md, fontWeight: '600', color: Colors.text },
  friendReqBadge: {
    minWidth:          22,
    height:            22,
    borderRadius:      11,
    backgroundColor:   Colors.accent,
    paddingHorizontal: 7,
    alignItems:        'center',
    justifyContent:    'center',
  },
  friendReqBadgeText: { color: Colors.white, fontWeight: '700', fontSize: 11 },

  // Friends
  friendRow:            { flexDirection: 'row', alignItems: 'center', gap: 10 },
  friendAvatar:         { width: 38, height: 38, borderRadius: 19, flexShrink: 0 },
  friendAvatarFallback: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  friendAvatarInitial:  { fontSize: 15, fontWeight: '700', color: '#fff' },
  friendInfo:           { flex: 1, gap: 2 },
  friendName:           { fontSize: FontSizes.md, fontWeight: '600', color: Colors.text },
  friendBadgeText:      { fontSize: FontSizes.xs, color: Colors.muted },

  // Vibes
  vibeScoreCard: {
    alignItems:      'center',
    gap:             4,
    padding:         Spacing.md,
    marginBottom:    Spacing.sm,
    backgroundColor: 'rgba(251,191,36,0.04)',
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     'rgba(251,191,36,0.12)',
  },
  vibeStarsRow:    { flexDirection: 'row', gap: 4 },
  vibeStarOn:      { fontSize: 20, color: '#fbbf24' },
  vibeStarOff:     { fontSize: 20, color: 'rgba(255,255,255,0.12)' },
  vibeScoreAvg:    { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
  vibeScoreCount:  { fontSize: FontSizes.xs, color: Colors.muted2 },
  receivedVibeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: Spacing.xs },
  receivedVibeAvatar: { width: 36, height: 36, borderRadius: 18, flexShrink: 0 },
  receivedVibeAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  receivedVibeAvatarInitial:  { fontSize: 14, fontWeight: '700', color: '#fff' },
  receivedVibeContent:        { flex: 1, gap: 2 },
  receivedVibeHeader:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  receivedVibeAuthor:         { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.text },
  receivedVibeRating:         { fontSize: FontSizes.sm, color: '#fbbf24' },
  receivedVibeMsg:            { fontSize: FontSizes.sm, color: Colors.muted, lineHeight: 18 },

  // ── Sticky CTA bar ────────────────────────────────────────────────────────
  stickyCta: {
    paddingHorizontal: Spacing.md,
    paddingTop:        12,
    backgroundColor:   'rgba(14, 14, 16, 0.92)',
    borderTopWidth:    1,
    borderTopColor:    Colors.border,
    gap:               2,
  },
  stickyBottomRow: {
    flexDirection:     'row',
    justifyContent:    'space-between',
    alignItems:        'center',
    paddingHorizontal: 4,
  },
  stickySignOut:        { paddingVertical: 8 },
  stickySignOutText:    { fontSize: FontSizes.xs, fontWeight: '500', color: Colors.muted2 },
  stickyDeleteAccount:  { paddingVertical: 8 },
  stickyDeleteAccountText: { fontSize: FontSizes.xs, fontWeight: '500', color: 'rgba(248,113,113,0.35)' },
  saveError: { fontSize: FontSizes.sm, color: Colors.red, textAlign: 'center', marginBottom: Spacing.xs },
  // ── Guest upgrade ─────────────────────────────────────────────────────────
  upgradeCard: {
    margin:          Spacing.md,
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     Colors.border,
    padding:         Spacing.md,
    gap:             Spacing.sm,
  },
  upgradeTitle:      { fontSize: FontSizes.lg, fontWeight: '700', color: Colors.text },
  upgradeSub:        { fontSize: FontSizes.sm, color: Colors.muted, lineHeight: 20 },
  upgradeSignInHint: { fontSize: FontSizes.xs, color: Colors.muted, textAlign: 'center' },
  upgradeSecondary:  { borderRadius: Radius.lg, paddingVertical: Spacing.sm, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  upgradeSecondaryText: { color: Colors.text, fontWeight: '600', fontSize: FontSizes.sm },

  // ── Version ───────────────────────────────────────────────────────────────
  versionWrap: { alignItems: 'center', paddingVertical: Spacing.md },
  version:     { fontSize: FontSizes.xs, color: Colors.muted2 },
});
