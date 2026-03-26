import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { authSignup } from '@/api/auth';
import { persistToken } from '@/services/session';
import { useApp } from '@/context/AppContext';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { track } from '@/services/analytics';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

export default function SignUpScreen() {
  const router = useRouter();
  const { setAccount, identity } = useApp();
  const { requestIfAppropriate } = usePushNotifications();

  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  async function handleSignUp() {
    const n = name.trim();
    const e = email.trim().toLowerCase();
    const p = password;

    if (!n)        { setError('Display name required'); return; }
    if (!e)        { setError('Email required'); return; }
    if (p.length < 8) { setError('Password must be at least 8 characters'); return; }

    setLoading(true);
    setError(null);
    try {
      // Pass guestId so the backend can merge existing guest events/data
      const guestId = identity?.guestId ?? '';
      const { user } = await authSignup(e, p, n, guestId);
      await persistToken();
      setAccount(user);
      track('auth_signup');
      requestIfAppropriate(); // ask for push after successful registration
      router.back();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sign up failed';
      setError(msg.includes('409') || msg.includes('already') ? 'Email already registered' : msg);
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
            <Text style={styles.title}>Join Hilads</Text>
            <Text style={styles.subtitle}>Your guest activity will be carried over.</Text>

            {error && <Text style={styles.error}>{error}</Text>}

            <View style={styles.field}>
              <Text style={styles.label}>Your name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="How should we call you?"
                placeholderTextColor={Colors.muted2}
                autoCapitalize="words"
                autoCorrect={false}
                editable={!loading}
              />
            </View>

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
                placeholder="8+ characters"
                placeholderTextColor={Colors.muted2}
                secureTextEntry
                autoComplete="new-password"
                editable={!loading}
                onSubmitEditing={handleSignUp}
                returnKeyType="done"
              />
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
              onPress={handleSignUp}
              activeOpacity={0.85}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color={Colors.white} />
                : <Text style={styles.submitText}>Create account</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.replace('/sign-in')} activeOpacity={0.7}>
              <Text style={styles.switchText}>
                Already have an account? <Text style={styles.switchLink}>Sign in →</Text>
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
    fontSize:        FontSizes.sm,
    color:           Colors.red,
    backgroundColor: 'rgba(248,113,113,0.1)',
    borderRadius:    Radius.md,
    padding:         Spacing.sm,
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
