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
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { useMyEvents } from '@/hooks/useMyEvents';
import { saveIdentity } from '@/lib/identity';
import { updateProfile, deleteAccount } from '@/api/auth';
import { uploadFile } from '@/api/uploads';
import { deleteEvent } from '@/api/events';
import { fetchUserFriends, fetchUserVibes } from '@/api/users';
import type { UserVibe } from '@/api/users';
import { Colors, FontSizes, Spacing, Radius, APP_VERSION } from '@/constants';
import type { HiladsEvent, UserDTO } from '@/types';
import { BADGE_META } from '@/types';

// ── Constants — must match backend allowed lists ──────────────────────────────

const MODES = [
  { key: 'local',     emoji: '🌍', label: 'Local',     desc: 'You know this city'    },
  { key: 'exploring', emoji: '🧭', label: 'Exploring', desc: "You're discovering it" },
] as const;

const VIBES = [
  { key: 'party',       emoji: '🔥', label: 'Party'       },
  { key: 'board_games', emoji: '🎲', label: 'Board Games' },
  { key: 'coffee',      emoji: '☕', label: 'Coffee'       },
  { key: 'music',       emoji: '🎧', label: 'Music'        },
  { key: 'food',        emoji: '🍜', label: 'Food'         },
  { key: 'chill',       emoji: '🧘', label: 'Chill'        },
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

type ProfileTab = 'personal' | 'friends' | 'vibes';

const PROFILE_TABS: { key: ProfileTab; label: string }[] = [
  { key: 'personal', label: 'Personal Info' },
  { key: 'friends',  label: 'Friends'       },
  { key: 'vibes',    label: 'Vibes'         },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const AVATAR_BG = [
  '#7c6aff', '#ff6a9f', '#22d3ee', '#4ade80',
  '#fb923c', '#f472b6', '#818cf8', '#2dd4bf',
];
function avatarBg(name: string): string {
  const hash = (name ?? '').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_BG[hash % AVATAR_BG.length];
}

function cityFlag(countryCode?: string): string {
  if (!countryCode || countryCode.length !== 2) return '';
  return [...countryCode.toUpperCase()]
    .map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
    .join('');
}

const BADGE_MICROCOPY: Record<string, string> = {
  ghost: 'Just browsing 👀',
  fresh: 'Just landed 👶',
  regular: 'Shows up often',
  local: 'Knows the city',
  host:  'Makes it happen 🔥',
};

// ── Badge helpers ─────────────────────────────────────────────────────────────

const ME_BADGE_BG: Record<string, object> = {
  ghost:   { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.10)' },
  fresh:   { backgroundColor: 'rgba(74,222,128,0.12)',  borderColor: 'rgba(74,222,128,0.22)'  },
  regular: { backgroundColor: 'rgba(96,165,250,0.12)',  borderColor: 'rgba(96,165,250,0.22)'  },
  local:   { backgroundColor: 'rgba(52,211,153,0.12)',  borderColor: 'rgba(52,211,153,0.22)'  },
  host:    { backgroundColor: 'rgba(251,191,36,0.15)',  borderColor: 'rgba(251,191,36,0.28)'  },
};
const ME_BADGE_COLOR: Record<string, object> = {
  ghost: { color: '#666' }, fresh: { color: '#4ade80' },
  regular: { color: '#60a5fa' }, local: { color: '#34d399' }, host: { color: '#fbbf24' },
};
function meBadgeBg(key: string): object    { return ME_BADGE_BG[key]    ?? ME_BADGE_BG.regular; }
function meBadgeColor(key: string): object { return ME_BADGE_COLOR[key] ?? ME_BADGE_COLOR.regular; }

// ── Screen ────────────────────────────────────────────────────────────────────

export default function MeScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { identity, account, setAccount, setIdentity, logout, city } = useApp();
  const { events: rawEvents, loading: eventsLoading } = useMyEvents();

  const [activeTab,          setActiveTab]          = useState<ProfileTab>('personal');
  const [displayName,        setDisplayName]        = useState(account?.display_name ?? '');
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
  const [friendsLoading,     setFriendsLoading]     = useState(false);
  const [myReceivedVibes,    setMyReceivedVibes]    = useState<UserVibe[]>([]);
  const [myVibeScore,        setMyVibeScore]        = useState<number | null>(null);
  const [myVibeCount,        setMyVibeCount]        = useState(0);
  const [vibesLoading,       setVibesLoading]       = useState(true);

  useEffect(() => { setLocalEvents(rawEvents); }, [rawEvents]);

  useEffect(() => {
    if (!account?.id) return;
    setFriendsLoading(true);
    fetchUserFriends(account.id)
      .then(data => setMyFriends(data.friends))
      .catch(() => {})
      .finally(() => setFriendsLoading(false));
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
    setDisplayName(account?.display_name ?? '');
    setHomeCity(account?.home_city ?? '');
    setAgeStr(account?.age != null ? String(account.age) : '');
    setSelectedVibe(account?.vibe ?? 'chill');
    setSelectedMode(account?.mode ?? identity?.mode ?? null);
    setSelectedInterests(account?.interests ?? []);
  }, [account?.display_name, account?.home_city, account?.age, account?.vibe, account?.mode, account?.interests]);

  // Version tap easter egg
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleVersionTap() {
    tapCount.current += 1;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => { tapCount.current = 0; }, 2000);
    if (tapCount.current >= 5) { tapCount.current = 0; router.push('/debug'); }
  }

  const isGuest      = !account;
  const avatarBgColor = avatarBg(account?.display_name ?? identity?.nickname ?? '');
  const initials     = (account?.display_name ?? identity?.nickname ?? '?').slice(0, 2).toUpperCase();
  const photoSrc     = pendingPhotoUri ?? account?.profile_photo_url ?? null;

  // ── Photo picker ─────────────────────────────────────────────────────────────

  async function handlePickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to upload a profile picture.');
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
      const url = await uploadFile(asset.uri, asset.mimeType);
      const { user } = await updateProfile({ profile_photo_url: url } as Parameters<typeof updateProfile>[0]);
      setAccount(user);
      setPendingPhotoUri(null);
    } catch {
      setPendingPhotoUri(null);
      Alert.alert('Upload failed', 'Could not upload photo. Please try again.');
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
    Alert.alert('Delete event', `Delete "${event.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
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

  async function handleSave() {
    if (!displayName.trim()) { setSaveError('Display name is required'); return; }
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
        display_name:      displayName.trim(),
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
      setSaveError('Failed to save — try again');
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
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => logout() },
    ]);
  }

  function handleDeleteAccount() {
    Alert.alert(
      'Delete account?',
      'Your profile, friends, and settings will be permanently removed.\n\nThis cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete my account', style: 'destructive',
          onPress: async () => {
            try { await deleteAccount(); await logout(); }
            catch { Alert.alert('Error', 'Could not delete account. Try again.'); }
          },
        },
      ],
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* ══ STICKY: Page header ══════════════════════════════════════════════ */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.push('/(tabs)/chat')} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>My Profile</Text>
        </View>
      </View>

      {/* ══ STICKY: Identity + Mode + Filter pills (registered only) ═════════ */}
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
                {account?.display_name ?? '—'}
              </Text>
              {account?.primaryBadge && (
                <View style={[styles.memberBadge, meBadgeBg(account.primaryBadge.key)]}>
                  <Text style={[styles.memberBadgeText, meBadgeColor(account.primaryBadge.key)]}>
                    {account.primaryBadge.label}
                  </Text>
                </View>
              )}
              <Text style={styles.identitySub}>Update how people see you.</Text>
            </View>
          </View>

          {/* Mode selector — compact 2-button toggle */}
          <View style={styles.modeSection}>
            <Text style={styles.modeSectionLabel}>MODE</Text>
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
                    <Text style={[styles.modeBtnLabel, active && styles.modeBtnLabelActive]}>{m.label}</Text>
                    <Text style={styles.modeBtnDesc}>{m.desc}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Filter pills */}
          <View style={styles.filterBar}>
            {PROFILE_TABS.map(({ key, label }) => (
              <TouchableOpacity
                key={key}
                style={[styles.filterPill, activeTab === key && styles.filterPillActive]}
                onPress={() => setActiveTab(key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.filterPillLabel, activeTab === key && styles.filterPillLabelActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* ══ SCROLLABLE CONTENT ═══════════════════════════════════════════════ */}
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}
      >

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
                  <Text style={[styles.memberBadgeText, meBadgeColor('ghost')]}>👻 Ghost</Text>
                </View>
                <Text style={styles.badgeMicrocopy}>{BADGE_MICROCOPY.ghost}</Text>
              </View>
              <Text style={styles.accountType}>Guest session</Text>
            </View>

            <View style={styles.guestModeCard}>
              <Text style={styles.guestModeLabel}>MODE</Text>
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
                      <Text style={[styles.modeBtnLabel, active && styles.modeBtnLabelActive]}>{m.label}</Text>
                      <Text style={styles.modeBtnDesc}>{m.desc}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.upgradeCard}>
              <Text style={styles.upgradeTitle}>Make it yours</Text>
              <Text style={styles.upgradeSub}>Save your name. Stay in the loop.</Text>
              <TouchableOpacity style={styles.upgradePrimary} onPress={() => router.push('/sign-up')} activeOpacity={0.85}>
                <Text style={styles.upgradePrimaryText}>Create account</Text>
              </TouchableOpacity>
              <Text style={styles.upgradeSignInHint}>Already have an account?</Text>
              <TouchableOpacity style={styles.upgradeSecondary} onPress={() => router.push('/sign-in')} activeOpacity={0.8}>
                <Text style={styles.upgradeSecondaryText}>Sign in</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ── Tab: Personal Info ── */}
        {!isGuest && activeTab === 'personal' && (
          <>
            <View style={styles.fieldsCard}>
              {/* DISPLAY NAME */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>DISPLAY NAME</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="Your display name"
                  placeholderTextColor={Colors.muted2}
                  maxLength={30}
                  autoCorrect={false}
                />
              </View>

              {/* EMAIL — read only */}
              {account?.email ? (
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>EMAIL</Text>
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
                <Text style={styles.fieldLabel}>HOME CITY</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={homeCity}
                  onChangeText={setHomeCity}
                  placeholder="e.g. saigon"
                  placeholderTextColor={Colors.muted2}
                  maxLength={60}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>

              {/* AGE */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>AGE</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={ageStr}
                  onChangeText={text => setAgeStr(text.replace(/[^0-9]/g, ''))}
                  placeholder="e.g. 25"
                  placeholderTextColor={Colors.muted2}
                  keyboardType="number-pad"
                  maxLength={3}
                />
              </View>

              {/* MY VIBE */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>MY VIBE</Text>
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
                          {v.emoji} {v.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* INTERESTS */}
              <View style={[styles.fieldGroup, styles.fieldGroupLast]}>
                <Text style={styles.fieldLabel}>
                  INTERESTS{' '}
                  <Text style={styles.fieldLabelHint}>— pick up to 5</Text>
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
                          {interest}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>

            {/* My Events */}
            <View style={styles.eventsCard}>
              <Text style={styles.eventsLabel}>MY EVENTS</Text>
              {eventsLoading ? (
                <ActivityIndicator color={Colors.muted} style={{ paddingVertical: Spacing.md }} />
              ) : localEvents.length === 0 ? (
                <Text style={styles.eventsEmpty}>No events yet. Create one from the Hot tab.</Text>
              ) : (
                localEvents.map((event, idx) => {
                  const now    = Date.now() / 1000;
                  const isLive = event.starts_at <= now && event.expires_at > now;
                  const icon   = EVENT_ICONS[event.event_type] ?? '📌';
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
                          {event.recurrence_label && (
                            <Text style={styles.eventRecurrence}>{event.recurrence_label}</Text>
                          )}
                          <View style={styles.eventBadgeRow}>
                            {isLive && (
                              <View style={styles.livePill}>
                                <Text style={styles.livePillText}>LIVE</Text>
                              </View>
                            )}
                            {event.recurrence_label && (
                              <View style={styles.recurPill}>
                                <Ionicons name="refresh" size={10} color={Colors.violet} />
                                <Text style={styles.recurPillText}>RECURRING</Text>
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
                })
              )}
            </View>

            {/* Version tap */}
            <TouchableOpacity onPress={handleVersionTap} activeOpacity={1} style={styles.versionWrap}>
              <Text style={styles.version}>v{APP_VERSION}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Tab: Friends ── */}
        {!isGuest && activeTab === 'friends' && (
          <View style={styles.eventsCard}>
            <Text style={styles.eventsLabel}>MY FRIENDS</Text>
            {friendsLoading ? (
              <ActivityIndicator color={Colors.muted} style={{ paddingVertical: Spacing.md }} />
            ) : myFriends.length === 0 ? (
              <Text style={styles.eventsEmpty}>No friends yet. Add some from profiles.</Text>
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
                          {BADGE_META[f.badges[0] as keyof typeof BADGE_META]?.label ?? f.badges[0]}
                        </Text>
                      )}
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        )}

        {/* ── Tab: Vibes ── */}
        {!isGuest && activeTab === 'vibes' && (
          <View style={styles.eventsCard}>
            <Text style={styles.eventsLabel}>VIBES RECEIVED</Text>
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
                    <Text style={styles.vibeScoreAvg}>{myVibeScore?.toFixed(1)} vibe score</Text>
                    <Text style={styles.vibeScoreCount}>based on {myVibeCount} vibe{myVibeCount !== 1 ? 's' : ''}</Text>
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
                    <Text style={styles.eventsEmpty}>No vibes yet.</Text>
                    <Text style={styles.eventsEmpty}>Your score will appear once people leave you a note ✨</Text>
                  </>
                )}
              </>
            )}
          </View>
        )}

      </ScrollView>

      {/* ══ STICKY: Save CTA (registered only) ══════════════════════════════ */}
      {!isGuest && (
        <View style={[styles.stickyCta, { paddingBottom: Math.max(12, insets.bottom) }]}>
          {saveError ? <Text style={styles.saveError}>{saveError}</Text> : null}
          <TouchableOpacity
            style={[styles.ctaBtn, styles.ctaBtnSave]}
            onPress={handleSave}
            activeOpacity={0.85}
            disabled={saving || photoUploading}
          >
            {saving
              ? <ActivityIndicator color={Colors.white} size="small" />
              : <Text style={styles.ctaBtnText}>{saved ? 'Saved ✓' : 'Save profile'}</Text>
            }
          </TouchableOpacity>
          <View style={styles.stickyBottomRow}>
            <TouchableOpacity style={styles.stickySignOut} onPress={handleLogout} activeOpacity={0.6}>
              <Text style={styles.stickySignOutText}>Sign out</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.stickyDeleteAccount} onPress={handleDeleteAccount} activeOpacity={0.6}>
              <Text style={styles.stickyDeleteAccountText}>Delete account</Text>
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
  backBtn: {
    width:           40,
    height:          40,
    borderRadius:    12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.10)',
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
    zIndex:          1,
  },
  headerCenter: {
    position:   'absolute',
    left:       0,
    right:      0,
    alignItems: 'center',
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
  identitySub: {
    fontSize: FontSizes.xs,
    color:    Colors.muted2,
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

  // Filter pills
  filterBar: {
    flexDirection:     'row',
    paddingHorizontal: Spacing.md,
    paddingBottom:     Spacing.sm,
    gap:               8,
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
  ctaBtn:    { borderRadius: Radius.lg, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', minHeight: 52 },
  ctaBtnSave: { backgroundColor: Colors.accent },
  ctaBtnText: { fontSize: FontSizes.md, fontWeight: '700', color: Colors.white, letterSpacing: -0.2 },

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
  upgradePrimary:    { backgroundColor: Colors.accent, borderRadius: Radius.lg, paddingVertical: Spacing.md, alignItems: 'center' },
  upgradePrimaryText:  { color: Colors.white, fontWeight: '700', fontSize: FontSizes.md },
  upgradeSecondary:  { borderRadius: Radius.lg, paddingVertical: Spacing.sm, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  upgradeSecondaryText: { color: Colors.text, fontWeight: '600', fontSize: FontSizes.sm },

  // ── Version ───────────────────────────────────────────────────────────────
  versionWrap: { alignItems: 'center', paddingVertical: Spacing.md },
  version:     { fontSize: FontSizes.xs, color: Colors.muted2 },
});
