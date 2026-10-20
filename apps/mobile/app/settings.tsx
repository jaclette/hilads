import { thumbUrl } from '@/lib/imageThumb';
/**
 * Settings (SPEC 9.7, V3-10), opened from the Passport gear: everything the
 * former profile form did. Members: photo, username (availability check),
 * Local / Exploring mode, about, home city, interests, vibe, age, then
 * appearance, language, blocked users, save, sign out and delete account.
 * Guests: mode, appearance, language, and sign up / sign in.
 */

import { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { Border, FontSizes, Spacing, Radius, APP_VERSION, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Avatar, Button, Card, Chip, CityFlag, ListRow, RowGroup, Screen, ScreenHeader, SectionTitle, TextField } from '@/ui';
import { LanguageRow } from '@/features/settings/LanguageRow';
import { DirectionsRow } from '@/features/settings/DirectionsRow';
import { ModePicker } from '@/features/profile/ModePicker';
import { VIBE_ICONS } from '@/features/profile/vibes';
import { HomeCityPicker } from '@/features/compare/HomeCityPicker';
import { shortCityName } from '@/i18n/cityName';
import type { HomeCityRef } from '@/types';

// ── Constants - must match backend allowed lists ──────────────────────────────

const VIBES = ['party', 'board_games', 'coffee', 'music', 'food', 'chill'] as const;

const INTERESTS = [
  'drinks', 'party', 'nightlife', 'music', 'live music',
  'culture', 'art', 'food', 'coffee', 'sport',
  'fitness', 'hiking', 'beach', 'wellness', 'travel',
  'hangout', 'socializing', 'gaming', 'tech', 'dating',
];

type Mode = 'local' | 'exploring';
const asMode = (m: string | null): Mode | null => (m === 'local' || m === 'exploring' ? m : null);

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
  const [homePickerOpen, setHomePickerOpen] = useState(false);
  // Back home's home city (SPEC 10.4): saved at once, apart from the form's Save.
  const saveHomeCity = async (ref: HomeCityRef | null) => {
    setHomePickerOpen(false);
    try {
      const { user } = await updateProfile({ home_city_ref: ref });
      setAccount(user);
    } catch {
      Alert.alert(t('saveError', { defaultValue: 'Something went wrong.' }));
    }
  };
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

  const usernameRight = uStatus === 'checking' ? <ActivityIndicator size="small" color={colors.muted} />
    : uStatus === 'available' ? <Ionicons name="checkmark-circle" size={20} color={colors.localText} />
    : uStatus === 'taken' || uStatus === 'invalid' ? <Ionicons name="close-circle" size={20} color={colors.red} />
    : null;

  return (
    <Screen>
      {/* Back + title (Settings opens from the Passport gear, SPEC 9.7). */}
      <ScreenHeader title={t('settings')} />

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: (isGuest ? 32 : 150) + insets.bottom }]}
      >

        {/* ── Member: identity (photo, handle, badge, city, vibe) + mode ── */}
        {!isGuest && (
          <>
            <View style={styles.identityRow}>
              <TouchableOpacity
                style={styles.avatarWrap}
                onPress={handlePickPhoto}
                activeOpacity={0.8}
                disabled={photoUploading}
                accessibilityRole="button"
                accessibilityLabel={t('photoLabel', { ns: 'common', defaultValue: 'Photo' })}
              >
                <Avatar uri={photoSrc ? thumbUrl(photoSrc) : null} name={account?.display_name ?? '?'} size={72} fallback="color" />
                {photoUploading ? (
                  <View style={styles.avatarOverlay}>
                    <ActivityIndicator color={colors.white} size="small" />
                  </View>
                ) : (
                  <View style={styles.cameraBadge}>
                    <Ionicons name="camera" size={14} color={colors.white} />
                  </View>
                )}
              </TouchableOpacity>

              <View style={styles.identityInfo}>
                <Text style={styles.identityName} numberOfLines={1}>
                  {account?.username ? `@${account.username}` : (account?.display_name ?? '-')}
                </Text>
                <View style={styles.identityMetaRow}>
                  {account?.primaryBadge && (
                    <Chip label={t(`badge.${account.primaryBadge.key}`, { ns: 'common', defaultValue: account.primaryBadge.label })} />
                  )}
                  {homeCity ? (
                    <View style={styles.metaItem}>
                      <Ionicons name="location-outline" size={14} color={colors.muted} />
                      <Text style={styles.identityMeta} numberOfLines={1}>{homeCity}</Text>
                    </View>
                  ) : null}
                </View>
                {selectedVibe && (VIBES as readonly string[]).includes(selectedVibe) ? (
                  <View style={styles.metaItem}>
                    <Ionicons name={VIBE_ICONS[selectedVibe] ?? 'sparkles-outline'} size={14} color={colors.muted} />
                    <Text style={styles.identityMeta}>{t(`vibe.${selectedVibe}`, { ns: 'common' })}</Text>
                  </View>
                ) : null}
              </View>
            </View>

            <ModePicker value={asMode(selectedMode)} onChange={k => setSelectedMode(selectedMode === k ? null : k)} />
          </>
        )}

        {/* ── Guest: avatar + mode + upgrade CTA ── */}
        {isGuest && (
          <>
            <View style={styles.guestHead}>
              <Avatar name={identity?.nickname ?? '?'} size={80} fallback="color" />
              <Text style={styles.guestName}>{identity?.nickname ?? '-'}</Text>
              <Chip label={t('badge.ghost', { ns: 'common' })} />
              <Text style={styles.guestMeta}>{t('ghostBrowsing')}</Text>
              <Text style={styles.guestMeta}>{t('guestSession')}</Text>
            </View>

            <ModePicker value={asMode(selectedMode)} onChange={handleGuestMode} />

            <Card style={styles.upgradeCard}>
              <Text style={styles.upgradeTitle}>{t('makeItYours')}</Text>
              <Text style={styles.upgradeSub}>{t('upgradeSub')}</Text>
              <Button label={t('createAccount')} onPress={() => router.push('/sign-up')} />
              <Text style={styles.upgradeHint}>{t('haveAccount')}</Text>
              <Button variant="secondary" label={t('signIn')} onPress={() => router.push('/sign-in')} />
            </Card>
          </>
        )}

        {/* ── Member: profile fields ── */}
        {!isGuest && (
          <>
            <TextField
              label={t('fieldUsername')}
              prefix="@"
              value={username}
              onChangeText={handleUsernameChange}
              placeholder={t('usernamePlaceholder')}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
              right={usernameRight}
              error={(uStatus === 'taken' || uStatus === 'invalid') ? uReason : null}
            />
            {uStatus === 'available' && <Text style={styles.uOkHint}>{t('available', { username })}</Text>}

            <View style={styles.fieldGroup}>
              <TextField
                label={t('fieldAbout')}
                value={aboutMe}
                onChangeText={setAboutMe}
                placeholder={t('aboutPlaceholder')}
                maxLength={150}
                multiline
                numberOfLines={2}
              />
              <Text style={styles.counter}>{t('aboutLeft', { count: 150 - aboutMe.length })}</Text>
            </View>

            {/* EMAIL - read only */}
            {account?.email ? (
              <TextField label={t('fieldEmail')} value={account.email} editable={false} selectTextOnFocus={false} />
            ) : null}

            {/* HOME CITY - PR48: GEO-resolved current city (read-only).
                Legend users (host badge) can tap to switch via the
                city picker sheet. */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{t('fieldHomeCity')}</Text>
              <TouchableOpacity
                style={styles.readField}
                onPress={() => setCityPickerOpen(true)}
                disabled={!isLegend}
                activeOpacity={0.7}
                accessibilityRole={isLegend ? 'button' : undefined}
              >
                <Ionicons name="location-outline" size={18} color={colors.muted} />
                <Text style={[styles.readFieldText, !city?.name && styles.readFieldPlaceholder]} numberOfLines={1}>
                  {city?.name ? localizeCityName(city.name) : t('homeCityPlaceholder')}
                </Text>
                {isLegend && <Ionicons name="chevron-down" size={18} color={colors.muted} />}
              </TouchableOpacity>
            </View>

            {/* BACK HOME - the home city of the Daily Challenge's "And back home?" (SPEC 10.4). */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{t('fieldBackHome')}</Text>
              <TouchableOpacity style={styles.readField} onPress={() => setHomePickerOpen(true)} activeOpacity={0.7} accessibilityRole="button">
                {account?.home_city_ref
                  ? <CityFlag country={account.home_city_ref.country} size={18} />
                  : <Ionicons name="home-outline" size={18} color={colors.muted} />}
                <Text style={[styles.readFieldText, !account?.home_city_ref && styles.readFieldPlaceholder]} numberOfLines={1}>
                  {account?.home_city_ref ? shortCityName(account.home_city_ref.name) : t('backHomePlaceholder')}
                </Text>
                <Ionicons name="chevron-down" size={18} color={colors.muted} />
              </TouchableOpacity>
              <Text style={styles.fieldHint}>{t('backHomeHint')}</Text>
            </View>

            <TextField
              label={t('fieldAge')}
              value={ageStr}
              onChangeText={text => setAgeStr(text.replace(/[^0-9]/g, ''))}
              placeholder={t('agePlaceholder')}
              keyboardType="number-pad"
              maxLength={3}
            />

            {/* MY VIBE */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>{t('fieldMyVibe')}</Text>
              <View style={styles.chipsWrap}>
                {VIBES.map(v => (
                  <Chip key={v} variant="filter" label={t(`vibe.${v}`, { ns: 'common' })} selected={selectedVibe === v} onPress={() => setSelectedVibe(v)} />
                ))}
              </View>
            </View>

            {/* INTERESTS */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>
                {t('fieldInterests')} <Text style={styles.fieldHint}>{t('interestsHint')}</Text>
              </Text>
              <View style={styles.chipsWrap}>
                {INTERESTS.map(interest => (
                  <Chip
                    key={interest}
                    variant="filter"
                    label={t(`interest.${interest}`, { defaultValue: interest })}
                    selected={selectedInterests.includes(interest)}
                    onPress={() => toggleInterest(interest)}
                  />
                ))}
              </View>
            </View>
          </>
        )}

        {/* ── Settings rows - everyone (Appearance, Language, Directions); Blocked users is
            registered-only (Apple G1.2 requires reachable Block management). ── */}
        <SectionTitle title={t('settings')} style={styles.settingsTitle} />
        <RowGroup>
          <ListRow
            icon={theme === 'dark' ? 'moon-outline' : 'sunny-outline'}
            title={t('appearance', { defaultValue: 'Appearance' })}
            value={theme === 'dark' ? t('themeDark', { defaultValue: 'Dark' }) : t('themeLight', { defaultValue: 'Light' })}
            chevron={false}
            onPress={onToggleTheme}
          />
          <LanguageRow divider />
          <DirectionsRow divider />
          {!isGuest && (
            <ListRow icon="ban-outline" title={t('blockedUsers')} divider onPress={() => router.push('/blocked-users' as never)} />
          )}
        </RowGroup>

        {/* Version - tap 5 times for the debug screen */}
        <TouchableOpacity onPress={handleVersionTap} activeOpacity={1} style={styles.versionWrap}>
          <Text style={styles.version}>v{APP_VERSION}</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ══ STICKY: Save CTA (registered only) ══════════════════════════════ */}
      {!isGuest && (
        <View style={[styles.stickyCta, { paddingBottom: Math.max(12, insets.bottom) }]}>
          {saveError ? <Text style={styles.saveError} accessibilityRole="alert">{saveError}</Text> : null}
          <Button
            icon={saved ? 'checkmark' : undefined}
            label={saved ? t('saved') : t('saveProfile')}
            onPress={handleSave}
            disabled={photoUploading}
            loading={saving}
          />
          <View style={styles.stickyBottomRow}>
            <Button variant="link" label={t('signOut')} onPress={handleLogout} />
            <TouchableOpacity style={styles.deleteBtn} onPress={handleDeleteAccount} accessibilityRole="button">
              <Text style={styles.deleteText}>{t('deleteAccount')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* PR48 - Legend city picker. Selects a channel, posts /me/city,
          updates the local account so the field re-renders with the
          new city name without a screen bounce. */}
      <HomeCityPicker visible={homePickerOpen} selected={account?.home_city_ref ?? null}
                      onPick={saveHomeCity} onClear={() => saveHomeCity(null)} onClose={() => setHomePickerOpen(false)} />
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
    </Screen>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  scrollView: { flex: 1 },
  content:    { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, gap: 18 },

  // Member identity
  identityRow:     { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarWrap:      { width: 72, height: 72 },
  avatarOverlay:   { ...StyleSheet.absoluteFillObject, borderRadius: Radius.full, backgroundColor: c.scrim, alignItems: 'center', justifyContent: 'center' },
  cameraBadge:     { position: 'absolute', right: -2, bottom: -2, width: 28, height: 28, borderRadius: Radius.full, backgroundColor: c.primary,
                     borderWidth: 2, borderColor: c.bg, alignItems: 'center', justifyContent: 'center' },
  identityInfo:    { flex: 1, gap: 6 },
  identityName:    { fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  identityMetaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  metaItem:        { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  identityMeta:    { flexShrink: 1, fontSize: FontSizes.xs, fontWeight: '600', color: c.muted },

  // Guest
  guestHead:    { alignItems: 'center', gap: 8, paddingTop: Spacing.sm },
  guestName:    { fontSize: FontSizes.xl, fontWeight: '800', color: c.text },
  guestMeta:    { fontSize: FontSizes.xs, fontWeight: '500', color: c.muted },
  upgradeCard:  { padding: Spacing.md, gap: 10 },
  upgradeTitle: { fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  upgradeSub:   { fontSize: FontSizes.sm, fontWeight: '400', color: c.muted },
  upgradeHint:  { fontSize: FontSizes.xs, fontWeight: '500', color: c.muted, textAlign: 'center' },

  // Fields
  fieldGroup:           { gap: 6 },
  fieldLabel:           { fontSize: FontSizes.xs, fontWeight: '700', color: c.muted },
  fieldHint:            { fontSize: FontSizes.xs, fontWeight: '400', color: c.muted },
  counter:              { alignSelf: 'flex-end', fontSize: 12, fontWeight: '500', color: c.muted },
  uOkHint:              { marginTop: -12, fontSize: FontSizes.xs, fontWeight: '600', color: c.localText },
  readField:            { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 14, borderRadius: Radius.button,
                          borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  readFieldText:        { flex: 1, fontSize: FontSizes.md, fontWeight: '400', color: c.text },
  readFieldPlaceholder: { color: c.mutedDim },
  chipsWrap:            { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  settingsTitle: { marginTop: 6, marginBottom: -8 },
  versionWrap:   { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 20 },
  version:       { fontSize: FontSizes.xs, fontWeight: '500', color: c.mutedDim },

  // Sticky save
  stickyCta:       { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: Spacing.md, paddingTop: 10, gap: 4,
                     backgroundColor: c.bg, borderTopWidth: Border, borderTopColor: c.line },
  saveError:       { fontSize: FontSizes.xs, fontWeight: '600', color: c.red, textAlign: 'center' },
  stickyBottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  deleteBtn:       { minHeight: 44, justifyContent: 'center' },
  deleteText:      { fontSize: FontSizes.sm, fontWeight: '700', color: c.red },
});
