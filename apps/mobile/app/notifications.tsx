/**
 * Notifications preview screen - latest 5 notifications + preferences.
 *
 * Fetches only 5 notifications server-side (limit=5).
 * "See all notifications" navigates to /notifications-history for the full list.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, Switch, ActivityIndicator, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/context/AppContext';
import { canAccessProfile } from '@/lib/profileAccess';
import {
  fetchNotifications, markNotificationsRead,
  fetchNotificationPreferences, updateNotificationPreferences,
  type NotificationPreferences,
} from '@/api/notifications';
import { socket } from '@/lib/socket';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { Button, Card, EmptyState, Screen, ScreenHeader, SectionTitle } from '@/ui';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
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
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.prefRow}>
      <View style={styles.prefText}>
        <Text style={styles.prefLabel}>{label}</Text>
        <Text style={styles.prefSub}>{subtitle}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.bg3, true: colors.primary }}
        thumbColor={colors.white}
        ios_backgroundColor={colors.bg3}
      />
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function NotificationsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const router = useRouter();
  const { t } = useTranslation('notifications');
  const { account, setUnreadNotifications } = useApp();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading,       setLoading]       = useState(true);
  const notifRef = useRef(notifications);
  notifRef.current = notifications;

  const [prefs, setPrefs] = useState<NotificationPreferences>({
    dm_push:              true,
    event_message_push:   true,
    event_join_push:      false,
    new_event_push:       true,
    new_challenge_push:   true,
    mention_push:         true,
    channel_message_push: false,
    city_join_push:       false,
    world_arrival_push:   false,
    friend_request_push:  true,
    vibe_received_push:   true,
    profile_view_push:    true,
    topic_reply_push:     true,
    new_topic_push:       false,
    admin_announcement_push: true,
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
    } else if (notif.data?.topicId) {
      router.push(`/topic/${notif.data.topicId}` as never);
    } else if (notif.data?.eventId) {
      router.push(`/event/${notif.data.eventId}` as never);
    } else if (notif.data?.challengeId) {
      // Personal challenge invitation + take-on request both carry challengeId
      // in data; tap the bell row → land on the challenge detail.
      router.push(`/challenge/${notif.data.challengeId}` as never);
    } else if (notif.type === 'daily_twist_picked') {
      router.push('/daily/twist' as never);
    } else if (notif.type === 'channel_message' || notif.type === 'city_join') {
      router.push('/(tabs)/chat' as never);
    } else if (notif.type === 'friend_request_received') {
      router.push('/friend-requests' as never);
    } else if (notif.type === 'friend_request_accepted' && notif.data?.accepterUserId) {
      if (canAccessProfile(account)) router.push(`/user/${notif.data.accepterUserId}` as never);
    } else if (notif.type === 'friend_added' && notif.data?.senderUserId) {
      // Legacy notification rows (pre-refactor) still deep-link to the adder's profile.
      if (canAccessProfile(account)) router.push(`/user/${notif.data.senderUserId}` as never);
    } else if (notif.type === 'vibe_received') {
      router.push('/(tabs)/me' as never);
    } else if (notif.type === 'profile_view' && notif.data?.viewerId) {
      if (canAccessProfile(account)) router.push(`/user/${notif.data.viewerId}` as never);
    }
  }, [router, account, setUnreadNotifications]);

  const hasUnread = notifications.some(n => !n.is_read);

  return (
    <Screen>
      <ScreenHeader
        title={t('notifications', { ns: 'common' })}
        right={hasUnread ? <Button variant="link" label={t('markAllRead')} onPress={markAllRead} /> : undefined}
      />

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Latest notifications (preview) ───────────────────────────── */}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : notifications.length === 0 ? (
          <EmptyState icon="notifications-outline" title={t('emptyTitle')} body={t('emptySub')} />
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
          <Button variant="secondary" label={t('seeAll')} onPress={() => router.push('/notifications-history' as never)} style={styles.seeAllBtn} />
        )}

        {/* ── Notification Preferences ─────────────────────────────────── */}
        <View style={styles.prefSection}>
          <SectionTitle title={t('prefTitle')} />

          <Card style={styles.prefCard}>
            {/* DM, event-chat, and city-chat toggles live on the Messages screen
                now - they govern the envelope icon's behaviour, not the bell. */}
            <PrefRow label={t('pref.mentionLabel')} subtitle={t('pref.mentionSub')} value={prefs.mention_push} onChange={v => togglePref('mention_push', v)} />
            <View style={styles.prefDivider} />
            <PrefRow label={t('pref.eventJoinLabel')} subtitle={t('pref.eventJoinSub')} value={prefs.event_join_push} onChange={v => togglePref('event_join_push', v)} />
            <View style={styles.prefDivider} />
            <PrefRow label={t('pref.newEventLabel')} subtitle={t('pref.newEventSub')} value={prefs.new_event_push} onChange={v => togglePref('new_event_push', v)} />
            <View style={styles.prefDivider} />
            <PrefRow label={t('pref.newChallengeLabel')} subtitle={t('pref.newChallengeSub')} value={prefs.new_challenge_push} onChange={v => togglePref('new_challenge_push', v)} />
            <View style={styles.prefDivider} />
            <PrefRow label={t('pref.cityJoinLabel')} subtitle={t('pref.cityJoinSub')} value={prefs.city_join_push} onChange={v => togglePref('city_join_push', v)} />
            <View style={styles.prefDivider} />
            <PrefRow label={t('pref.worldArrivalLabel')} subtitle={t('pref.worldArrivalSub')} value={prefs.world_arrival_push} onChange={v => togglePref('world_arrival_push', v)} />
            <View style={styles.prefDivider} />
            <PrefRow label={t('pref.friendLabel')} subtitle={t('pref.friendSub')} value={prefs.friend_request_push} onChange={v => togglePref('friend_request_push', v)} />
            <View style={styles.prefDivider} />
            <PrefRow label={t('pref.vibeLabel')} subtitle={t('pref.vibeSub')} value={prefs.vibe_received_push} onChange={v => togglePref('vibe_received_push', v)} />
            <View style={styles.prefDivider} />
            <PrefRow label={t('pref.profileViewLabel')} subtitle={t('pref.profileViewSub')} value={prefs.profile_view_push} onChange={v => togglePref('profile_view_push', v)} />
            <View style={styles.prefDivider} />
            <PrefRow label={t('pref.topicReplyLabel')} subtitle={t('pref.topicReplySub')} value={prefs.topic_reply_push} onChange={v => togglePref('topic_reply_push', v)} />
            <View style={styles.prefDivider} />
            <PrefRow label={t('pref.newTopicLabel')} subtitle={t('pref.newTopicSub')} value={prefs.new_topic_push} onChange={v => togglePref('new_topic_push', v)} />
            <View style={styles.prefDivider} />
            <PrefRow label={t('pref.announceLabel')} subtitle={t('pref.announceSub')} value={prefs.admin_announcement_push} onChange={v => togglePref('admin_announcement_push', v)} />
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  flex:          { flex: 1 },
  scrollContent: { paddingBottom: Spacing.xxl },
  notifList:     { paddingTop: Spacing.xs },
  seeAllBtn:     { marginHorizontal: Spacing.md, marginTop: Spacing.sm },
  center:        { paddingVertical: Spacing.xxl, alignItems: 'center' },

  // ── Preferences ────────────────────────────────────────────────────────────
  prefSection: { marginTop: Spacing.xl, paddingHorizontal: Spacing.md, gap: Spacing.sm },
  prefCard:    { overflow: 'hidden' },
  prefRow:     { flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingHorizontal: 14, paddingVertical: 12, gap: Spacing.md },
  prefText:    { flex: 1, gap: 3 },
  prefLabel:   { fontSize: 15, fontWeight: '700', color: c.text },
  prefSub:     { fontSize: FontSizes.xs, fontWeight: '400', color: c.muted, lineHeight: 17 },
  prefDivider: { height: 1, backgroundColor: c.line },
});
