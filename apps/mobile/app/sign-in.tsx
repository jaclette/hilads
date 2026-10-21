import { useState } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { authLogin } from '@/api/auth';
import { joinChannel } from '@/api/channels';
import { useApp } from '@/context/AppContext';
import { socket } from '@/lib/socket';
import { saveIdentity } from '@/lib/identity';
import { safeReturnTo, authQuery } from '@/lib/authReturn';
import { track, identifyUser, setAnalyticsContext } from '@/services/analytics';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { Button, TextField } from '@/ui';
import { AuthScreen, PasswordEye } from '@/features/auth/AuthScreen';
import { goBack } from '@/lib/nav';


export default function SignInScreen() {
  const styles = useThemedStyles(makeStyles);

  const router = useRouter();
  const { t } = useTranslation('auth');
  const { returnTo, action } = useLocalSearchParams<{ returnTo?: string; action?: string }>();
  const safeReturn = safeReturnTo(typeof returnTo === 'string' ? returnTo : undefined);
  const {
    setAccount, setJoined, setCity, setIdentity,
    identity, sessionId,
    joined,        // false when coming from the pre-join landing screen
    detectedCity,  // geo-resolved city waiting to be joined
  } = useApp();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  async function handleSignIn() {
    const e = email.trim().toLowerCase();
    const p = password;
    if (!e || !p) { setError(t('signIn.errRequired')); return; }
    setLoading(true);
    setError(null);
    try {
      const { user } = await authLogin(e, p);
      setAccount(user);
      identifyUser(user.id, { account_type: 'registered', username: user.display_name });
      setAnalyticsContext({ is_guest: false, user_id: user.id, guest_id: null });
      track('user_authenticated');
      track('auth_login');
      // Started from the sign-up sheet (V3-11): which gated action converted.
      if (action) track('guest_signup_completed', { action, method: 'signin' });

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
        // Normal path: came from inside the app. Honour ?returnTo when
        // it points to an allowlisted internal path (e.g. signin
        // launched from a guest tapping "Take on" on a challenge);
        // otherwise pop the modal in place.
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
      const msg = err instanceof Error ? err.message : t('signIn.errFailed');
      setError(msg === 'HTTP 401' || msg.includes('401') ? t('signIn.errInvalid') : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthScreen title={t('signIn.title')} subtitle={t('signIn.subtitle')} error={error}>
      <TextField
        label={t('signIn.email')}
        value={email}
        onChangeText={setEmail}
        placeholder={t('signIn.emailPlaceholder')}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        editable={!loading}
      />
      <TextField
        label={t('signIn.password')}
        value={password}
        onChangeText={setPassword}
        placeholder="••••••••"
        secureTextEntry={!showPassword}
        autoComplete="password"
        editable={!loading}
        onSubmitEditing={handleSignIn}
        returnKeyType="done"
        right={<PasswordEye shown={showPassword} onPress={() => setShowPassword(v => !v)} />}
      />

      <Button label={t('signIn.submit')} onPress={handleSignIn} loading={loading} style={styles.submit} />
      <Button variant="link" label={t('signIn.forgot')} onPress={() => router.push('/forgot-password')} />

      <TouchableOpacity style={styles.switch} onPress={() => router.replace(`/sign-up${authQuery(returnTo, action)}` as never)} accessibilityRole="button">
        <Text style={styles.switchText}>
          {t('signIn.noAccount')} <Text style={styles.switchLink}>{t('signIn.createOne')}</Text>
        </Text>
      </TouchableOpacity>
    </AuthScreen>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  submit:     { marginTop: Spacing.sm },
  switch:     { minHeight: 44, justifyContent: 'center' },
  switchText: { fontSize: FontSizes.sm, fontWeight: '400', color: c.muted, textAlign: 'center' },
  switchLink: { fontWeight: '700', color: c.primaryText },
});
