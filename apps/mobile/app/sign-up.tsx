import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { authSignup } from '@/api/auth';
import { joinChannel } from '@/api/channels';
import { useApp } from '@/context/AppContext';
import { socket } from '@/lib/socket';
import { saveIdentity } from '@/lib/identity';
import { track, identifyUser, setAnalyticsContext } from '@/services/analytics';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

const MODES = [
  { key: 'local',     emoji: '🌍', label: 'Local',     desc: 'You know this city'    },
  { key: 'exploring', emoji: '🧭', label: 'Exploring', desc: "You're discovering it" },
] as const;

export default function SignUpScreen() {
  const router = useRouter();
  const {
    setAccount, setJoined, setCity, setIdentity,
    identity, sessionId,
    joined,        // false when coming from the pre-join landing screen
    detectedCity,  // geo-resolved city waiting to be joined
  } = useApp();

  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [mode,     setMode]     = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  async function handleSignUp() {
    const n = name.trim();
    const e = email.trim().toLowerCase();
    const p = password;

    if (!n)           { setError('Display name required'); return; }
    if (!mode)        { setError('Please choose a mode to continue'); return; }
    if (!e)           { setError('Email required'); return; }
    if (p.length < 8) { setError('Password must be at least 8 characters'); return; }

    setLoading(true);
    setError(null);
    try {
      // Pass guestId so the backend can merge existing guest events/data
      const guestId = identity?.guestId ?? '';
      const { user } = await authSignup(e, p, n, guestId, mode);
      setAccount(user);
      identifyUser(user.id, { account_type: 'registered', username: user.display_name });
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

            {/* Mode selector */}
            <View style={styles.modeSection}>
              <Text style={styles.modeLabel}>MODE</Text>
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
                      <Text style={[styles.modeBtnLabel, active && styles.modeBtnLabelActive]}>{m.label}</Text>
                      <Text style={styles.modeBtnDesc}>{m.desc}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
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

  switchText: { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center', marginTop: Spacing.sm },
  switchLink: { color: Colors.accent, fontWeight: '600' },

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
    borderColor:       Colors.border,
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
    color:      Colors.muted,
  },
  modeBtnLabelActive: {
    color: '#fff',
  },
  modeBtnDesc: {
    fontSize:   FontSizes.xs,
    color:      Colors.muted2,
    textAlign:  'center',
    lineHeight: 16,
  },
});
