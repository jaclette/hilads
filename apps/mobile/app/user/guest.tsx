/**
 * Guest profile screen — /user/guest
 *
 * Shown when a feed join-bubble is tapped for a guest who has no registered
 * account. Receives nickname + guestId as route params; shows a minimal
 * profile card with generated avatar, "Guest" label, and city context.
 * Does NOT call the /users/{id} API endpoint.
 */

import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

// ── Avatar palette — mirrors ChatMessage.tsx / [id].tsx ───────────────────────

const AVATAR_BG = [
  '#7c6aff', '#ff6a9f', '#22d3ee', '#4ade80',
  '#fb923c', '#f472b6', '#818cf8', '#2dd4bf',
];

function avatarBg(name: string): string {
  const hash = (name ?? '?').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_BG[hash % AVATAR_BG.length];
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function GuestProfileScreen() {
  const router = useRouter();
  const { nickname, guestId } = useLocalSearchParams<{ nickname: string; guestId: string }>();
  const { city } = useApp();

  const name    = nickname || 'Guest';
  const initial = name[0].toUpperCase();
  const bg      = avatarBg(name);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Profile</Text>
        </View>
      </View>

      {/* Hero */}
      <View style={styles.hero}>
        <View style={[styles.avatar, { backgroundColor: bg }]}>
          <Text style={styles.avatarInitial}>{initial}</Text>
        </View>

        <Text style={styles.displayName}>{name}</Text>

        <View style={styles.guestBadge}>
          <Text style={styles.guestBadgeText}>GUEST</Text>
        </View>

        {city ? (
          <Text style={styles.cityLabel}>Visiting {city}</Text>
        ) : null}
      </View>

      <Text style={styles.note}>This person is browsing as a guest.</Text>

    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const AVATAR_SIZE = 88;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    minHeight:         56,
  },
  backBtn: {
    width:           40,
    height:          40,
    borderRadius:    Radius.md,
    backgroundColor: Colors.bg2,
    borderWidth:     1,
    borderColor:     Colors.border,
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
    zIndex:          1,
  },
  headerCenter: {
    position:   'absolute',
    left:       0,
    right:      0,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize:      FontSizes.xl,
    fontWeight:    '800',
    color:         Colors.text,
    letterSpacing: -0.5,
  },

  hero: {
    alignItems:    'center',
    paddingTop:    Spacing.xxl,
    paddingBottom: Spacing.md,
    gap:           12,
  },
  avatar: {
    width:          AVATAR_SIZE,
    height:         AVATAR_SIZE,
    borderRadius:   AVATAR_SIZE / 2,
    alignItems:     'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize:   36,
    fontWeight: '800',
    color:      '#fff',
  },
  displayName: {
    fontSize:      FontSizes.xl,
    fontWeight:    '800',
    color:         Colors.text,
    letterSpacing: -0.5,
    textAlign:     'center',
  },
  guestBadge: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.10)',
    borderRadius:    Radius.full,
    paddingHorizontal: 10,
    paddingVertical:   4,
  },
  guestBadgeText: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         Colors.muted,
    letterSpacing: 0.6,
  },
  cityLabel: {
    fontSize: FontSizes.sm,
    color:    Colors.muted2,
  },
  note: {
    textAlign:         'center',
    fontSize:          FontSizes.sm,
    color:             Colors.muted2,
    opacity:           0.6,
    paddingHorizontal: Spacing.xl,
    marginTop:         Spacing.sm,
  },
});
