/**
 * Public profile screen — /user/[id]
 *
 * Web parity: PublicProfileScreen.jsx
 * Shows: avatar, display name, member badge, home city, age, interests.
 * DM button at the bottom for registered non-self users.
 */

import { useState, useEffect } from 'react';
import {
  View, Text, Image, ScrollView, TouchableOpacity,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons, Feather } from '@expo/vector-icons';
import { fetchPublicProfile } from '@/api/users';
import { useApp } from '@/context/AppContext';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { User } from '@/types';

// ── Avatar gradient palette — mirrors web PublicProfileScreen.jsx ─────────────

const AVATAR_BG = [
  '#7c6aff', '#ff6a9f', '#22d3ee', '#4ade80',
  '#fb923c', '#f472b6', '#818cf8', '#2dd4bf',
];

function avatarBg(name: string): string {
  const hash = (name ?? '?').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_BG[hash % AVATAR_BG.length];
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function PublicProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { account } = useApp();

  const [user,    setUser]    = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchPublicProfile(id)
      .then(u => setUser(u))
      .catch(() => setError('Could not load profile.'))
      .finally(() => setLoading(false));
  }, [id]);

  const name    = user?.display_name ?? '?';
  const initial = name[0].toUpperCase();
  const bg      = avatarBg(name);
  const isSelf  = account?.id === id;

  function handleDm() {
    if (!user?.id) return;
    router.push({
      pathname: '/dm/[id]',
      params: { id: user.id, name: user.display_name },
    });
  }

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

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => router.back()} activeOpacity={0.8}>
            <Text style={styles.retryBtnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      ) : user ? (
        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Hero: avatar + name + member badge ── */}
          <View style={styles.hero}>
            {user.profile_photo_url ? (
              <Image source={{ uri: user.profile_photo_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: bg }]}>
                <Text style={styles.avatarInitial}>{initial}</Text>
              </View>
            )}
            <Text style={styles.displayName}>{name}</Text>
            <View style={styles.memberBadge}>
              <Text style={styles.memberBadgeText}>MEMBER</Text>
            </View>
          </View>

          {/* ── Details: home city + age ── */}
          {(user.home_city || user.age != null) && (
            <View style={styles.detailsCard}>
              {user.home_city ? (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>From</Text>
                  <Text style={styles.detailValue}>{user.home_city}</Text>
                </View>
              ) : null}
              {user.age != null ? (
                <View style={[styles.detailRow, !user.home_city && styles.detailRowFirst]}>
                  <Text style={styles.detailLabel}>Age</Text>
                  <Text style={styles.detailValue}>{user.age}</Text>
                </View>
              ) : null}
            </View>
          )}

          {/* ── Interests — read-only chips ── */}
          {(user.interests?.length ?? 0) > 0 && (
            <View style={styles.interestsSection}>
              <Text style={styles.sectionLabel}>Interests</Text>
              <View style={styles.interestsWrap}>
                {(user.interests ?? []).map(interest => (
                  <View key={interest} style={styles.chip}>
                    <Text style={styles.chipText}>{interest}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ── DM button — registered non-self viewers only ── */}
          {!isSelf && account && (
            <TouchableOpacity style={styles.dmBtn} onPress={handleDm} activeOpacity={0.85}>
              <Feather name="message-square" size={20} color={Colors.white} />
              <Text style={styles.dmBtnText}>Send a message</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const AVATAR_SIZE = 88;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  // ── Header ────────────────────────────────────────────────────────────────
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

  // ── States ────────────────────────────────────────────────────────────────
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  errorText: {
    color:     Colors.muted,
    fontSize:  FontSizes.sm,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
  },
  retryBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    backgroundColor:   Colors.bg2,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       Colors.border,
  },
  retryBtnText: { color: Colors.text, fontSize: FontSizes.sm, fontWeight: '600' },

  // ── Body ──────────────────────────────────────────────────────────────────
  body: {
    padding:   Spacing.md,
    gap:       Spacing.md,
    paddingBottom: Spacing.xxl,
  },

  // ── Hero ──────────────────────────────────────────────────────────────────
  hero: {
    alignItems:    'center',
    paddingTop:    Spacing.lg,
    paddingBottom: Spacing.md,
    gap:           10,
  },
  avatar: {
    width:        AVATAR_SIZE,
    height:       AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatarFallback: {
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
  memberBadge: {
    backgroundColor:   'rgba(139,92,246,0.15)',
    borderRadius:      Radius.full,
    paddingHorizontal: 10,
    paddingVertical:   4,
    borderWidth:       1,
    borderColor:       'rgba(139,92,246,0.25)',
  },
  memberBadgeText: {
    color:         Colors.violet,
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    letterSpacing: 0.6,
  },

  // ── Details card ─────────────────────────────────────────────────────────
  detailsCard: {
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     Colors.border,
    overflow:        'hidden',
  },
  detailRow: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical:   14,
    borderTopWidth:    1,
    borderTopColor:    Colors.border,
  },
  detailRowFirst: {
    borderTopWidth: 0,
  },
  detailLabel: {
    fontSize:   FontSizes.sm,
    color:      Colors.muted,
    fontWeight: '500',
  },
  detailValue: {
    fontSize:   FontSizes.sm,
    color:      Colors.text,
    fontWeight: '600',
  },

  // ── Interests ─────────────────────────────────────────────────────────────
  interestsSection: { gap: Spacing.sm },
  sectionLabel: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         Colors.muted,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
  },
  interestsWrap: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           8,
  },
  chip: {
    backgroundColor:   Colors.bg2,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       'rgba(139,92,246,0.35)',
    paddingHorizontal: 14,
    paddingVertical:   7,
  },
  chipText: {
    fontSize:   FontSizes.sm,
    color:      Colors.violet,
    fontWeight: '600',
  },

  // ── DM button ─────────────────────────────────────────────────────────────
  dmBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               10,
    marginTop:         Spacing.sm,
    paddingVertical:   16,
    backgroundColor:   Colors.accent2,
    borderRadius:      Radius.lg,
    shadowColor:       Colors.accent2,
    shadowOffset:      { width: 0, height: 4 },
    shadowOpacity:     0.35,
    shadowRadius:      10,
    elevation:         6,
  },
  dmBtnText: {
    fontSize:   FontSizes.md,
    fontWeight: '700',
    color:      Colors.white,
  },
});
