/**
 * Me / My Profile screen — faithful port of the web ProfileScreen.jsx
 *
 * Web source: apps/web/src/components/ProfileScreen.jsx
 *
 * Structure (registered users):
 *   Header:    "My Profile" title (no icon)
 *   Avatar:    tappable circle → photo upload, camera badge, gradient fallback
 *   Fields:    display name · email (read-only) · home city · age
 *   Interests: chip grid, pick up to 5
 *   My Events: event rows with × delete
 *   CTAs:      Save profile (gradient) · Sign out (gradient)
 *
 * Guest users see the upgrade CTA instead of the profile form.
 */

import { useState, useEffect, useRef } from 'react';
import {
  View, Text, Image, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, StyleSheet, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { useMyEvents } from '@/hooks/useMyEvents';
import { updateProfile } from '@/api/auth';
import { uploadFile } from '@/api/uploads';
import { deleteEvent } from '@/api/events';
import { Colors, FontSizes, Spacing, Radius, APP_VERSION } from '@/constants';
import type { HiladsEvent } from '@/types';

// ── Interests — matches web ProfileScreen.jsx (20 items, subset of 24 backend allows)
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

// ── Avatar gradient palette — mirrors web name-hash avatar logic ───────────────

const AVATAR_BG = [
  '#7c6aff', '#ff6a9f', '#22d3ee', '#4ade80',
  '#fb923c', '#f472b6', '#818cf8', '#2dd4bf',
];

function avatarBg(name: string): string {
  const hash = (name ?? '').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_BG[hash % AVATAR_BG.length];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString([], {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function MeScreen() {
  const router  = useRouter();
  const { identity, account, setAccount, logout } = useApp();
  const { events: rawEvents, loading: eventsLoading } = useMyEvents();

  // ── Profile editing state — initialised from account
  const [displayName,        setDisplayName]        = useState(account?.display_name ?? '');
  const [homeCity,           setHomeCity]            = useState(account?.home_city ?? '');
  const [ageStr,             setAgeStr]              = useState(account?.age != null ? String(account.age) : '');
  const [selectedInterests,  setSelectedInterests]   = useState<string[]>(account?.interests ?? []);
  const [pendingPhotoUri,    setPendingPhotoUri]      = useState<string | null>(null);
  const [localEvents,        setLocalEvents]          = useState<HiladsEvent[]>([]);
  const [saving,             setSaving]              = useState(false);
  const [saved,              setSaved]               = useState(false);
  const [saveError,          setSaveError]           = useState<string | null>(null);

  // Re-sync local events when hook loads
  useEffect(() => { setLocalEvents(rawEvents); }, [rawEvents]);

  // Re-sync form state if account changes externally (e.g. after login)
  useEffect(() => {
    setDisplayName(account?.display_name ?? '');
    setHomeCity(account?.home_city ?? '');
    setAgeStr(account?.age != null ? String(account.age) : '');
    setSelectedInterests(account?.interests ?? []);
  }, [account?.display_name, account?.home_city, account?.age, account?.interests]);

  // Version tap easter egg
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleVersionTap() {
    tapCount.current += 1;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => { tapCount.current = 0; }, 2000);
    if (tapCount.current >= 5) {
      tapCount.current = 0;
      router.push('/debug');
    }
  }

  const isGuest   = !account;
  const avatarBgColor = avatarBg(account?.display_name ?? identity?.nickname ?? '');
  const initials  = (account?.display_name ?? identity?.nickname ?? '?').slice(0, 2).toUpperCase();
  const photoSrc  = pendingPhotoUri ?? account?.profile_photo_url ?? null;

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
    if (!result.canceled && result.assets[0]) {
      setPendingPhotoUri(result.assets[0].uri);
    }
  }

  // ── Interest chip toggle — max 5, mirrors web logic ──────────────────────────

  function toggleInterest(interest: string) {
    setSelectedInterests(prev => {
      if (prev.includes(interest)) return prev.filter(i => i !== interest);
      if (prev.length >= 5) return prev; // web: "pick up to 5"
      return [...prev, interest];
    });
  }

  // ── Event delete ─────────────────────────────────────────────────────────────

  function handleDeleteEvent(event: HiladsEvent) {
    Alert.alert('Delete event', `Delete "${event.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const before = localEvents;
          setLocalEvents(prev => prev.filter(e => e.id !== event.id));
          try {
            const guestId = account?.guest_id ?? identity?.guestId ?? '';
            await deleteEvent(event.id, guestId);
          } catch {
            setLocalEvents(before);
          }
        },
      },
    ]);
  }

  // ── Save profile ─────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!displayName.trim()) {
      setSaveError('Display name is required');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      // Upload photo first if one was picked
      let photoUrl = account?.profile_photo_url ?? null;
      if (pendingPhotoUri) {
        photoUrl = await uploadFile(pendingPhotoUri);
        setPendingPhotoUri(null);
      }

      // Convert age → birth_year, mirrors web ProfileScreen.jsx
      const ageNum = parseInt(ageStr, 10);
      const birthYear = !ageStr.trim()
        ? null
        : (!isNaN(ageNum) && ageNum >= 18 && ageNum <= 100)
          ? new Date().getFullYear() - ageNum
          : undefined; // undefined = don't send (invalid)

      // birth_year is a backend input field (not on User type, which has `age` as output).
      // Cast via unknown to satisfy TypeScript while sending the correct backend payload.
      const fields = {
        display_name:      displayName.trim(),
        home_city:         homeCity.trim() || null,
        interests:         selectedInterests,
        profile_photo_url: photoUrl,
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

  // ── Sign out ──────────────────────────────────────────────────────────────────

  function handleLogout() {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => logout() },
    ]);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* ── Header — back button left, centered title ── */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.push('/(tabs)/chat')}
            activeOpacity={0.75}
          >
            <Ionicons name="chevron-back" size={20} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>My Profile</Text>
          </View>
        </View>

        {/* ── Avatar — web: .profile-avatar-wrap → tappable, camera badge ── */}
        {!isGuest && (
          <View style={styles.avatarSection}>
            <TouchableOpacity
              style={styles.avatarWrap}
              onPress={handlePickPhoto}
              activeOpacity={0.8}
            >
              {photoSrc ? (
                <Image source={{ uri: photoSrc }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatarFallback, { backgroundColor: avatarBgColor }]}>
                  <Text style={styles.avatarInitials}>{initials}</Text>
                </View>
              )}
              {/* web: .profile-avatar-overlay — camera badge */}
              <View style={styles.cameraBadge}>
                <Text style={styles.cameraEmoji}>📷</Text>
              </View>
            </TouchableOpacity>

            <Text style={styles.avatarName}>{account?.display_name ?? '—'}</Text>
            {account?.email ? (
              <Text style={styles.avatarEmail}>{account.email}</Text>
            ) : null}
          </View>
        )}

        {/* ── Guest: upgrade CTA ─────────────────────────────────────────── */}
        {isGuest && (
          <>
            <View style={styles.avatarSection}>
              <View style={[styles.avatarFallback, { backgroundColor: avatarBgColor }]}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
              <Text style={styles.avatarName}>{identity?.nickname ?? '—'}</Text>
              <Text style={styles.accountType}>Guest session</Text>
            </View>

            <View style={styles.upgradeCard}>
              <Text style={styles.upgradeTitle}>Create a free account</Text>
              <Text style={styles.upgradeSub}>
                Keep your events, access DMs, and stay connected across sessions.
              </Text>
              <TouchableOpacity style={styles.upgradePrimary} onPress={() => router.push('/sign-up')} activeOpacity={0.85}>
                <Text style={styles.upgradePrimaryText}>Create account</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.upgradeSecondary} onPress={() => router.push('/sign-in')} activeOpacity={0.8}>
                <Text style={styles.upgradeSecondaryText}>Sign in</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ── Profile fields — registered users only ─────────────────────── */}
        {!isGuest && (
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
        )}

        {/* ── My Events — web: .profile-events-section ─────────────────────── */}
        {!isGuest && (
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
                    {idx > 0 && <View style={styles.eventDivider} />}
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
        )}

        {/* ── CTAs — web: Save profile + Sign out (gradient buttons) ──────── */}
        {!isGuest && (
          <View style={styles.ctaSection}>

            {/* Save error */}
            {saveError ? (
              <Text style={styles.saveError}>{saveError}</Text>
            ) : null}

            {/* Save profile */}
            <TouchableOpacity
              style={[styles.ctaBtn, styles.ctaBtnSave]}
              onPress={handleSave}
              activeOpacity={0.85}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color={Colors.white} size="small" />
              ) : (
                <Text style={styles.ctaBtnText}>{saved ? 'Saved ✓' : 'Save profile'}</Text>
              )}
            </TouchableOpacity>

            {/* Sign out */}
            <TouchableOpacity
              style={[styles.ctaBtn, styles.ctaBtnSignOut]}
              onPress={handleLogout}
              activeOpacity={0.85}
            >
              <Text style={[styles.ctaBtnText, styles.ctaBtnTextSignOut]}>Sign out</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Version — tap 5× to open debug panel */}
        <TouchableOpacity onPress={handleVersionTap} activeOpacity={1} style={styles.versionWrap}>
          <Text style={styles.version}>v{APP_VERSION}</Text>
        </TouchableOpacity>

        <View style={{ height: Spacing.xxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  // ── Header — back button left, centered title ────────────────────────────
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    minHeight:         56,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor:   Colors.bg2,
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

  // ── Avatar section — web: .profile-avatar-wrap ────────────────────────────
  avatarSection: {
    alignItems:    'center',
    paddingTop:    Spacing.xl,
    paddingBottom: Spacing.lg,
    gap:           Spacing.sm,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatar: {
    width:        96,
    height:       96,
    borderRadius: Radius.full,
    borderWidth:  2,
    borderColor:  Colors.accent,
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
  // web: .profile-avatar-overlay — bottom-right camera badge
  cameraBadge: {
    position:        'absolute',
    bottom:          0,
    right:           0,
    width:           28,
    height:          28,
    borderRadius:    14,
    backgroundColor: Colors.bg2,
    borderWidth:     1.5,
    borderColor:     Colors.border,
    alignItems:      'center',
    justifyContent:  'center',
  },
  cameraEmoji: { fontSize: 14 },
  avatarName: {
    fontSize:      FontSizes.xl,
    fontWeight:    '700',
    color:         Colors.text,
    letterSpacing: -0.3,
    marginTop:     Spacing.xs,
  },
  avatarEmail: {
    fontSize: FontSizes.sm,
    color:    Colors.muted,
  },
  accountType: {
    fontSize: FontSizes.sm,
    color:    Colors.muted,
  },

  // ── Fields card — web: .profile-form ──────────────────────────────────────
  fieldsCard: {
    marginHorizontal: Spacing.md,
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
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingBottom:     Spacing.md,
  },
  fieldGroupLast: {
    borderBottomWidth: 0,
    paddingBottom:     0,
  },
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

  // ── Interests chips — web: .profile-interests ─────────────────────────────
  chipsWrap: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical:   8,
    borderRadius:      Radius.full,
    backgroundColor:   'rgba(255,122,60,0.06)',
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.20)',
  },
  chipSelected: {
    backgroundColor: Colors.accent,
    borderColor:     Colors.accent,
  },
  chipText: {
    fontSize:   FontSizes.sm,
    color:      Colors.muted,
    fontWeight: '500',
  },
  chipTextSelected: {
    color:      Colors.white,
    fontWeight: '700',
  },

  // ── My Events card — web: .profile-events ─────────────────────────────────
  eventsCard: {
    marginHorizontal: Spacing.md,
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
  eventsEmpty: {
    fontSize: FontSizes.sm,
    color:    Colors.muted2,
    paddingVertical: Spacing.sm,
  },
  eventDivider: {
    height:           1,
    backgroundColor:  Colors.border,
    marginVertical:   Spacing.sm,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           10,
  },
  eventIcon: { fontSize: 18, marginTop: 2 },
  eventInfo: { flex: 1, gap: 4 },
  eventTitle: {
    fontSize:   FontSizes.md,
    fontWeight: '600',
    color:      Colors.text,
  },
  eventRecurrence: {
    fontSize: FontSizes.sm,
    color:    Colors.muted,
  },
  eventBadgeRow: {
    flexDirection: 'row',
    gap:           6,
    marginTop:     2,
  },
  livePill: {
    backgroundColor:   'rgba(255,122,60,0.18)',
    borderRadius:      Radius.full,
    paddingHorizontal: 7,
    paddingVertical:   2,
  },
  livePillText: {
    fontSize:   10,
    fontWeight: '700',
    color:      Colors.accent,
    letterSpacing: 0.4,
  },
  recurPill: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    backgroundColor:   'rgba(139,92,246,0.15)',
    borderRadius:      Radius.full,
    paddingHorizontal: 7,
    paddingVertical:   2,
  },
  recurPillText: {
    fontSize:      10,
    fontWeight:    '700',
    color:         Colors.violet,
    letterSpacing: 0.4,
  },
  deleteBtn: {
    width:           28,
    height:          28,
    alignItems:      'center',
    justifyContent:  'center',
    marginTop:       -2,
  },
  deleteBtnText: {
    fontSize:   22,
    color:      Colors.muted2,
    lineHeight: 26,
  },

  // ── CTAs — web: .profile-actions ──────────────────────────────────────────
  ctaSection: {
    marginHorizontal: Spacing.md,
    marginBottom:     Spacing.md,
    gap:              Spacing.sm,
  },
  saveError: {
    fontSize:   FontSizes.sm,
    color:      Colors.red,
    textAlign:  'center',
    marginBottom: Spacing.xs,
  },
  ctaBtn: {
    borderRadius:   Radius.lg,
    paddingVertical: 16,
    alignItems:      'center',
    justifyContent:  'center',
    minHeight:       52,
  },
  ctaBtnSave:    { backgroundColor: Colors.accent },
  ctaBtnSignOut: {
    backgroundColor: 'transparent',
    borderWidth:     1.5,
    borderColor:     'rgba(255,122,60,0.4)',
  },
  ctaBtnText: {
    fontSize:      FontSizes.md,
    fontWeight:    '700',
    color:         Colors.white,
    letterSpacing: -0.2,
  },
  ctaBtnTextSignOut: { color: Colors.accent },

  // ── Guest upgrade ──────────────────────────────────────────────────────────
  upgradeCard: {
    margin:          Spacing.md,
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     Colors.border,
    padding:         Spacing.md,
    gap:             Spacing.sm,
  },
  upgradeTitle:   { fontSize: FontSizes.lg, fontWeight: '700', color: Colors.text },
  upgradeSub:     { fontSize: FontSizes.sm, color: Colors.muted, lineHeight: 20 },
  upgradePrimary: {
    backgroundColor: Colors.accent,
    borderRadius:    Radius.lg,
    paddingVertical: Spacing.md,
    alignItems:      'center',
  },
  upgradePrimaryText:  { color: Colors.white, fontWeight: '700', fontSize: FontSizes.md },
  upgradeSecondary: {
    borderRadius:    Radius.lg,
    paddingVertical: Spacing.sm,
    alignItems:      'center',
    borderWidth:     1,
    borderColor:     Colors.border,
  },
  upgradeSecondaryText: { color: Colors.text, fontWeight: '600', fontSize: FontSizes.sm },

  // ── Version ────────────────────────────────────────────────────────────────
  versionWrap: { alignItems: 'center', paddingVertical: Spacing.md },
  version:     { fontSize: FontSizes.xs, color: Colors.muted2 },
});
