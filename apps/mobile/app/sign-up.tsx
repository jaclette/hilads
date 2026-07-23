import { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { authSignup, checkUsernameAvailability } from '@/api/auth';
import { joinChannel } from '@/api/channels';
import { useApp } from '@/context/AppContext';
import { socket } from '@/lib/socket';
import { saveIdentity } from '@/lib/identity';
import { track, identifyUser, setAnalyticsContext } from '@/services/analytics';
import { FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { EulaCheckbox, EulaCopyBlock } from '@/features/auth/EulaPromptModal';

const MODES = [
  { key: 'local',     emoji: '🌍' },
  { key: 'exploring', emoji: '🧭' },
] as const;

// Allowlist of return-path prefixes accepted on the ?returnTo query
// param. Keeping this tight prevents an attacker from crafting a
// signup deeplink that bounces the user to an arbitrary internal
// (or external) screen - only the surfaces we actually launch signup
// from are honoured.
const RETURN_TO_ALLOWLIST = ['/challenge/', '/event/', '/t/'];

function safeReturnTo(raw: string | undefined): string | null {
  if (!raw) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(raw); } catch { return null; }
  if (!decoded.startsWith('/')) return null;          // no external URLs
  if (decoded.startsWith('//'))  return null;          // no protocol-relative
  return RETURN_TO_ALLOWLIST.some(p => decoded.startsWith(p)) ? decoded : null;
}

export default function SignUpScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const router = useRouter();
  const { t } = useTranslation('auth');
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const safeReturn = safeReturnTo(typeof returnTo === 'string' ? returnTo : undefined);
  const {
    setAccount, setJoined, setCity, setIdentity, setShowAccountWelcome,
    identity, sessionId,
    joined,        // false when coming from the pre-join landing screen
    detectedCity,  // geo-resolved city waiting to be joined
  } = useApp();

  const [username, setUsername] = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mode,     setMode]     = useState<string | null>(null);
  const [eula,     setEula]     = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  // Username availability - debounced check against the backend.
  type UStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';
  const [uStatus, setUStatus] = useState<UStatus>('idle');
  const [uReason, setUReason] = useState<string | null>(null);
  const uTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleUsernameChange(val: string) {
    // Handles are lowercase a-z0-9_ - strip disallowed chars as the user types.
    const cleaned = val.toLowerCase().replace(/[^a-z0-9_]/g, '');
    setUsername(cleaned);
    setUReason(null);
    if (uTimer.current) clearTimeout(uTimer.current);
    if (cleaned.length < 3) { setUStatus(cleaned.length === 0 ? 'idle' : 'invalid'); return; }
    setUStatus('checking');
    uTimer.current = setTimeout(async () => {
      try {
        const r = await checkUsernameAvailability(cleaned);
        if (!r.valid)        { setUStatus('invalid');   setUReason(r.reason); }
        else if (r.available){ setUStatus('available'); }
        else                 { setUStatus('taken');     setUReason(r.reason); }
      } catch { setUStatus('idle'); }
    }, 450);
  }

  async function handleSignUp() {
    const e = email.trim().toLowerCase();
    const p = password;

    // Username is the single identity field - it doubles as the display name.
    if (username.length < 3)   { setError(t('signUp.errUsername')); return; }
    if (uStatus === 'taken')   { setError(t('signUp.errTaken')); return; }
    if (uStatus === 'invalid') { setError(uReason ?? t('signUp.errInvalidUsername')); return; }
    if (!mode)                 { setError(t('signUp.errMode')); return; }
    if (!e)                    { setError(t('signUp.errEmail')); return; }
    if (p.length < 8)          { setError(t('signUp.errPassword')); return; }
    if (!eula)                 { setError(t('signUp.errEula')); return; }

    setLoading(true);
    setError(null);
    try {
      // Pass guestId so the backend can merge existing guest events/data.
      // display_name == username (single identity field).
      const guestId = identity?.guestId ?? '';
      const { user } = await authSignup(e, p, username, username, guestId, mode, true /* eulaAccepted */);
      setAccount(user);
      setShowAccountWelcome(true);   // one-time congrats screen (rendered in the root layout)
      identifyUser(user.id, { account_type: 'registered', username: user.username ?? user.display_name });
      setAnalyticsContext({ is_guest: false, user_id: user.id, guest_id: null });
      track('user_authenticated');
      track('auth_signup');

      // ── Pre-join city restore ─────────────────────────────────────────────
      // If the user came from the landing screen (joined=false) and geo already
      // resolved a city, complete the join flow they were about to do before
      // going to auth. This mirrors LandingScreen.handleJoin() exactly.
      if (!joined && detectedCity && identity && sessionId) {
        const nickname = user.display_name;
        try {
          await joinChannel(detectedCity.channelId, sessionId, identity.guestId, nickname);
          setCity(detectedCity);
          const userId = user.id;
          // joinCity queues replay if WS isn't connected yet - no on('connected') subscription.
          socket.joinCity(detectedCity.channelId, sessionId, nickname, userId, identity.guestId);
          // Persist channelId so next boot treats user as returning
          const updated = { ...identity, nickname, channelId: detectedCity.channelId };
          await saveIdentity(updated);
          setIdentity(updated);
          setJoined(true);
          router.replace('/(tabs)/chat');
        } catch {
          // Join failed - authenticate but let user pick a city
          setJoined(true);
          router.replace('/switch-city' as never);
        }
      } else {
        // Normal path: came from inside the app. If we have an allowlisted
        // returnTo (e.g. signup launched from a guest tapping "Take on"
        // on a challenge), replace into that target so the user lands
        // back on the originating screen primed to retry the action.
        // Otherwise the existing back() pops the modal in place.
        setJoined(true);
        if (safeReturn) {
          router.replace(safeReturn as never);
        } else {
          router.back();
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('signUp.errFailed');
      setError(msg.includes('409') || msg.includes('already') ? t('signUp.errEmailTaken') : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
              <Text style={styles.backIcon}>←</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.body}>
            <Text style={styles.title}>{t('signUp.title')}</Text>
            <Text style={styles.subtitle}>{t('signUp.subtitle')}</Text>

            {error && <Text style={styles.error}>{error}</Text>}

            <View style={styles.field}>
              <Text style={styles.label}>{t('signUp.username')}</Text>
              <View style={styles.usernameRow}>
                <Text style={styles.usernameAt}>@</Text>
                <TextInput
                  style={styles.usernameInput}
                  value={username}
                  onChangeText={handleUsernameChange}
                  placeholder={t('signUp.usernamePlaceholder')}
                  placeholderTextColor={colors.muted2}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={20}
                  editable={!loading}
                />
                {uStatus === 'checking' && <ActivityIndicator size="small" color={colors.muted} />}
                {uStatus === 'available' && <Text style={styles.uOk}>✓</Text>}
                {(uStatus === 'taken' || uStatus === 'invalid') && <Text style={styles.uBad}>✗</Text>}
              </View>
              {uStatus === 'available' && <Text style={styles.uOkHint}>{t('signUp.available', { username })}</Text>}
              {(uStatus === 'taken' || uStatus === 'invalid') && uReason && (
                <Text style={styles.uBadHint}>{uReason}</Text>
              )}
            </View>

            {/* Mode selector */}
            <View style={styles.modeSection}>
              <Text style={styles.modeLabel}>{t('modeHeading', { ns: 'common' })}</Text>
              <View style={styles.modeRow}>
                {MODES.map(m => {
                  const active = mode === m.key;
                  return (
                    <TouchableOpacity
                      key={m.key}
                      style={[styles.modeBtn, active && styles.modeBtnActive]}
                      onPress={() => setMode(m.key)}
                      activeOpacity={0.75}
                      disabled={loading}
                    >
                      <Text style={styles.modeBtnEmoji}>{m.emoji}</Text>
                      <Text style={[styles.modeBtnLabel, active && styles.modeBtnLabelActive]}>{t(`mode.${m.key}.label`, { ns: 'common' })}</Text>
                      <Text style={styles.modeBtnDesc}>{t(`mode.${m.key}.desc`, { ns: 'common' })}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>{t('signUp.email')}</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder={t('signUp.emailPlaceholder')}
                placeholderTextColor={colors.muted2}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                editable={!loading}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>{t('signUp.password')}</Text>
              {/* PR32 - show/hide eye toggle (parity with sign-in). */}
              <View style={styles.passwordWrap}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder={t('signUp.passwordPlaceholder')}
                  placeholderTextColor={colors.muted2}
                  secureTextEntry={!showPassword}
                  autoComplete="new-password"
                  editable={!loading}
                  onSubmitEditing={handleSignUp}
                  returnKeyType="done"
                />
                <TouchableOpacity
                  style={styles.passwordToggle}
                  onPress={() => setShowPassword(v => !v)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={colors.muted2}
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* EULA - Apple G1.2 requires explicit acceptance before account creation. */}
            <View style={styles.eulaSection}>
              <EulaCopyBlock />
              <EulaCheckbox checked={eula} onToggle={() => setEula(v => !v)} disabled={loading} />
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, (loading || !eula) && styles.submitBtnDisabled]}
              onPress={handleSignUp}
              activeOpacity={0.85}
              disabled={loading || !eula}
            >
              {loading
                ? <ActivityIndicator color={colors.white} />
                : <Text style={styles.submitText}>{t('signUp.submit')}</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.replace('/sign-in')} activeOpacity={0.7}>
              <Text style={styles.switchText}>
                {t('signUp.haveAccount')} <Text style={styles.switchLink}>{t('signUp.signInLink')}</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  flex:      { flex: 1 },
  scroll:    { flexGrow: 1 },

  header:   { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  backBtn:  { padding: 4, alignSelf: 'flex-start' },
  backIcon: { fontSize: 22, color: c.text },

  body: {
    flex:              1,
    paddingHorizontal: Spacing.lg,
    paddingTop:        Spacing.xl,
    gap:               Spacing.md,
  },
  title:    { fontSize: FontSizes.xxl, fontWeight: '700', color: c.text },
  subtitle: { fontSize: FontSizes.sm,  color: c.muted, marginBottom: Spacing.sm },

  error: {
    fontSize:        FontSizes.sm,
    color:           c.red,
    backgroundColor: 'rgba(248,113,113,0.1)',
    borderRadius:    Radius.md,
    padding:         Spacing.sm,
  },

  field:  { gap: 6 },
  label:  { fontSize: FontSizes.sm, color: c.muted, fontWeight: '500' },
  input: {
    backgroundColor:   c.bg2,
    borderWidth:       1,
    borderColor:       c.border,
    borderRadius:      Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    color:             c.text,
    fontSize:          FontSizes.md,
    height:            48,
  },
  passwordWrap:    { position: 'relative' },
  passwordInput:   { paddingRight: 44 },
  passwordToggle: {
    position:       'absolute',
    right:          8,
    top:            8,
    width:          32,
    height:         32,
    alignItems:     'center',
    justifyContent: 'center',
    borderRadius:   8,
  },

  usernameRow: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               6,
    backgroundColor:   c.bg2,
    borderWidth:       1,
    borderColor:       c.border,
    borderRadius:      Radius.md,
    paddingHorizontal: Spacing.md,
    height:            48,
  },
  usernameAt:    { fontSize: FontSizes.md, color: c.muted2, fontWeight: '600' },
  usernameInput: { flex: 1, color: c.text, fontSize: FontSizes.md, height: 48 },
  uOk:           { color: '#4ade80', fontSize: FontSizes.md, fontWeight: '700' },
  uBad:          { color: c.red, fontSize: FontSizes.md, fontWeight: '700' },
  uOkHint:       { fontSize: FontSizes.xs, color: '#4ade80' },
  uBadHint:      { fontSize: FontSizes.xs, color: c.red },

  eulaSection: {
    marginTop: Spacing.sm,
    gap:       Spacing.sm,
  },

  submitBtn: {
    backgroundColor: c.accent,
    borderRadius:    Radius.lg,
    paddingVertical: Spacing.md,
    alignItems:      'center',
    justifyContent:  'center',
    marginTop:       Spacing.sm,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: {
    color:              c.white,
    fontWeight:         '700',
    fontSize:           FontSizes.md,
    lineHeight:         FontSizes.md * 1.25,
    includeFontPadding: false,
  },

  switchText: { fontSize: FontSizes.sm, color: c.muted, textAlign: 'center', marginTop: Spacing.sm },
  switchLink: { color: c.accent, fontWeight: '600' },

  modeSection: {
    padding:         Spacing.md,
    backgroundColor: 'rgba(96,165,250,0.06)',
    borderRadius:    Radius.md,
    borderWidth:     1.5,
    borderColor:     'rgba(96,165,250,0.22)',
    gap:             10,
  },
  modeLabel: {
    fontSize:      FontSizes.xs,
    fontWeight:    '800',
    color:         '#60a5fa',
    letterSpacing: 1,
  },
  modeRow: {
    flexDirection: 'row',
    gap:           8,
  },
  modeBtn: {
    flex:              1,
    paddingVertical:   16,
    paddingHorizontal: 8,
    borderRadius:      Radius.md,
    borderWidth:       1.5,
    borderColor:       c.border,
    backgroundColor:   'transparent',
    alignItems:        'center',
    gap:               3,
  },
  modeBtnActive: {
    borderColor:     '#60a5fa',
    backgroundColor: 'rgba(96,165,250,0.16)',
  },
  modeBtnEmoji: {
    fontSize:   26,
    lineHeight: 30,
  },
  modeBtnLabel: {
    fontSize:   FontSizes.md,
    fontWeight: '700',
    color:      c.muted,
  },
  modeBtnLabelActive: {
    color: '#fff',
  },
  modeBtnDesc: {
    fontSize:   FontSizes.xs,
    color:      c.muted2,
    textAlign:  'center',
    lineHeight: 16,
  },
});
