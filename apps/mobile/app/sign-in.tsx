import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { authLogin } from '@/api/auth';
import { useApp } from '@/context/AppContext';
import { track, identifyUser, setAnalyticsContext } from '@/services/analytics';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

export default function SignInScreen() {
  const router = useRouter();
  const { setAccount, setJoined } = useApp();

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
      setJoined(true);   // dismiss LandingScreen if it was showing
      identifyUser(user.id, { account_type: 'registered', username: user.display_name });
      setAnalyticsContext({ is_guest: false, user_id: user.id, guest_id: null });
      track('user_authenticated');
      track('auth_login');
      router.back(); // usePushRegistration in _layout.tsx reacts to setAccount above
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
  scroll:    { flexGrow: 1 },

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
    marginTop:       Spacing.sm,
    height:          52,
    justifyContent:  'center',
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: { color: Colors.white, fontWeight: '700', fontSize: FontSizes.md },

  switchText: { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center', marginTop: Spacing.sm },
  switchLink: { color: Colors.accent, fontWeight: '600' },
});
