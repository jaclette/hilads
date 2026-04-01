/**
 * AuthGate — shown when a ghost user tries to access a registered profile.
 *
 * Explains what they're missing and offers account creation or sign-in.
 */

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

const BENEFITS = [
  { emoji: '👤', text: 'View profiles' },
  { emoji: '🎉', text: 'Create your own events' },
  { emoji: '🤝', text: 'Build your friends list' },
  { emoji: '💬', text: 'Connect with people' },
  { emoji: '✨', text: 'Keep your identity' },
];

export default function AuthGateScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>

      {/* Back */}
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
        <Ionicons name="chevron-back" size={20} color={Colors.text} />
      </TouchableOpacity>

      <View style={styles.body}>

        {/* Hero */}
        <Text style={styles.ghost}>👻</Text>
        <Text style={styles.title}>Ghost mode is fun…</Text>
        <Text style={styles.subtitle}>…but profiles unlock when you join the vibe</Text>

        {/* Benefits */}
        <View style={styles.benefits}>
          {BENEFITS.map(b => (
            <View key={b.text} style={styles.benefitRow}>
              <Text style={styles.benefitEmoji}>{b.emoji}</Text>
              <Text style={styles.benefitText}>{b.text}</Text>
            </View>
          ))}
        </View>

        {/* CTAs */}
        <TouchableOpacity
          style={styles.primary}
          onPress={() => router.push('/sign-up')}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryText}>Create account</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondary}
          onPress={() => router.push('/sign-in')}
          activeOpacity={0.8}
        >
          <Text style={styles.secondaryText}>Sign in</Text>
        </TouchableOpacity>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex:            1,
    backgroundColor: Colors.bg,
  },
  backBtn: {
    margin:          Spacing.md,
    width:           40,
    height:          40,
    borderRadius:    12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.10)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  body: {
    flex:              1,
    alignItems:        'center',
    justifyContent:    'center',
    paddingHorizontal: Spacing.xl,
    paddingBottom:     Spacing.xl,
    gap:               Spacing.md,
  },
  ghost: {
    fontSize:   56,
    marginBottom: 4,
  },
  title: {
    fontSize:      FontSizes.xxl,
    fontWeight:    '800',
    color:         Colors.text,
    textAlign:     'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize:   FontSizes.md,
    color:      Colors.muted,
    textAlign:  'center',
    lineHeight: 22,
  },
  benefits: {
    alignSelf: 'stretch',
    gap:       10,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.sm,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           12,
    paddingVertical: 4,
  },
  benefitEmoji: {
    fontSize: 20,
    width:    28,
    textAlign: 'center',
  },
  benefitText: {
    fontSize:   FontSizes.md,
    color:      Colors.text,
    fontWeight: '500',
  },
  primary: {
    alignSelf:         'stretch',
    backgroundColor:   Colors.accent,
    borderRadius:      Radius.lg,
    paddingVertical:   16,
    alignItems:        'center',
    marginTop:         Spacing.sm,
    shadowColor:       Colors.accent,
    shadowOffset:      { width: 0, height: 4 },
    shadowOpacity:     0.35,
    shadowRadius:      10,
    elevation:         6,
  },
  primaryText: {
    color:      '#fff',
    fontSize:   FontSizes.md,
    fontWeight: '700',
  },
  secondary: {
    alignSelf:         'stretch',
    borderRadius:      Radius.lg,
    paddingVertical:   16,
    alignItems:        'center',
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.15)',
    backgroundColor:   'rgba(255,255,255,0.04)',
  },
  secondaryText: {
    color:      Colors.text,
    fontSize:   FontSizes.md,
    fontWeight: '600',
  },
});
