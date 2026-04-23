import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { authLogin } from '@/api/auth';
import { joinChannel } from '@/api/channels';
import { useApp } from '@/context/AppContext';
import { socket } from '@/lib/socket';
import { saveIdentity } from '@/lib/identity';
import { track, identifyUser, setAnalyticsContext } from '@/services/analytics';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

export default function SignInScreen() {
  const router = useRouter();
  const {
    setAccount, setJoined, setCity, setIdentity,
    identity, sessionId,
    joined,        // false when coming from the pre-join landing screen
    detectedCity,  // geo-resolved city waiting to be joined
  } = useApp();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  async function handleSignIn() {
    const e = email.trim().toLowerCase();
    const p = password;
    if (!e || !p) { setError('Email and password required'); return; }
    setLoading(true);
    setError(null);
    try {
      const { user } = await authLogin(e, p);
      setAccount(user);
      identifyUser(user.id, { account_type: 'registered', username: user.display_name });
      setAnalyticsContext({ is_guest: false, user_id: user.id, guest_id: null });
      track('user_authenticated');
      track('auth_login');

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
          if (socket.isConnected) {
            socket.joinCity(detectedCity.channelId, sessionId, nickname, userId, identity.guestId);
          } else {
            socket.on('connected', () =>
              socket.joinCity(detectedCity.channelId, sessionId, nickname, userId, identity.guestId),
            );
          }
          // Persist channelId so next boot treats user as returning
          const updated = { ...identity, nickname, channelId: detectedCity.channelId };
          await saveIdentity(updated);
          setIdentity(updated);
          setJoined(true);
          router.replace('/(tabs)/chat');
        } catch {
          // Join failed — authenticate but let user pick a city
          setJoined(true);
          router.replace('/switch-city' as never);
        }
      } else {
        // Normal path: came from inside the app (joined=true) or no pending city
        setJoined(true);
        router.back();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sign in failed';
      setError(msg === 'HTTP 401' || msg.includes('401') ? 'Invalid email or password' : msg);
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
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>Sign in to your Hilads account</Text>

            {error && <Text style={styles.error}>{error}</Text>}

            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={Colors.muted2}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                editable={!loading}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={Colors.muted2}
                secureTextEntry
                autoComplete="password"
                editable={!loading}
                onSubmitEditing={handleSignIn}
                returnKeyType="done"
              />
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
              onPress={handleSignIn}
              activeOpacity={0.85}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color={Colors.white} />
                : <Text style={styles.submitText}>Sign in</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.push('/forgot-password')} activeOpacity={0.7}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.replace('/sign-up')} activeOpacity={0.7}>
              <Text style={styles.switchText}>
                No account? <Text style={styles.switchLink}>Create one →</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  flex:      { flex: 1 },
  scroll:    { flexGrow: 1, paddingBottom: Spacing.xxl },

  header:   { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  backBtn:  { padding: 4, alignSelf: 'flex-start' },
  backIcon: { fontSize: 22, color: Colors.text },

  body: {
    flex:              1,
    paddingHorizontal: Spacing.lg,
    paddingTop:        Spacing.xl,
    gap:               Spacing.md,
  },
  title:    { fontSize: FontSizes.xxl, fontWeight: '700', color: Colors.text },
  subtitle: { fontSize: FontSizes.sm,  color: Colors.muted, marginBottom: Spacing.sm },

  error: {
    fontSize:          FontSizes.sm,
    color:             Colors.red,
    backgroundColor:   'rgba(248,113,113,0.1)',
    borderRadius:      Radius.md,
    padding:           Spacing.sm,
  },

  field:  { gap: 6 },
  label:  { fontSize: FontSizes.sm, color: Colors.muted, fontWeight: '500' },
  input: {
    backgroundColor:   Colors.bg2,
    borderWidth:       1,
    borderColor:       Colors.border,
    borderRadius:      Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    color:             Colors.text,
    fontSize:          FontSizes.md,
    height:            48,
  },

  submitBtn: {
    backgroundColor: Colors.accent,
    borderRadius:    Radius.lg,
    paddingVertical: Spacing.md,
    alignItems:      'center',
    justifyContent:  'center',
    marginTop:       Spacing.sm,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: {
    color:              Colors.white,
    fontWeight:         '700',
    fontSize:           FontSizes.md,
    lineHeight:         FontSizes.md * 1.25,
    includeFontPadding: false,
  },

  forgotText: { fontSize: FontSizes.sm, color: Colors.muted2, textAlign: 'center' },
  switchText: { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center', marginTop: Spacing.sm },
  switchLink: { color: Colors.accent, fontWeight: '600' },
});
