/**
 * Notifications preview screen — latest 5 notifications + preferences.
 *
 * Fetches only 5 notifications server-side (limit=5).
 * "See all notifications" navigates to /notifications-history for the full list.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Switch,
  ActivityIndicator, StyleSheet, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { canAccessProfile } from '@/lib/profileAccess';
import {
  fetchNotifications, markNotificationsRead,
  fetchNotificationPreferences, updateNotificationPreferences,
  type NotificationPreferences,
} from '@/api/notifications';
import { socket } from '@/lib/socket';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { Notification } from '@/types';
import { NotifRow, NotifSeparator } from '@/features/notifications/NotifRow';

const PREVIEW_LIMIT = 5;

// ── Preference toggle row ─────────────────────────────────────────────────────

function PrefRow({
  label,
  subtitle,
  value,
  onChange,
}: {
  label: string;
  subtitle: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.prefRow}>
      <View style={styles.prefText}>
        <Text style={styles.prefLabel}>{label}</Text>
        <Text style={styles.prefSub}>{subtitle}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: Colors.bg3, true: Colors.accent }}
        thumbColor={Colors.white}
        ios_backgroundColor={Colors.bg3}
      />
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function NotificationsScreen() {
  const router = useRouter();
  const { account, setUnreadNotifications } = useApp();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading,       setLoading]       = useState(true);
  const notifRef = useRef(notifications);
  notifRef.current = notifications;

  const [prefs, setPrefs] = useState<NotificationPreferences>({
    dm_push:              true,
    event_message_push:   true,
    event_join_push:      false,
    new_event_push:       false,
    channel_message_push: false,
    city_join_push:       false,
    friend_added_push:    true,
    vibe_received_push:   true,
    profile_view_push:    true,
  });

  // ── Load latest 5 notifications + preferences ─────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ notifications: list }, loadedPrefs] = await Promise.all([
        fetchNotifications(PREVIEW_LIMIT),
        fetchNotificationPreferences().catch(() => null),
      ]);
      setNotifications(list);
      if (loadedPrefs) setPrefs(loadedPrefs);
      setUnreadNotifications(list.filter(n => !n.is_read).length);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [setUnreadNotifications]);

  useEffect(() => { load(); }, [load]);

  // ── Preference toggle ─────────────────────────────────────────────────────

  const togglePref = useCallback((key: keyof NotificationPreferences, value: boolean) => {
    const updated = { ...prefs, [key]: value };
    setPrefs(updated);
    updateNotificationPreferences({ [key]: value }).catch(() => setPrefs(prefs));
  }, [prefs]);

  // ── Realtime: new notification via WS ────────────────────────────────────

  useEffect(() => {
    function handler(data: Record<string, unknown>) {
      const notif = data as unknown as Notification;
      if (!notif?.id) return;
      setNotifications(prev => {
        if (prev.some(n => n.id === notif.id)) return prev;
        // Prepend and keep only PREVIEW_LIMIT items in the preview
        return [notif, ...prev].slice(0, PREVIEW_LIMIT);
      });
      setUnreadNotifications(prev => prev + 1);
    }
    const off1 = socket.on('notification',    handler);
    const off2 = socket.on('newNotification', handler);
    return () => { off1(); off2(); };
  }, [setUnreadNotifications]);

  // ── Mark all read ─────────────────────────────────────────────────────────

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    setUnreadNotifications(0);
    markNotificationsRead();
  }, [setUnreadNotifications]);

  // ── Tap a notification — mark read + navigate ─────────────────────────────

  const handleTap = useCallback((notif: Notification) => {
    if (!notif.is_read) {
      setNotifications(prev =>
        prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n),
      );
      setUnreadNotifications(Math.max(0,
        notifRef.current.filter(n => !n.is_read).length - 1,
      ));
      markNotificationsRead([notif.id]);
    }
    if (notif.data?.conversationId) {
      router.push(`/dm/${notif.data.conversationId}` as never);
    } else if (notif.data?.eventId) {
      router.push(`/event/${notif.data.eventId}` as never);
    } else if (notif.type === 'channel_message' || notif.type === 'city_join') {
      router.push('/(tabs)/chat' as never);
    } else if (notif.type === 'friend_added' && notif.data?.senderUserId) {
      if (canAccessProfile(account)) router.push(`/user/${notif.data.senderUserId}` as never);
    } else if (notif.type === 'vibe_received') {
      router.push('/(tabs)/me' as never);
    } else if (notif.type === 'profile_view' && notif.data?.viewerId) {
      if (canAccessProfile(account)) router.push(`/user/${notif.data.viewerId}` as never);
    }
  }, [router, account, setUnreadNotifications]);

  const hasUnread = notifications.some(n => !n.is_read);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Feather name="chevron-left" size={22} color={Colors.text} />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Notifications</Text>

        {hasUnread ? (
          <TouchableOpacity onPress={markAllRead} activeOpacity={0.7} style={styles.markReadBtn}>
            <Text style={styles.markReadText}>Mark all read</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.markReadBtn} />
        )}
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Latest notifications (preview) ───────────────────────────── */}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : notifications.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyIcon}>🔔</Text>
            <Text style={styles.emptyTitle}>No notifications yet</Text>
            <Text style={styles.emptySub}>You'll see messages and event updates here.</Text>
          </View>
        ) : (
          <View style={styles.notifList}>
            {notifications.map((n, i) => (
              <View key={n.id}>
                <NotifRow notif={n} onPress={() => handleTap(n)} />
                {i < notifications.length - 1 && <NotifSeparator />}
              </View>
            ))}
          </View>
        )}

        {/* ── See all CTA ──────────────────────────────────────────────── */}
        {!loading && (
          <TouchableOpacity
            style={styles.seeAllBtn}
            onPress={() => router.push('/notifications-history' as never)}
            activeOpacity={0.75}
          >
            <Text style={styles.seeAllText}>See all notifications</Text>
            <Feather name="chevron-right" size={16} color={Colors.accent} />
          </TouchableOpacity>
        )}

        {/* ── Notification Preferences ─────────────────────────────────── */}
        <View style={styles.prefSection}>
          <Text style={styles.prefSectionTitle}>NOTIFICATION PREFERENCES</Text>

          <View style={styles.prefCard}>
            <PrefRow label="New direct messages" subtitle="When someone sends you a private message" value={prefs.dm_push} onChange={v => togglePref('dm_push', v)} />
            <View style={styles.prefDivider} />
            <PrefRow label="Event chat messages" subtitle="When someone messages in an event you joined" value={prefs.event_message_push} onChange={v => togglePref('event_message_push', v)} />
            <View style={styles.prefDivider} />
            <PrefRow label="Someone joined your event" subtitle="When a new person joins an event you're going to" value={prefs.event_join_push} onChange={v => togglePref('event_join_push', v)} />
            <View style={styles.prefDivider} />
            <PrefRow label="New events in your city" subtitle="When someone creates an event in your city" value={prefs.new_event_push} onChange={v => togglePref('new_event_push', v)} />
            <View style={styles.prefDivider} />
            <PrefRow label="City chat messages" subtitle="When someone sends a message in your city channel" value={prefs.channel_message_push} onChange={v => togglePref('channel_message_push', v)} />
            <View style={styles.prefDivider} />
            <PrefRow label="Someone arrived in your city" subtitle="When a registered user joins the city channel you're in" value={prefs.city_join_push} onChange={v => togglePref('city_join_push', v)} />
            <View style={styles.prefDivider} />
            <PrefRow label="Friend requests" subtitle="When someone adds you as a friend" value={prefs.friend_added_push} onChange={v => togglePref('friend_added_push', v)} />
            <View style={styles.prefDivider} />
            <PrefRow label="Vibes ✨" subtitle="When someone leaves a vibe on your profile" value={prefs.vibe_received_push} onChange={v => togglePref('vibe_received_push', v)} />
            <View style={styles.prefDivider} />
            <PrefRow label="Profile views 👀" subtitle="When someone checks your profile" value={prefs.profile_view_push} onChange={v => togglePref('profile_view_push', v)} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: Colors.bg },
  flex:          { flex: 1 },
  scrollContent: { paddingBottom: Spacing.xxl },

  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width:           40,
    height:          40,
    borderRadius:    12,
    backgroundColor: Colors.bg2,
    borderWidth:     1,
    borderColor:     Colors.border,
    alignItems:      'center',
    justifyContent:  'center',
  },
  headerTitle: {
    flex:          1,
    textAlign:     'center',
    fontSize:      FontSizes.lg,
    fontWeight:    '800',
    color:         Colors.text,
    letterSpacing: -0.4,
  },
  markReadBtn: {
    width:          80,
    alignItems:     'flex-end',
    justifyContent: 'center',
  },
  markReadText: {
    fontSize:   FontSizes.sm,
    fontWeight: '600',
    color:      Colors.accent,
  },

  notifList: { paddingTop: Spacing.xs },

  // ── See all CTA ────────────────────────────────────────────────────────────
  seeAllBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               6,
    marginHorizontal:  Spacing.md,
    marginTop:         Spacing.sm,
    marginBottom:      Spacing.xs,
    paddingVertical:   Spacing.md,
    borderRadius:      Radius.lg,
    borderWidth:       1,
    borderColor:       Colors.border,
    backgroundColor:   Colors.bg2,
  },
  seeAllText: {
    fontSize:   FontSizes.sm,
    fontWeight: '600',
    color:      Colors.accent,
  },

  // ── Empty state ────────────────────────────────────────────────────────────
  center:     { paddingVertical: Spacing.xxl, alignItems: 'center' },
  emptyWrap:  { paddingVertical: Spacing.xxl, alignItems: 'center', gap: Spacing.sm },
  emptyIcon:  { fontSize: 40, marginBottom: Spacing.sm },
  emptyTitle: { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
  emptySub:   { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center', lineHeight: 20, paddingHorizontal: Spacing.xl },

  // ── Preferences ────────────────────────────────────────────────────────────
  prefSection: {
    marginTop:         Spacing.xl,
    paddingHorizontal: Spacing.md,
  },
  prefSectionTitle: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         Colors.muted2,
    letterSpacing: 0.8,
    marginBottom:  Spacing.sm,
  },
  prefCard: {
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     Colors.border,
    overflow:        'hidden',
  },
  prefRow: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    gap:               Spacing.md,
  },
  prefText:  { flex: 1, gap: 3 },
  prefLabel: { fontSize: FontSizes.md, fontWeight: '600', color: Colors.text },
  prefSub:   { fontSize: FontSizes.xs, color: Colors.muted, lineHeight: 17 },
  prefDivider: {
    height:           1,
    backgroundColor:  Colors.border,
    marginHorizontal: Spacing.md,
  },
});
