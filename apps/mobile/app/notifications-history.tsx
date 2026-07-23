/**
 * Notifications history screen - full paginated list of notifications.
 *
 * Fetches 50 notifications per page (limit/offset).
 * No preferences section - that lives on the preview screen.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity,
  ActivityIndicator, StyleSheet, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Feather } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { canAccessProfile } from '@/lib/profileAccess';
import { fetchNotifications, markNotificationsRead } from '@/api/notifications';
import { FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import type { Notification } from '@/types';
import { NotifRow, NotifSeparator } from '@/features/notifications/NotifRow';

const PAGE_SIZE = 50;

export default function NotificationsHistoryScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const router = useRouter();
  const { t } = useTranslation('notifications');
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

  // ── Tap a notification - mark read + navigate ─────────────────────────────

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
      const namePart = notif.data.senderName ? `&name=${encodeURIComponent(notif.data.senderName)}` : '';
      router.push(`/dm/${notif.data.conversationId}?conv=${encodeURIComponent(notif.data.conversationId)}${namePart}` as never);
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
          <Feather name="chevron-left" size={22} color={colors.text} />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>{t('allTitle')}</Text>

        {hasUnread ? (
          <TouchableOpacity onPress={markAllRead} activeOpacity={0.7} style={styles.markReadBtn}>
            <Text style={styles.markReadText}>{t('markAllRead')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.markReadBtn} />
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : notifications.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyIcon}>🔔</Text>
          <Text style={styles.emptyTitle}>{t('emptyTitle')}</Text>
          <Text style={styles.emptySub}>{t('emptySub')}</Text>
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
                <ActivityIndicator size="small" color={colors.accent} />
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },

  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   12,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  backBtn: {
    width:           40,
    height:          40,
    borderRadius:    12,
    backgroundColor: c.bg2,
    borderWidth:     1,
    borderColor:     c.border,
    alignItems:      'center',
    justifyContent:  'center',
  },
  headerTitle: {
    flex:          1,
    textAlign:     'center',
    fontSize:      FontSizes.lg,
    fontWeight:    '800',
    color:         c.text,
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
    color:      c.accent,
  },

  listContent:  { paddingTop: Spacing.xs, paddingBottom: Spacing.xxl },
  footerLoader: { paddingVertical: Spacing.lg, alignItems: 'center' },

  center:     { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.xl },
  emptyIcon:  { fontSize: 40, marginBottom: Spacing.sm },
  emptyTitle: { fontSize: FontSizes.md, fontWeight: '700', color: c.text },
  emptySub:   { fontSize: FontSizes.sm, color: c.muted, textAlign: 'center', lineHeight: 20 },
});
