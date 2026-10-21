import { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { authSignup, checkUsernameAvailability } from '@/api/auth';
import { joinChannel } from '@/api/channels';
import { useApp } from '@/context/AppContext';
import { socket } from '@/lib/socket';
import { saveIdentity } from '@/lib/identity';
import { safeReturnTo, authQuery } from '@/lib/authReturn';
import { track, identifyUser, setAnalyticsContext } from '@/services/analytics';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { EulaCheckbox, EulaCopyBlock } from '@/features/auth/EulaPromptModal';
import { AuthScreen, PasswordEye } from '@/features/auth/AuthScreen';
import { ModePicker } from '@/features/profile/ModePicker';
import { Button, TextField } from '@/ui';
import { goBack } from '@/lib/nav';


export default function SignUpScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const router = useRouter();
  const { t } = useTranslation('auth');
  const { returnTo, action } = useLocalSearchParams<{ returnTo?: string; action?: string }>();
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
  const [mode,     setMode]     = useState<string | null>('local'); // Local pre-selected - most sign-ups are people who know their city
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
      // Started from the sign-up sheet (V3-11): which gated action converted.
      if (action) track('guest_signup_completed', { action, method: 'signup' });

      // ── Pre-join city restore ─────────────────────────────────────────────
      // If the user came from the landing screen (joined=false) and geo already
      // resolved a city, complete the join flow they were about to do before
      // going to auth.
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
          router.replace((safeReturn ?? '/(tabs)/today') as never);
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
          // Pops back to returnTo when it's still in the stack (the sheet was
          // opened over it), otherwise replaces this screen with it.
          router.dismissTo(safeReturn as never);
        } else {
          goBack();
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
    <AuthScreen title={t('signUp.title')} subtitle={t('signUp.subtitle')} error={error}>
      <View style={styles.field}>
        <TextField
          label={t('signUp.username')}
          prefix="@"
          value={username}
          testID="signup-username"
          onChangeText={handleUsernameChange}
          placeholder={t('signUp.usernamePlaceholder')}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
          editable={!loading}
          right={
            uStatus === 'checking' ? <ActivityIndicator size="small" color={colors.muted} />
            : uStatus === 'available' ? <Ionicons name="checkmark-circle-outline" size={22} color={colors.green} />
            : uStatus === 'taken' || uStatus === 'invalid' ? <Ionicons name="close-circle-outline" size={22} color={colors.red} />
            : null
          }
        />
        {uStatus === 'available' && <Text style={styles.uOkHint}>{t('signUp.available', { username })}</Text>}
        {(uStatus === 'taken' || uStatus === 'invalid') && uReason && <Text style={styles.uBadHint}>{uReason}</Text>}
      </View>

      <ModePicker value={mode === 'local' || mode === 'exploring' ? mode : null} onChange={setMode} disabled={loading} />

      <TextField
        label={t('signUp.email')}
        value={email}
        testID="signup-email"
        onChangeText={setEmail}
        placeholder={t('signUp.emailPlaceholder')}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        editable={!loading}
      />
      <TextField
        label={t('signUp.password')}
        value={password}
        testID="signup-password"
        onChangeText={setPassword}
        placeholder={t('signUp.passwordPlaceholder')}
        secureTextEntry={!showPassword}
        autoComplete="new-password"
        editable={!loading}
        onSubmitEditing={handleSignUp}
        returnKeyType="done"
        right={<PasswordEye shown={showPassword} onPress={() => setShowPassword(v => !v)} />}
      />

      {/* EULA - Apple G1.2 requires explicit acceptance before account creation. */}
      <View style={styles.eula}>
        <EulaCopyBlock />
        <EulaCheckbox checked={eula} onToggle={() => setEula(v => !v)} disabled={loading} />
      </View>

      <Button label={t('signUp.submit')} onPress={handleSignUp} loading={loading} disabled={!eula} style={styles.submit} />

      <TouchableOpacity style={styles.switch} onPress={() => router.replace(`/sign-in${authQuery(returnTo, action)}` as never)} accessibilityRole="button">
        <Text style={styles.switchText}>
          {t('signUp.haveAccount')} <Text style={styles.switchLink}>{t('signUp.signInLink')}</Text>
        </Text>
      </TouchableOpacity>
    </AuthScreen>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  field:      { gap: 6 },
  uOkHint:    { fontSize: FontSizes.xs, fontWeight: '600', color: c.green },
  uBadHint:   { fontSize: FontSizes.xs, fontWeight: '600', color: c.red },
  eula:       { gap: Spacing.sm, marginTop: Spacing.xs },
  submit:     { marginTop: Spacing.sm },
  switch:     { minHeight: 44, justifyContent: 'center' },
  switchText: { fontSize: FontSizes.sm, fontWeight: '400', color: c.muted, textAlign: 'center' },
  switchLink: { fontWeight: '700', color: c.primaryText },
});
