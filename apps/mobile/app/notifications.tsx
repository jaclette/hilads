/**
 * Notifications screen — matches web app UX exactly.
 *
 * Sections:
 *   1. Notifications list (from API + real-time WS)
 *   2. Notification Preferences (local toggles)
 *
 * Web parity: back button, centered title, "Mark all read" CTA,
 * orange left accent for unread, dimmed text for read items,
 * unread dot on right, preference toggles with orange thumb.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Switch,
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

// ── Relative time — same helper as messages screen ────────────────────────────

function relativeTime(raw?: string | null): string {
  if (!raw) return '';
  let ms = Date.parse(raw);
  if (isNaN(ms)) {
    const n = Number(raw);
    if (!isNaN(n)) ms = n < 1e10 ? n * 1000 : n;
  }
  if (isNaN(ms)) return '';
  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 60)   return 'now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

// ── Notification icon — keyed by type ────────────────────────────────────────

function NotifIcon({ type, unread }: { type: Notification['type']; unread: boolean }) {
  const iconName: React.ComponentProps<typeof Feather>['name'] =
    type === 'dm_message'      ? 'message-circle' :
    type === 'event_message'   ? 'message-square' :
    type === 'event_join'      ? 'users'           :
    type === 'new_event'       ? 'zap'             :
    type === 'channel_message' ? 'hash'            :
    type === 'city_join'       ? 'user-plus'       :
    type === 'friend_added'    ? 'user-plus'       :
    type === 'vibe_received'   ? 'star'            :
    /* fallback */               'bell';

  const color = unread ? Colors.white : Colors.muted;
  const bg    = unread ? 'rgba(255,122,60,0.15)' : Colors.bg3;
  const border = unread ? 'rgba(255,122,60,0.3)' : Colors.border;

  return (
    <View style={[styles.notifIcon, { backgroundColor: bg, borderColor: border }]}>
      <Feather name={iconName} size={20} color={color} />
    </View>
  );
}

// ── Notification row ──────────────────────────────────────────────────────────

function NotifRow({ notif, onPress }: { notif: Notification; onPress: () => void }) {
  const unread = !notif.is_read;
  const time   = relativeTime(notif.created_at);

  return (
    <TouchableOpacity
      style={[styles.notifRow, unread && styles.notifRowUnread]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Left accent bar for unread */}
      {unread && <View style={styles.accentBar} />}

      <NotifIcon type={notif.type} unread={unread} />

      {/* Content */}
      <View style={styles.notifBody}>
        <Text style={[styles.notifTitle, !unread && styles.notifTitleRead]} numberOfLines={2}>
          {notif.title}
        </Text>
        {notif.body ? (
          <Text style={[styles.notifPreview, !unread && styles.notifPreviewRead]} numberOfLines={1}>
            {notif.body}
          </Text>
        ) : null}
        {time ? <Text style={styles.notifTime}>{time}</Text> : null}
      </View>

      {/* Unread dot */}
      {unread && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );
}

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

  // Preferences — loaded from backend, saved on toggle
  const [prefs, setPrefs] = useState<NotificationPreferences>({
    dm_push:              true,
    event_message_push:   true,
    event_join_push:      false,
    new_event_push:       false,
    channel_message_push: false,
    city_join_push:       false,
    friend_added_push:    true,
    vibe_received_push:   true,
  });

  // ── Load notifications + preferences ─────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ notifications: list }, loadedPrefs] = await Promise.all([
        fetchNotifications(),
        fetchNotificationPreferences().catch(() => null),
      ]);
      setNotifications(list);
      if (loadedPrefs) setPrefs(loadedPrefs);
      // Clear badge — user has opened this screen
      const unread = list.filter(n => !n.is_read).length;
      setUnreadNotifications(unread);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [setUnreadNotifications]);

  useEffect(() => { load(); }, [load]);

  // ── Toggle a preference and sync to backend ───────────────────────────────

  const togglePref = useCallback((key: keyof NotificationPreferences, value: boolean) => {
    const updated = { ...prefs, [key]: value };
    setPrefs(updated);
    updateNotificationPreferences({ [key]: value }).catch(() => {
      // Revert on failure
      setPrefs(prefs);
    });
  }, [prefs]);

  // ── Realtime: new notification via WS ────────────────────────────────────

  useEffect(() => {
    function handler(data: Record<string, unknown>) {
      const notif = data as unknown as Notification;
      if (!notif?.id) return;
      setNotifications(prev => {
        if (prev.some(n => n.id === notif.id)) return prev;
        return [notif, ...prev];
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

  // ── Tap a notification — mark it read + navigate ──────────────────────────

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
    // Navigate to relevant screen
    if (notif.data?.conversationId) {
      router.push(`/dm/${notif.data.conversationId}` as never);
    } else if (notif.data?.eventId) {
      router.push(`/event/${notif.data.eventId}` as never);
    } else if (notif.type === 'channel_message' || notif.type === 'city_join') {
      router.push('/(tabs)/chat' as never);
    } else if (notif.type === 'friend_added' && notif.data?.senderUserId) {
      if (canAccessProfile(account)) {
        router.push(`/user/${notif.data.senderUserId}` as never);
      }
    } else if (notif.type === 'vibe_received') {
      router.push('/(tabs)/me' as never);
    }
  }, [router, setUnreadNotifications]);

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
        {/* ── Notifications list ───────────────────────────────────────── */}
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
                {i < notifications.length - 1 && <View style={styles.separator} />}
              </View>
            ))}
          </View>
        )}

        {/* ── Notification Preferences ─────────────────────────────────── */}
        <View style={styles.prefSection}>
          <Text style={styles.prefSectionTitle}>NOTIFICATION PREFERENCES</Text>

          <View style={styles.prefCard}>
            <PrefRow
              label="New direct messages"
              subtitle="When someone sends you a private message"
              value={prefs.dm_push}
              onChange={v => togglePref('dm_push', v)}
            />
            <View style={styles.prefDivider} />
            <PrefRow
              label="Event chat messages"
              subtitle="When someone messages in an event you joined"
              value={prefs.event_message_push}
              onChange={v => togglePref('event_message_push', v)}
            />
            <View style={styles.prefDivider} />
            <PrefRow
              label="Someone joined your event"
              subtitle="When a new person joins an event you're going to"
              value={prefs.event_join_push}
              onChange={v => togglePref('event_join_push', v)}
            />
            <View style={styles.prefDivider} />
            <PrefRow
              label="New events in your city"
              subtitle="When someone creates an event in your city"
              value={prefs.new_event_push}
              onChange={v => togglePref('new_event_push', v)}
            />
            <View style={styles.prefDivider} />
            <PrefRow
              label="City chat messages"
              subtitle="When someone sends a message in your city channel"
              value={prefs.channel_message_push}
              onChange={v => togglePref('channel_message_push', v)}
            />
            <View style={styles.prefDivider} />
            <PrefRow
              label="Someone arrived in your city"
              subtitle="When a registered user joins the city channel you're in"
              value={prefs.city_join_push}
              onChange={v => togglePref('city_join_push', v)}
            />
            <View style={styles.prefDivider} />
            <PrefRow
              label="Friend requests"
              subtitle="When someone adds you as a friend"
              value={prefs.friend_added_push}
              onChange={v => togglePref('friend_added_push', v)}
            />
            <View style={styles.prefDivider} />
            <PrefRow
              label="Vibes ✨"
              subtitle="When someone leaves a vibe on your profile"
              value={prefs.vibe_received_push}
              onChange={v => togglePref('vibe_received_push', v)}
            />
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

  // ── Header ────────────────────────────────────────────────────────────────
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
    flex:         1,
    textAlign:    'center',
    fontSize:     FontSizes.lg,
    fontWeight:   '800',
    color:        Colors.text,
    letterSpacing: -0.4,
  },
  markReadBtn: {
    width:           80,
    alignItems:      'flex-end',
    justifyContent:  'center',
  },
  markReadText: {
    fontSize:   FontSizes.sm,
    fontWeight: '600',
    color:      Colors.accent,
  },

  // ── Notifications ─────────────────────────────────────────────────────────
  notifList: { paddingTop: Spacing.xs },

  notifRow: {
    flexDirection:     'row',
    alignItems:        'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    gap:               Spacing.sm,
    position:          'relative',
  },
  notifRowUnread: {
    backgroundColor: 'rgba(255,122,60,0.04)',
  },

  // Orange left accent bar for unread
  accentBar: {
    position:        'absolute',
    left:            0,
    top:             12,
    bottom:          12,
    width:           3,
    borderRadius:    2,
    backgroundColor: Colors.accent,
  },

  notifIcon: {
    width:          44,
    height:         44,
    borderRadius:   Radius.md,
    borderWidth:    1,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
  },

  notifBody: { flex: 1, gap: 4 },

  notifTitle: {
    fontSize:   FontSizes.sm,
    fontWeight: '700',
    color:      Colors.white,
    lineHeight: 20,
  },
  notifTitleRead: { color: Colors.muted, fontWeight: '500' },

  notifPreview: {
    fontSize:  FontSizes.sm,
    color:     Colors.text,
    lineHeight: 18,
  },
  notifPreviewRead: { color: Colors.muted2 },

  notifTime: {
    fontSize: FontSizes.xs,
    color:    Colors.muted2,
    marginTop: 2,
  },

  unreadDot: {
    width:           10,
    height:          10,
    borderRadius:    5,
    backgroundColor: Colors.accent,
    marginTop:       6,
    flexShrink:      0,
  },

  separator: {
    height:          1,
    backgroundColor: Colors.border,
    marginLeft:      Spacing.md + 44 + Spacing.sm,
  },

  // ── Empty state ───────────────────────────────────────────────────────────
  center:     { paddingVertical: Spacing.xxl, alignItems: 'center' },
  emptyWrap:  { paddingVertical: Spacing.xxl, alignItems: 'center', gap: Spacing.sm },
  emptyIcon:  { fontSize: 40, marginBottom: Spacing.sm },
  emptyTitle: { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
  emptySub:   { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center', lineHeight: 20, paddingHorizontal: Spacing.xl },

  // ── Preferences ───────────────────────────────────────────────────────────
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
    height:          1,
    backgroundColor: Colors.border,
    marginHorizontal: Spacing.md,
  },
});
