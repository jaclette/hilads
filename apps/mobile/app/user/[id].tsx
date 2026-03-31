/**
 * Public profile screen — /user/[id]
 *
 * Web parity: PublicProfileScreen.jsx
 * Shows: avatar, display name, member badge, home city, age, interests,
 *        events the user is going to, events the user created.
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
import { fetchPublicProfile, fetchUserEvents } from '@/api/users';
import { useApp } from '@/context/AppContext';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { User, HiladsEvent } from '@/types';

// ── Badge helpers ─────────────────────────────────────────────────────────────

const PROFILE_BADGE_BG: Record<string, object> = {
  ghost: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.10)' },
  fresh: { backgroundColor: 'rgba(74,222,128,0.12)',  borderColor: 'rgba(74,222,128,0.22)'  },
  regular: { backgroundColor: 'rgba(96,165,250,0.12)',  borderColor: 'rgba(96,165,250,0.22)'  },
  local: { backgroundColor: 'rgba(52,211,153,0.12)',  borderColor: 'rgba(52,211,153,0.22)'  },
  host:  { backgroundColor: 'rgba(251,191,36,0.15)',  borderColor: 'rgba(251,191,36,0.28)'  },
};
const PROFILE_BADGE_COLOR: Record<string, object> = {
  ghost: { color: '#666' },
  fresh: { color: '#4ade80' },
  regular: { color: '#60a5fa' },
  local: { color: '#34d399' },
  host:  { color: '#fbbf24' },
};
function profileBadgeBg(key: string): object {
  return PROFILE_BADGE_BG[key] ?? PROFILE_BADGE_BG.regular;
}
function profileBadgeColor(key: string): object {
  return PROFILE_BADGE_COLOR[key] ?? PROFILE_BADGE_COLOR.regular;
}

// ── Avatar gradient palette — mirrors web PublicProfileScreen.jsx ─────────────

const AVATAR_BG = [
  '#7c6aff', '#ff6a9f', '#22d3ee', '#4ade80',
  '#fb923c', '#f472b6', '#818cf8', '#2dd4bf',
];

function avatarBg(name: string): string {
  const hash = (name ?? '?').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_BG[hash % AVATAR_BG.length];
}

// ── Event helpers — mirrors hot.tsx ───────────────────────────────────────────

const EVENT_ICONS: Record<string, string> = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
};

function formatEventTime(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (d.toDateString() === today.toDateString()) return `Today · ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow · ${time}`;
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ` · ${time}`;
}

// ── Event pill — compact card for profile events list ─────────────────────────

function EventPill({
  event,
  onPress,
}: {
  event: HiladsEvent;
  onPress: () => void;
}) {
  const icon = EVENT_ICONS[event.event_type] ?? '📌';
  const now  = Date.now() / 1000;
  const isLive = event.starts_at <= now && event.expires_at > now;

  return (
    <TouchableOpacity style={styles.eventPill} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.eventIcon}>{icon}</Text>
      <View style={styles.eventInfo}>
        <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
        <View style={styles.eventMeta}>
          {isLive && (
            <View style={styles.liveBadge}>
              <Text style={styles.liveBadgeText}>LIVE</Text>
            </View>
          )}
          <Text style={styles.eventTime}>{formatEventTime(event.starts_at)}</Text>
          {event.location_hint ? (
            <Text style={styles.eventLocation} numberOfLines={1}>· {event.location_hint}</Text>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
    </TouchableOpacity>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function PublicProfileScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { account } = useApp();

  const [user,         setUser]         = useState<User | null>(null);
  const [events,       setEvents]       = useState<HiladsEvent[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      fetchPublicProfile(id),
      fetchUserEvents(id),
    ])
      .then(([u, evs]) => {
        setUser(u);
        setEvents(evs);
      })
      .catch(() => setError('Could not load profile.'))
      .finally(() => setLoading(false));
  }, [id]);

  const name    = user?.display_name ?? '?';
  const initial = name[0].toUpperCase();
  const bg      = avatarBg(name);
  const isSelf  = account?.id === id;

  // Split events: created by this user vs joined-but-not-created
  const createdEvents = events.filter(e => e.created_by === id);
  const goingEvents   = events.filter(e => e.created_by !== id);

  function handleDm() {
    if (!user?.id) return;
    router.push({
      pathname: '/dm/[id]',
      params: { id: user.id, name: user.display_name },
    });
  }

  function handleEventPress(eventId: string) {
    router.push({
      pathname: '/event/[id]',
      params: { id: eventId },
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
          {/* ── Hero: avatar + name + identity badge ── */}
          <View style={styles.hero}>
            {user.profile_photo_url ? (
              <Image source={{ uri: user.profile_photo_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: bg }]}>
                <Text style={styles.avatarInitial}>{initial}</Text>
              </View>
            )}
            <Text style={styles.displayName}>{name}</Text>
            {user.primaryBadge && (
              <View style={[styles.memberBadge, profileBadgeBg(user.primaryBadge.key)]}>
                <Text style={[styles.memberBadgeText, profileBadgeColor(user.primaryBadge.key)]}>
                  {user.primaryBadge.label}
                </Text>
              </View>
            )}
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
            <View style={styles.section}>
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

          {/* ── Events going to (joined but not created) ── */}
          {goingEvents.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Going to</Text>
              <View style={styles.eventList}>
                {goingEvents.slice(0, 5).map(event => (
                  <EventPill
                    key={event.id}
                    event={event}
                    onPress={() => handleEventPress(event.id)}
                  />
                ))}
              </View>
            </View>
          )}

          {/* ── Events created ── */}
          {createdEvents.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Created</Text>
              <View style={styles.eventList}>
                {createdEvents.slice(0, 5).map(event => (
                  <EventPill
                    key={event.id}
                    event={event}
                    onPress={() => handleEventPress(event.id)}
                  />
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
    padding:       Spacing.md,
    gap:           Spacing.md,
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
  detailRowFirst: { borderTopWidth: 0 },
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

  // ── Sections (interests, events) ──────────────────────────────────────────
  section: { gap: Spacing.sm },
  sectionLabel: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         Colors.muted,
    letterSpacing: 1.0,
    textTransform: 'uppercase',
  },

  // ── Interests ─────────────────────────────────────────────────────────────
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

  // ── Event list ────────────────────────────────────────────────────────────
  eventList: { gap: Spacing.xs },
  eventPill: {
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   Colors.bg2,
    borderRadius:      Radius.lg,
    borderWidth:       1,
    borderColor:       Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm + 2,
    gap:               Spacing.sm,
  },
  eventIcon:  { fontSize: 20 },
  eventInfo:  { flex: 1, gap: 2 },
  eventTitle: {
    fontSize:   FontSizes.sm,
    fontWeight: '700',
    color:      Colors.text,
  },
  eventMeta: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
    flexWrap:      'wrap',
  },
  eventTime: {
    fontSize: FontSizes.xs,
    color:    Colors.muted,
  },
  eventLocation: {
    fontSize:    FontSizes.xs,
    color:       Colors.muted,
    flexShrink:  1,
  },
  liveBadge: {
    backgroundColor:   'rgba(61,220,132,0.12)',
    borderRadius:      Radius.full,
    paddingHorizontal: 6,
    paddingVertical:   1,
    borderWidth:       1,
    borderColor:       'rgba(61,220,132,0.25)',
  },
  liveBadgeText: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         Colors.green,
    letterSpacing: 0.4,
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
