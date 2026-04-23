/**
 * Event limit reached — shown when a non-Legend user taps any "Create event"
 * CTA after they've already created their event today. Also reached from
 * app/event/create.tsx when the POST returns `event_limit_reached` (server
 * safety net against race conditions).
 *
 * See /Users/jacques/.claude/plans/lovely-plotting-hearth.md for the full
 * rollout plan and the friendly-copy rationale.
 */

import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

export default function EventLimitReachedScreen() {
  const router = useRouter();

  function handleLegendInfo() {
    Alert.alert(
      '👑 Become a Legend',
      "Legends are locals chosen to keep their city alive — they can host as many events as they want. Want to become one? Reach out at hello@hilads.live.",
      [{ text: 'Got it', style: 'default' }],
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* Header: back pill only — no title, clean hero layout */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/now')}
          activeOpacity={0.75}
        >
          <Ionicons name="chevron-back" size={20} color={Colors.text} />
        </TouchableOpacity>
      </View>

      {/* Centered hero */}
      <View style={styles.hero}>
        <Text style={styles.emoji}>🎉</Text>
        <Text style={styles.title}>You've already created your event today!</Text>
        <Text style={styles.body}>
          At Hilads, we keep things fresh — one event per day so every plan
          gets the attention it deserves. Come back tomorrow to create another
          one.
        </Text>

        <TouchableOpacity
          style={styles.legendLink}
          onPress={handleLegendInfo}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Learn about becoming a Legend"
        >
          <Text style={styles.legendLinkText}>👑 Become a Legend to create unlimited events</Text>
        </TouchableOpacity>
      </View>

      {/* Primary action */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => router.replace('/(tabs)/now')}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Back to Now</Text>
        </TouchableOpacity>
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   12,
    minHeight:         56,
  },
  backBtn: {
    width:           40,
    height:          40,
    borderRadius:    12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.10)',
    alignItems:      'center',
    justifyContent:  'center',
  },

  hero: {
    flex:              1,
    paddingHorizontal: Spacing.xl,
    alignItems:        'center',
    justifyContent:    'center',
    gap:               18,
  },
  emoji: {
    fontSize:  72,
    lineHeight: 84,
    marginBottom: 6,
  },
  title: {
    fontSize:      FontSizes.xl,
    fontWeight:    '800',
    color:         Colors.text,
    letterSpacing: -0.5,
    textAlign:     'center',
    paddingHorizontal: 12,
  },
  body: {
    fontSize:      FontSizes.md,
    lineHeight:    22,
    color:         Colors.muted,
    textAlign:     'center',
    paddingHorizontal: 8,
  },
  legendLink: {
    marginTop:         10,
    paddingHorizontal: 16,
    paddingVertical:   10,
  },
  legendLinkText: {
    fontSize:      FontSizes.sm,
    color:         Colors.accent,
    fontWeight:    '600',
    textAlign:     'center',
  },

  footer: {
    paddingHorizontal: Spacing.xl,
    paddingBottom:     Spacing.xl,
    paddingTop:        Spacing.md,
  },
  primaryBtn: {
    backgroundColor: Colors.accent,
    borderRadius:    Radius.lg,
    paddingVertical: 17,
    alignItems:      'center',
    justifyContent:  'center',
    minHeight:       54,
  },
  primaryBtnText: {
    color:         Colors.white,
    fontSize:      FontSizes.md,
    fontWeight:    '700',
    letterSpacing: -0.2,
  },
});
