import { thumbUrl } from '@/lib/imageThumb';
/**
 * Settings (SPEC 9.7, V3-10), opened from the Passport gear: everything the
 * former profile form did. Members: photo, username (availability check),
 * Local / Exploring mode, about, home city, interests, vibe, age, then
 * appearance, language, blocked users, save, sign out and delete account.
 * Guests: mode, appearance, language, and sign up / sign in.
 */

import { useState, useEffect, useRef } from 'react';
import {
  View, Text, Image, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, StyleSheet, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { saveIdentity } from '@/lib/identity';
import { updateProfile, deleteAccount, checkUsernameAvailability } from '@/api/auth';
import { uploadFile } from '@/api/uploads';
import { setCurrentCity } from '@/api/channels';
import { isLegend as accountIsLegend } from '@/lib/canCreateEvent';
import { LeaderboardCityPickerSheet } from '@/features/challenge/LeaderboardCityPickerSheet';
import { localizeCityName } from '@/i18n/cityName';
import { FontSizes, Spacing, Radius, APP_VERSION, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { avatarColor as avatarBg } from '@/lib/avatarColors';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenHeader } from '@/ui';
import { LanguageRow } from '@/features/settings/LanguageRow';

// ── Constants - must match backend allowed lists ──────────────────────────────

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

// ── Badge helpers ─────────────────────────────────────────────────────────────

const ME_BADGE_BG: Record<string, object> = {
  ghost:   { backgroundColor: 'rgba(128,128,128,0.14)', borderColor: 'rgba(128,128,128,0.24)' },
  fresh:   { backgroundColor: 'rgba(74,222,128,0.12)',  borderColor: 'rgba(74,222,128,0.22)'  },
  regular: {
  backgroundColor: 'rgba(96,165,250,0.12)',  borderColor: 'rgba(96,165,250,0.22)'  },
  local:   { backgroundColor: 'rgba(52,211,153,0.12)',  borderColor: 'rgba(52,211,153,0.22)'  },
  host:    { backgroundColor: 'rgba(251,191,36,0.15)',  borderColor: 'rgba(251,191,36,0.28)'  },
};
const ME_BADGE_COLOR: Record<string, object> = {
  // ghost previously hardcoded '#666' (~3.4:1) - failed WCAG AA on the dark
  // bg. Routed through the theme token so future contrast fixes propagate.
  ghost: {
  color: '#8a8a8a' }, fresh: { color: '#4ade80' },
  regular: { color: '#60a5fa' }, local: { color: '#34d399' }, host: { color: '#fbbf24' },
};
function meBadgeBg(key: string): object    { return ME_BADGE_BG[key]    ?? ME_BADGE_BG.regular; }
function meBadgeColor(key: string): object { return ME_BADGE_COLOR[key] ?? ME_BADGE_COLOR.regular; }

// ── Screen ────────────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors, theme, setTheme } = useTheme();
  // Local cache for instant boot (everyone) + DB for members (follows the account
  // across devices; guests stay device-local).
  const onToggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    if (account?.id) updateProfile({ theme: next }).catch(() => {});
  };

  const router  = useRouter();
  const { t }   = useTranslation('me');
  const insets  = useSafeAreaInsets();
  const { identity, account, setAccount, setIdentity, logout, city, setCity } = useApp();

  const [username,           setUsername]           = useState(account?.username ?? '');
  const [aboutMe,            setAboutMe]            = useState(account?.about_me ?? '');
  const [homeCity,           setHomeCity]            = useState(account?.home_city ?? '');
  // Legend-only city picker on the profile. The HOME CITY row is the
  // ONLY surface where /me/city gets called now - switch-city is purely
  // a browse view. Global Legend check via account.badges so a Legend
  // who currently lives in a city they aren't ambassador in still sees
  // the affordance (contextBadge would miss that case - it's
  // city-context-scoped, not global).
  const isLegend = accountIsLegend(account);
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const [ageStr,             setAgeStr]              = useState(account?.age != null ? String(account.age) : '');
  const [selectedVibe,       setSelectedVibe]        = useState<string>(account?.vibe ?? 'chill');
  const [selectedMode,       setSelectedMode]        = useState<string | null>(account?.mode ?? identity?.mode ?? null);
  const [selectedInterests,  setSelectedInterests]  = useState<string[]>(account?.interests ?? []);
  const [pendingPhotoUri,    setPendingPhotoUri]     = useState<string | null>(null);
  const [photoUploading,     setPhotoUploading]     = useState(false);
  const [saving,             setSaving]             = useState(false);
  const [saved,              setSaved]              = useState(false);
  const [saveError,          setSaveError]          = useState<string | null>(null);
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

  // Username availability - debounced check (backend excludes the caller's own row).
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
    // Username is the single identity field - it doubles as the display name.
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

      {/* Back + title (Settings opens from the Passport gear, SPEC 9.7). */}
      <ScreenHeader title={t('settings')} />

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

            {/* Identity row - avatar + name + badge + description */}
            <View style={styles.identityRow}>
              <TouchableOpacity
                style={styles.avatarWrap}
                onPress={handlePickPhoto}
                activeOpacity={0.8}
                disabled={photoUploading}
              >
                {photoSrc ? (
                  <Image source={{ uri: thumbUrl(photoSrc) }} style={styles.avatarSm} resizeMode="cover" />
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
                  {account?.username ? `@${account.username}` : (account?.display_name ?? '-')}
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

            {/* Mode selector - compact 2-button toggle */}
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

          </View>
        )}

        {/* ── Guest: avatar + mode + upgrade CTA ── */}
        {isGuest && (
          <>
            <View style={[styles.avatarSection, { paddingTop: Spacing.md, paddingBottom: Spacing.xs }]}>
              <View style={[styles.avatarFallback, { backgroundColor: avatarBgColor }]}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </View>
              <Text style={styles.avatarName}>{identity?.nickname ?? '-'}</Text>
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
        {!isGuest && (
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
                    placeholderTextColor={colors.muted2}
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={20}
                  />
                  {uStatus === 'checking' && <ActivityIndicator size="small" color={colors.muted} />}
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
                  placeholderTextColor={colors.muted2}
                  maxLength={150}
                  multiline
                  numberOfLines={2}
                  textAlignVertical="top"
                />
              </View>

              {/* EMAIL - read only */}
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

              {/* HOME CITY - PR48: GEO-resolved current city (read-only).
                  Legend users (host badge) can tap to switch via the
                  city picker sheet. */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{t('fieldHomeCity')}</Text>
                {isLegend ? (
                  <TouchableOpacity
                    style={[styles.fieldInput, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
                    onPress={() => setCityPickerOpen(true)}
                    activeOpacity={0.7}
                  >
                    <Text style={{ color: city?.name ? colors.text : colors.muted2, fontSize: FontSizes.md }}>
                      {city?.name ? localizeCityName(city.name) : t('homeCityPlaceholder')}
                    </Text>
                    <Ionicons name="chevron-down" size={18} color={colors.muted2} />
                  </TouchableOpacity>
                ) : (
                  <View style={[styles.fieldInput, { justifyContent: 'center' }]}>
                    <Text style={{ color: city?.name ? colors.text : colors.muted2, fontSize: FontSizes.md }}>
                      {city?.name ? localizeCityName(city.name) : t('homeCityPlaceholder')}
                    </Text>
                  </View>
                )}
              </View>

              {/* AGE */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>{t('fieldAge')}</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={ageStr}
                  onChangeText={text => setAgeStr(text.replace(/[^0-9]/g, ''))}
                  placeholder={t('agePlaceholder')}
                  placeholderTextColor={colors.muted2}
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
        {/* ── Settings (registered only) - Apple G1.2 requires reachable Block management ── */}
        {/* Settings card — shown for everyone. Appearance (theme) is universal;
            Blocked users is registered-only. */}
        <View style={styles.settingsCard}>
          <Text style={styles.settingsLabel}>{t('settings')}</Text>
          {/* Appearance - instant light/dark theme toggle (guests + members). */}
          <TouchableOpacity
            style={styles.settingsRow}
            onPress={onToggleTheme}
            activeOpacity={0.7}
          >
            <Ionicons name={theme === 'dark' ? 'moon-outline' : 'sunny-outline'} size={18} color={colors.muted} />
            <Text style={styles.settingsRowLabel}>{t('appearance', { defaultValue: 'Appearance' })}</Text>
            <Text style={styles.settingsRowValue}>
              {theme === 'dark' ? t('themeDark', { defaultValue: 'Dark' }) : t('themeLight', { defaultValue: 'Light' })}
            </Text>
          </TouchableOpacity>
          {/* Language - also available in the header flag; surfaced here too. */}
          <LanguageRow trigger="row" />
          {!isGuest && (
            <TouchableOpacity
              style={styles.settingsRow}
              onPress={() => router.push('/blocked-users' as never)}
              activeOpacity={0.7}
            >
              <Ionicons name="ban-outline" size={18} color={colors.muted} />
              <Text style={styles.settingsRowLabel}>{t('blockedUsers')}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.muted} />
            </TouchableOpacity>
          )}
        </View>

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

      {/* PR48 - Legend city picker. Selects a channel, posts /me/city,
          updates the local account so the field re-renders with the
          new city name without a screen bounce. */}
      {isLegend && (
        <LeaderboardCityPickerSheet
          visible={cityPickerOpen}
          selectedChannelId={city?.channelId != null ? String(city.channelId) : null}
          onSelect={async (channelId, picked) => {
            setCityPickerOpen(false);
            try {
              await setCurrentCity(channelId);
              // Update the in-memory City so the field re-renders with
              // the new name immediately. The next geo / heartbeat cycle
              // will re-resolve and confirm.
              setCity({
                channelId: typeof channelId === 'string' ? parseInt(channelId, 10) : (channelId as unknown as number),
                name:      picked.name,
                country:   picked.country,
                timezone:  picked.timezone ?? 'UTC',
              } as unknown as Parameters<typeof setCity>[0]);
            } catch (e) {
              console.warn('[me] setCurrentCity failed:', String(e));
              Alert.alert(t('saveError', { defaultValue: 'Something went wrong.' }));
            }
          }}
          onClose={() => setCityPickerOpen(false)}
        />
      )}

    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container:  { flex: 1, backgroundColor: c.bg },
  scrollView: { flex: 1 },

  // ── Page header ───────────────────────────────────────────────────────────
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    minHeight:         56,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor:   c.bg,
  },
  // No borderBottom - header flows directly into the tab sub-header,
  // matching MY CITY's look.
  appHeaderWrap: {
    paddingHorizontal: Spacing.md,
    paddingTop:        10,
    paddingBottom:     12,
    backgroundColor:   c.bg,
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
    color:         c.text,
    letterSpacing: -0.3,
  },

  // ── Sticky identity block ─────────────────────────────────────────────────
  stickyIdentity: {
    backgroundColor:   c.bg,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
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
    borderColor:  c.accent,
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
    color:      c.white,
  },
  avatarSmOverlay: {
    position:        'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    borderRadius:    Radius.full,
    backgroundColor: c.scrim,
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
    backgroundColor: c.bg2,
    borderWidth:     1.5,
    borderColor:     c.border,
    alignItems:      'center',
    justifyContent:  'center',
  },
  cameraEmoji:   { fontSize: 11 },
  identityInfo:  { flex: 1, gap: 4 },
  identityName: {
    fontSize:      FontSizes.lg,
    fontWeight:    '700',
    color:         c.text,
    letterSpacing: -0.3,
  },
  identityHandle: {
    fontSize:   FontSizes.sm,
    color:      c.muted,
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
    color:      c.muted,
    fontWeight: '500',
  },
  identityMetaVibe: {
    fontSize:   FontSizes.xs,
    color:      c.muted,
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
    color:         c.accentText,
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
    borderColor:       c.border,
    backgroundColor:   'transparent',
    alignItems:        'center',
    gap:               2,
  },
  modeBtnActive: {
    borderColor:     c.accent,
    backgroundColor: c.accent + '22',
  },
  modeBtnEmoji:  { fontSize: 22, lineHeight: 26 },
  modeBtnLabel: {
    fontSize:   FontSizes.sm,
    fontWeight: '700',
    color:      c.muted,
  },
  modeBtnLabelActive: { color: c.accentText },
  modeBtnDesc: {
    fontSize:   FontSizes.xs,
    color:      c.muted2,
    textAlign:  'center',
    lineHeight: 15,
  },

  // Filter pills - used as contentContainerStyle of horizontal ScrollView
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
    borderColor:       c.border,
    backgroundColor:   c.bg2,
  },
  filterPillActive: {
    borderColor:     c.accent,
    backgroundColor: c.accent + '18',
  },
  filterPillLabel: {
    fontSize:   FontSizes.sm,
    fontWeight: '600',
    color:      c.muted,
  },
  filterPillLabelActive: {
    color: c.accent,
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
    color:      c.white,
  },
  avatarName: {
    fontSize:      FontSizes.xl,
    fontWeight:    '700',
    color:         c.text,
    letterSpacing: -0.3,
    marginTop:     Spacing.xs,
  },
  accountType: {
    fontSize: FontSizes.sm,
    color:    c.muted,
  },
  badgeBlock:    { alignItems: 'center', gap: 4 },
  badgeMicrocopy: { fontSize: FontSizes.xs, color: c.muted2, textAlign: 'center' },

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
    backgroundColor:  c.bg2,
    borderRadius:     Radius.lg,
    borderWidth:      1,
    borderColor:      c.border,
    gap:              10,
  },
  guestModeLabel: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         c.muted,
    letterSpacing: 0.8,
  },

  // ── Fields card ───────────────────────────────────────────────────────────
  fieldsCard: {
    marginHorizontal: Spacing.md,
    marginTop:        Spacing.md,
    marginBottom:     Spacing.md,
    backgroundColor:  c.bg2,
    borderRadius:     Radius.lg,
    borderWidth:      1,
    borderColor:      c.border,
    overflow:         'hidden',
    padding:          Spacing.md,
    gap:              Spacing.md,
  },
  fieldGroup: {
    gap:               8,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    paddingBottom:     Spacing.md,
  },
  fieldGroupLast: { borderBottomWidth: 0, paddingBottom: 0 },
  fieldLabel: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         c.muted,
    letterSpacing: 0.8,
  },
  fieldLabelHint: {
    fontSize:      FontSizes.xs,
    fontWeight:    '400',
    color:         c.muted2,
    letterSpacing: 0,
  },
  fieldInput: {
    backgroundColor:   c.bg3,
    borderRadius:      Radius.md,
    borderWidth:       1,
    borderColor:       c.border,
    paddingHorizontal: 14,
    paddingVertical:   Platform.OS === 'ios' ? 13 : 10,
    color:             c.text,
    fontSize:          FontSizes.md,
  },
  fieldInputReadOnly: {
    color:           c.muted,
    backgroundColor: c.bg,
  },
  usernameRow: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               6,
    backgroundColor:   c.bg3,
    borderRadius:      Radius.md,
    borderWidth:       1,
    borderColor:       c.border,
    paddingHorizontal: 14,
  },
  usernameAt:    { fontSize: FontSizes.md, color: c.muted2, fontWeight: '600' },
  usernameInput: { flex: 1, color: c.text, fontSize: FontSizes.md, paddingVertical: Platform.OS === 'ios' ? 13 : 10 },
  uOk:           { color: '#4ade80', fontSize: FontSizes.md, fontWeight: '700' },
  uBad:          { color: c.red, fontSize: FontSizes.md, fontWeight: '700' },
  uOkHint:       { fontSize: FontSizes.xs, color: '#4ade80', marginTop: 4 },
  uBadHint:      { fontSize: FontSizes.xs, color: c.red, marginTop: 4 },
  fieldInputMultiline: {
    minHeight:        56,
    textAlignVertical: 'top',
    paddingTop:        Platform.OS === 'ios' ? 13 : 10,
  },
  fieldLabelMeta: {
    fontSize:      FontSizes.xs,
    fontWeight:    '400',
    color:         c.muted2,
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
  chipSelected:      { backgroundColor: c.accent, borderColor: c.accent },
  chipText:          { fontSize: FontSizes.sm, color: c.muted, fontWeight: '500' },
  chipTextSelected:  { color: c.white, fontWeight: '700' },
  vibeChip: {
    paddingHorizontal: 14,
    paddingVertical:   9,
    borderRadius:      Radius.full,
    backgroundColor:   c.overlayWeak,
    borderWidth:       1,
    borderColor:       c.overlayStrong,
  },
  vibeChipActive:     { backgroundColor: 'rgba(255,122,60,0.18)', borderColor: c.accent },
  vibeChipText:       { fontSize: FontSizes.sm, color: c.muted, fontWeight: '500' },
  vibeChipTextActive: { color: c.text, fontWeight: '700' },

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
    borderColor:       c.overlayStrong,
    backgroundColor:   c.overlayWeak,
  },
  subTabBtnActive: {
    borderColor:     'rgba(255,122,60,0.45)',
    backgroundColor: 'rgba(255,122,60,0.14)',
  },
  subTabText:       { fontSize: 12, fontWeight: '700', color: c.muted, letterSpacing: -0.2 },
  subTabTextActive: { color: '#FF7A3C' },

  // ── Events / generic card ─────────────────────────────────────────────────
  eventsCard: {
    marginHorizontal: Spacing.md,
    marginTop:        Spacing.xs,
    marginBottom:     Spacing.md,
    backgroundColor:  c.bg2,
    borderRadius:     Radius.lg,
    borderWidth:      1,
    borderColor:      c.border,
    overflow:         'hidden',
    padding:          Spacing.md,
  },
  eventsLabel: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         c.muted,
    letterSpacing: 0.8,
    marginBottom:  Spacing.sm,
  },
  eventsEmpty: { fontSize: FontSizes.sm, color: c.muted2, paddingVertical: Spacing.sm },
  divider:     { height: 1, backgroundColor: c.border, marginVertical: Spacing.sm },

  // ── Settings card ─────────────────────────────────────────────────────────
  settingsCard: {
    marginHorizontal: Spacing.md,
    marginTop:        Spacing.xs,
    marginBottom:     Spacing.md,
    backgroundColor:  c.bg2,
    borderRadius:     Radius.lg,
    borderWidth:      1,
    borderColor:      c.border,
    overflow:         'hidden',
    padding:          Spacing.md,
  },
  settingsLabel: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         c.muted,
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
    color:      c.text,
  },
  settingsRowValue: {
    fontSize:   FontSizes.sm,
    fontWeight: '700',
    color:      c.accentText,
  },

  eventRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  eventIcon:      { fontSize: 18, marginTop: 2 },
  eventInfo:      { flex: 1, gap: 4 },
  eventTitle:     { fontSize: FontSizes.md, fontWeight: '600', color: c.text },
  eventRecurrence: { fontSize: FontSizes.sm, color: c.muted },
  eventBadgeRow:  { flexDirection: 'row', gap: 6, marginTop: 2 },
  livePill: {
    backgroundColor:   'rgba(255,122,60,0.18)',
    borderRadius:      Radius.full,
    paddingHorizontal: 7,
    paddingVertical:   2,
  },
  livePillText:   { fontSize: 10, fontWeight: '700', color: c.accent, letterSpacing: 0.4 },
  recurPill: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    backgroundColor:   'rgba(139,92,246,0.15)',
    borderRadius:      Radius.full,
    paddingHorizontal: 7,
    paddingVertical:   2,
  },
  recurPillText:  { fontSize: 10, fontWeight: '700', color: c.violet, letterSpacing: 0.4 },
  deleteBtn:      { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginTop: -2 },
  deleteBtnText:  { fontSize: 22, color: c.muted2, lineHeight: 26 },

  // Friend requests inbox row (above MY FRIENDS card on the Friends tab)
  friendReqRow: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             12,
    backgroundColor: c.bg2,
    borderRadius:    Radius.lg,
    paddingVertical:   Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    marginBottom:    Spacing.sm,
    borderWidth:     1,
    borderColor:     c.border,
  },
  friendReqIcon: {
    width:           32,
    height:          32,
    borderRadius:    16,
    backgroundColor: 'rgba(255,122,60,0.10)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  friendReqLabel: { flex: 1, fontSize: FontSizes.md, fontWeight: '600', color: c.text },
  friendReqBadge: {
    minWidth:          22,
    height:            22,
    borderRadius:      11,
    backgroundColor:   c.accent,
    paddingHorizontal: 7,
    alignItems:        'center',
    justifyContent:    'center',
  },
  friendReqBadgeText: { color: c.white, fontWeight: '700', fontSize: 11 },

  // Friends
  friendRow:            { flexDirection: 'row', alignItems: 'center', gap: 10 },
  friendAvatar:         { width: 38, height: 38, borderRadius: 19, flexShrink: 0 },
  friendAvatarFallback: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  friendAvatarInitial:  { fontSize: 15, fontWeight: '700', color: '#fff' },
  friendInfo:           { flex: 1, gap: 2 },
  friendName:           { fontSize: FontSizes.md, fontWeight: '600', color: c.text },
  friendBadgeText:      { fontSize: FontSizes.xs, color: c.muted },

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
  vibeStarOff:     { fontSize: 20, color: c.overlayStrong },
  vibeScoreAvg:    { fontSize: FontSizes.md, fontWeight: '700', color: c.text },
  vibeScoreCount:  { fontSize: FontSizes.xs, color: c.muted2 },
  receivedVibeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: Spacing.xs },
  receivedVibeAvatar: { width: 36, height: 36, borderRadius: 18, flexShrink: 0 },
  receivedVibeAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  receivedVibeAvatarInitial:  { fontSize: 14, fontWeight: '700', color: '#fff' },
  receivedVibeContent:        { flex: 1, gap: 2 },
  receivedVibeHeader:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  receivedVibeAuthor:         { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  receivedVibeRating:         { fontSize: FontSizes.sm, color: '#fbbf24' },
  receivedVibeMsg:            { fontSize: FontSizes.sm, color: c.muted, lineHeight: 18 },

  // ── Sticky CTA bar ────────────────────────────────────────────────────────
  stickyCta: {
    paddingHorizontal: Spacing.md,
    paddingTop:        12,
    backgroundColor:   c.bg2,
    borderTopWidth:    1,
    borderTopColor:    c.border,
    gap:               2,
  },
  stickyBottomRow: {
    flexDirection:     'row',
    justifyContent:    'space-between',
    alignItems:        'center',
    paddingHorizontal: 4,
  },
  stickySignOut:        { paddingVertical: 8 },
  stickySignOutText:    { fontSize: FontSizes.xs, fontWeight: '500', color: c.muted2 },
  stickyDeleteAccount:  { paddingVertical: 8 },
  stickyDeleteAccountText: { fontSize: FontSizes.xs, fontWeight: '500', color: 'rgba(248,113,113,0.35)' },
  saveError: { fontSize: FontSizes.sm, color: c.red, textAlign: 'center', marginBottom: Spacing.xs },
  // ── Guest upgrade ─────────────────────────────────────────────────────────
  upgradeCard: {
    margin:          Spacing.md,
    backgroundColor: c.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     c.border,
    padding:         Spacing.md,
    gap:             Spacing.sm,
  },
  upgradeTitle:      { fontSize: FontSizes.lg, fontWeight: '700', color: c.text },
  upgradeSub:        { fontSize: FontSizes.sm, color: c.muted, lineHeight: 20 },
  upgradeSignInHint: { fontSize: FontSizes.xs, color: c.muted, textAlign: 'center' },
  upgradeSecondary:  { borderRadius: Radius.lg, paddingVertical: Spacing.sm, alignItems: 'center', borderWidth: 1, borderColor: c.border },
  upgradeSecondaryText: { color: c.text, fontWeight: '600', fontSize: FontSizes.sm },

  // ── Version ───────────────────────────────────────────────────────────────
  versionWrap: { alignItems: 'center', paddingVertical: Spacing.md },
  version:     { fontSize: FontSizes.xs, color: c.muted2 },
});
