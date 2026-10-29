/**
 * Notifications history screen - full paginated list of notifications.
 *
 * Fetches 50 notifications per page (limit/offset).
 * No preferences section - that lives on the preview screen.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/context/AppContext';
import { canAccessProfile } from '@/lib/profileAccess';
import { fetchNotifications, markNotificationsRead } from '@/api/notifications';
import { Spacing } from '@/constants';
import { Button, EmptyState, Screen, ScreenHeader } from '@/ui';
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
    } else if ((notif.type === 'photo_comment' || notif.type === 'photo_mention') && notif.data?.proofId) {
      // A comment on a photo → the photo, its comments open on that comment.
      router.push(`/daily/${notif.data.date ?? 'today'}?proof=${notif.data.proofId}&comment=${notif.data.commentId ?? ''}` as never);
    } else if ((notif.type === 'daily_vote' || notif.type === 'daily_twist_completed') && notif.data?.proofId) {
      // A vote on my proof / a completion of my Local Twist → that proof in its sheet.
      router.push(`/daily/${notif.data.date ?? 'today'}?proof=${notif.data.proofId}` as never);
    } else if (notif.type === 'daily_twist_picked') {
      router.push('/daily/twist' as never);
    }
  }, [router, account, setUnreadNotifications]);

  const hasUnread = notifications.some(n => !n.is_read);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Screen>
      <ScreenHeader
        title={t('allTitle')}
        right={hasUnread ? <Button variant="link" label={t('markAllRead')} onPress={markAllRead} /> : undefined}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : notifications.length === 0 ? (
        <View style={styles.center}>
          <EmptyState icon="notifications-outline" title={t('emptyTitle')} body={t('emptySub')} />
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
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : null
          }
        />
      )}
    </Screen>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = () => StyleSheet.create({
  listContent:  { paddingTop: Spacing.xs, paddingBottom: Spacing.xxl },
  footerLoader: { paddingVertical: Spacing.lg, alignItems: 'center' },
  center:       { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.lg },
});
