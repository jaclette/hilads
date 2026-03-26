import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

interface Props {
  title?:    string;
  subtitle?: string;
}

export function UpgradePrompt({
  title    = 'Create a free account',
  subtitle = 'Sign in to unlock direct messages, notifications, and a persistent identity.',
}: Props) {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🔓</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      <TouchableOpacity
        style={styles.primaryBtn}
        onPress={() => router.push('/sign-up')}
        activeOpacity={0.85}
      >
        <Text style={styles.primaryText}>Create account</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryBtn}
        onPress={() => router.push('/sign-in')}
        activeOpacity={0.8}
      >
        <Text style={styles.secondaryText}>Sign in</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex:            1,
    justifyContent:  'center',
    alignItems:      'center',
    paddingHorizontal: Spacing.xl,
    gap:             Spacing.sm,
  },
  icon:      { fontSize: 40, marginBottom: Spacing.sm },
  title:     { fontSize: FontSizes.lg, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  subtitle:  { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center', lineHeight: 20, marginBottom: Spacing.md },

  primaryBtn: {
    width:             '100%',
    backgroundColor:   Colors.accent,
    borderRadius:      Radius.lg,
    paddingVertical:   Spacing.md,
    alignItems:        'center',
  },
  primaryText: { color: Colors.white, fontWeight: '700', fontSize: FontSizes.md },

  secondaryBtn: {
    width:         '100%',
    borderRadius:  Radius.lg,
    paddingVertical: Spacing.md,
    alignItems:    'center',
    borderWidth:   1,
    borderColor:   Colors.border,
  },
  secondaryText: { color: Colors.text, fontWeight: '600', fontSize: FontSizes.md },
});
