import { useState, useRef } from 'react';
import {
  View, Text, Image, FlatList, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { useMyEvents } from '@/hooks/useMyEvents';
import { Colors, FontSizes, Spacing, Radius, APP_VERSION } from '@/constants';
import type { HiladsEvent } from '@/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const EVENT_ICONS: Record<string, string> = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
};

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── My Event row ──────────────────────────────────────────────────────────────

function MyEventRow({ event, onPress }: { event: HiladsEvent; onPress: () => void }) {
  const now    = Date.now() / 1000;
  const isLive = event.starts_at <= now && event.expires_at > now;
  const icon   = EVENT_ICONS[event.event_type] ?? '📌';

  return (
    <TouchableOpacity style={styles.eventRow} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.eventIcon}>{icon}</Text>
      <View style={styles.eventInfo}>
        <View style={styles.eventTitleRow}>
          <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
          {isLive && (
            <View style={styles.livePill}>
              <Text style={styles.livePillText}>Live</Text>
            </View>
          )}
          {event.recurrence_label && (
            <View style={styles.recurPill}>
              <Text style={styles.recurPillText}>↻</Text>
            </View>
          )}
        </View>
        <Text style={styles.eventMeta}>
          {formatTime(event.starts_at)}
          {event.location ? ` · ${event.location}` : ''}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function MeScreen() {
  const router = useRouter();
  const { identity, account, city, wsConnected, logout } = useApp();
  const { events, loading: eventsLoading } = useMyEvents();
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleVersionTap() {
    tapCount.current += 1;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => { tapCount.current = 0; }, 2000);
    if (tapCount.current >= 5) {
      tapCount.current = 0;
      router.push('/debug');
    }
  }

  const displayName = account?.display_name ?? identity?.nickname ?? '—';
  const initials    = displayName.slice(0, 2).toUpperCase();
  const isGuest     = !account;

  function handleLogout() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => logout(),
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>👤 Me</Text>
          {!isGuest && (
            <TouchableOpacity onPress={handleLogout} activeOpacity={0.7}>
              <Text style={styles.logoutBtn}>Sign out</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Avatar + identity */}
        <View style={styles.avatarSection}>
          {account?.profile_photo_url ? (
            <Image source={{ uri: account.profile_photo_url }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          )}
          <Text style={styles.displayName}>{displayName}</Text>
          <Text style={styles.accountType}>
            {isGuest ? 'Guest session' : 'Registered account'}
          </Text>
        </View>

        {/* Registered profile details */}
        {account && (
          <View style={styles.card}>
            {account.home_city && (
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Home city</Text>
                <Text style={styles.cardValue}>{account.home_city}</Text>
              </View>
            )}
            {account.age != null && (
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Age</Text>
                <Text style={styles.cardValue}>{account.age}</Text>
              </View>
            )}
            {account.email && (
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>Email</Text>
                <Text style={[styles.cardValue, styles.muted]}>{account.email}</Text>
              </View>
            )}
            {account.interests && account.interests.length > 0 && (
              <View style={[styles.cardRow, styles.cardRowLast]}>
                <Text style={styles.cardLabel}>Interests</Text>
                <Text style={styles.cardValue}>{account.interests.join(', ')}</Text>
              </View>
            )}
            {!account.home_city && !account.age && !account.interests?.length && (
              <View style={[styles.cardRow, styles.cardRowLast]}>
                <Text style={styles.cardLabel}>Profile</Text>
                <Text style={styles.muted}>Edit coming soon</Text>
              </View>
            )}
          </View>
        )}

        {/* Connection status */}
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>City</Text>
            <Text style={styles.cardValue}>{city?.name ?? 'Not detected'}</Text>
          </View>
          <View style={[styles.cardRow, styles.cardRowLast]}>
            <Text style={styles.cardLabel}>Connection</Text>
            <View style={styles.connRow}>
              <View style={[styles.connDot, wsConnected ? styles.connOn : styles.connOff]} />
              <Text style={styles.cardValue}>{wsConnected ? 'Live' : 'Offline'}</Text>
            </View>
          </View>
        </View>

        {/* My Events */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>My Events</Text>

          {eventsLoading ? (
            <ActivityIndicator color={Colors.muted} style={{ marginVertical: Spacing.md }} />
          ) : events.length === 0 ? (
            <Text style={styles.emptyText}>No events yet. Create one from the Hot tab.</Text>
          ) : (
            <View style={styles.card}>
              {events.map((e, idx) => (
                <View key={e.id}>
                  {idx > 0 && <View style={styles.divider} />}
                  <MyEventRow event={e} onPress={() => router.push(`/event/${e.id}`)} />
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Guest upgrade CTA */}
        {isGuest && (
          <View style={styles.upgradeCard}>
            <Text style={styles.upgradeTitle}>Create a free account</Text>
            <Text style={styles.upgradeSubtitle}>
              Keep your events, access DMs, and stay connected across sessions.
            </Text>
            <View style={styles.upgradeButtons}>
              <TouchableOpacity
                style={styles.upgradePrimary}
                onPress={() => router.push('/sign-up')}
                activeOpacity={0.85}
              >
                <Text style={styles.upgradePrimaryText}>Create account</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.upgradeSecondary}
                onPress={() => router.push('/sign-in')}
                activeOpacity={0.8}
              >
                <Text style={styles.upgradeSecondaryText}>Sign in</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Version — tap 5 times to open debug panel */}
        <TouchableOpacity onPress={handleVersionTap} activeOpacity={1} style={styles.versionWrap}>
          <Text style={styles.version}>v{APP_VERSION}</Text>
        </TouchableOpacity>

        <View style={{ height: Spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  header: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSizes.lg, fontWeight: '700', color: Colors.text },
  logoutBtn:   { fontSize: FontSizes.sm, color: Colors.muted, fontWeight: '500' },

  avatarSection: { alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.sm },
  avatar: {
    width: 72, height: 72, borderRadius: Radius.full,
    borderWidth: 2, borderColor: Colors.accent,
  },
  avatarFallback: {
    width: 72, height: 72, borderRadius: Radius.full,
    backgroundColor: Colors.bg3, borderWidth: 2, borderColor: Colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText:   { fontSize: FontSizes.xl, fontWeight: '700', color: Colors.accent },
  displayName:  { fontSize: FontSizes.lg, fontWeight: '600', color: Colors.text },
  accountType:  { fontSize: FontSizes.sm, color: Colors.muted },

  card: {
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     Colors.border,
    marginHorizontal: Spacing.md,
    marginBottom:    Spacing.md,
    overflow:        'hidden',
  },
  cardRow: {
    flexDirection:     'row',
    justifyContent:    'space-between',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  cardRowLast:  { borderBottomWidth: 0 },
  cardLabel:    { fontSize: FontSizes.sm, color: Colors.muted },
  cardValue:    { fontSize: FontSizes.sm, color: Colors.text, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
  muted:        { color: Colors.muted },
  connRow:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  connDot:      { width: 8, height: 8, borderRadius: 4 },
  connOn:       { backgroundColor: Colors.green },
  connOff:      { backgroundColor: Colors.muted2 },

  section: { paddingHorizontal: 0, marginBottom: Spacing.sm },
  sectionTitle: {
    fontSize:          FontSizes.sm,
    fontWeight:        '700',
    color:             Colors.muted,
    textTransform:     'uppercase',
    letterSpacing:     0.8,
    paddingHorizontal: Spacing.md,
    marginBottom:      Spacing.sm,
  },
  emptyText: {
    fontSize:          FontSizes.sm,
    color:             Colors.muted,
    paddingHorizontal: Spacing.md,
    marginBottom:      Spacing.md,
  },
  divider: { height: 1, backgroundColor: Colors.border, marginHorizontal: Spacing.md },
  eventRow: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    gap:               Spacing.sm,
  },
  eventIcon:  { fontSize: 18 },
  eventInfo:  { flex: 1, gap: 2 },
  eventTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  eventTitle: { fontSize: FontSizes.sm, fontWeight: '600', color: Colors.text, flexShrink: 1 },
  eventMeta:  { fontSize: FontSizes.xs, color: Colors.muted },
  chevron:    { fontSize: FontSizes.lg, color: Colors.muted2 },
  livePill: {
    backgroundColor: 'rgba(255,122,60,0.18)', borderRadius: Radius.full,
    paddingHorizontal: 6, paddingVertical: 1,
  },
  livePillText: { color: Colors.accent, fontSize: FontSizes.xs, fontWeight: '700' },
  recurPill: {
    backgroundColor: 'rgba(167,139,250,0.15)', borderRadius: Radius.full,
    paddingHorizontal: 6, paddingVertical: 1,
  },
  recurPillText: { color: Colors.violet, fontSize: FontSizes.xs, fontWeight: '600' },

  upgradeCard: {
    margin:          Spacing.md,
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     Colors.border,
    padding:         Spacing.md,
    gap:             Spacing.sm,
  },
  upgradeTitle:    { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
  upgradeSubtitle: { fontSize: FontSizes.sm, color: Colors.muted, lineHeight: 20 },
  upgradeButtons:  { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  upgradePrimary: {
    flex: 1, backgroundColor: Colors.accent, borderRadius: Radius.lg,
    paddingVertical: Spacing.sm, alignItems: 'center',
  },
  upgradePrimaryText:   { color: Colors.white, fontWeight: '700', fontSize: FontSizes.sm },
  upgradeSecondary: {
    flex: 1, borderRadius: Radius.lg, paddingVertical: Spacing.sm,
    alignItems: 'center', borderWidth: 1, borderColor: Colors.border,
  },
  upgradeSecondaryText: { color: Colors.text, fontWeight: '600', fontSize: FontSizes.sm },

  versionWrap: { alignItems: 'center', paddingVertical: Spacing.md },
  version:     { fontSize: FontSizes.xs, color: Colors.muted2 },
});
