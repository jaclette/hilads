/**
 * Notifications history screen — full paginated list of notifications.
 *
 * Fetches 50 notifications per page (limit/offset).
 * No preferences section — that lives on the preview screen.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity,
  ActivityIndicator, StyleSheet, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { canAccessProfile } from '@/lib/profileAccess';
import { fetchNotifications, markNotificationsRead } from '@/api/notifications';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { Notification } from '@/types';
import { NotifRow, NotifSeparator } from '@/features/notifications/NotifRow';

const PAGE_SIZE = 50;

export default function NotificationsHistoryScreen() {
  const router = useRouter();
  const { account, setUnreadNotifications } = useApp();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [loadingMore,   setLoadingMore]   = useState(false);
  const [hasMore,       setHasMore]       = useState(true);
  const notifRef = useRef(notifications);
  notifRef.current = notifications;

  // ── Load page ─────────────────────────────────────────────────────────────

  const load = useCallback(async (offset = 0, append = false) => {
    if (offset === 0) setLoading(true); else setLoadingMore(true);
    try {
      const { notifications: list } = await fetchNotifications(PAGE_SIZE, offset);
      setHasMore(list.length === PAGE_SIZE);
      setNotifications(prev => append ? [...prev, ...list] : list);
      if (offset === 0) {
        setUnreadNotifications(list.filter(n => !n.is_read).length);
      }
    } catch { /* silent */ }
    finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [setUnreadNotifications]);

  useEffect(() => { load(); }, [load]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    load(notifRef.current.length, true);
  }, [load, loadingMore, hasMore]);

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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Feather name="chevron-left" size={22} color={Colors.text} />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>All Notifications</Text>

        {hasUnread ? (
          <TouchableOpacity onPress={markAllRead} activeOpacity={0.7} style={styles.markReadBtn}>
            <Text style={styles.markReadText}>Mark all read</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.markReadBtn} />
        )}
      </View>

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
        <FlatList
          data={notifications}
          keyExtractor={item => String(item.id)}
          renderItem={({ item, index }) => (
            <View>
              <NotifRow notif={item} onPress={() => handleTap(item)} />
              {index < notifications.length - 1 && <NotifSeparator />}
            </View>
          )}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator size="small" color={Colors.accent} />
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

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

  listContent:  { paddingTop: Spacing.xs, paddingBottom: Spacing.xxl },
  footerLoader: { paddingVertical: Spacing.lg, alignItems: 'center' },

  center:     { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.xl },
  emptyIcon:  { fontSize: 40, marginBottom: Spacing.sm },
  emptyTitle: { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
  emptySub:   { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
});
