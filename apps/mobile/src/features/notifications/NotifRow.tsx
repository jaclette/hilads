/**
 * Shared notification row components used by both the preview screen
 * (notifications.tsx) and the full-history screen (notifications-history.tsx).
 */

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import i18n from '@/i18n';
import { Border, FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import type { Notification } from '@/types';

// ── Relative time ─────────────────────────────────────────────────────────────

export function relativeTime(raw?: string | null): string {
  if (!raw) return '';
  let ms = Date.parse(raw);
  if (isNaN(ms)) {
    const n = Number(raw);
    if (!isNaN(n)) ms = n < 1e10 ? n * 1000 : n;
  }
  if (isNaN(ms)) return '';
  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 60)    return i18n.t('time.nowShort', { ns: 'common' });
  if (diffSec < 3600)  return i18n.t('time.mAgo', { ns: 'common', count: Math.floor(diffSec / 60) });
  if (diffSec < 86400) return i18n.t('time.hAgo', { ns: 'common', count: Math.floor(diffSec / 3600) });
  return i18n.t('time.dAgo', { ns: 'common', count: Math.floor(diffSec / 86400) });
}

// ── Notification icon ─────────────────────────────────────────────────────────

export function NotifIcon({ type, unread, small = false }: { type: Notification['type']; unread: boolean; small?: boolean }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const iconName: React.ComponentProps<typeof Ionicons>['name'] =
    type === 'dm_message'      ? 'chatbubble-outline'   :
    type === 'event_message'   ? 'chatbox-outline'      :
    type === 'event_join'      ? 'people-outline'       :
    type === 'new_event'       ? 'flash-outline'        :
    type === 'channel_message' ? 'chatbubbles-outline'  :
    type === 'city_join'       ? 'person-add-outline'   :
    type === 'friend_added'    ? 'person-add-outline'   :
    type === 'vibe_received'   ? 'star-outline'         :
    type === 'profile_view'    ? 'eye-outline'          :
    type === 'daily_vote'      ? 'heart-outline'        :
    type === 'daily_twist_completed' ? 'leaf-outline'   :
    type === 'photo_comment'   ? 'chatbubble-ellipses-outline' :
    type === 'photo_mention'   ? 'at-outline'           :
    /* fallback */               'notifications-outline';

  return (
    <View style={[styles.notifIcon, unread && styles.notifIconUnread, small && styles.notifIconSmall]}>
      <Ionicons name={iconName} size={small ? 12 : 20} color={unread ? colors.primaryOnTint : colors.muted} />
    </View>
  );
}

// ── Notification row ──────────────────────────────────────────────────────────

export function NotifRow({ notif, onPress }: { notif: Notification; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const unread = !notif.is_read;
  const time   = relativeTime(notif.created_at);

  return (
    <TouchableOpacity
      style={[styles.notifRow, unread && styles.notifRowUnread]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
    >

      {/* A comment: who wrote it, with the comment icon on it; else the type's icon. */}
      {notif.data?.actorPhoto ? (
        <View>
          <Image source={{ uri: notif.data.actorPhoto }} style={styles.actor} contentFit="cover" />
          <View style={styles.actorBadge}><NotifIcon type={notif.type} unread={unread} small /></View>
        </View>
      ) : <NotifIcon type={notif.type} unread={unread} />}

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

      {!!notif.data?.photoThumb && <Image source={{ uri: notif.data.photoThumb }} style={styles.thumb} contentFit="cover" />}
      {unread && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );
}

// ── Separator ─────────────────────────────────────────────────────────────────

export function NotifSeparator() {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.separator} />;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  notifRow:         { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: Spacing.md, paddingVertical: 14, gap: 12 },
  notifRowUnread:   { backgroundColor: c.bg2 },
  notifIcon:        { width: 44, height: 44, borderRadius: Radius.full, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2,
                      alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  notifIconUnread:  { borderColor: c.primaryTint, backgroundColor: c.primaryTint },
  notifIconSmall:   { width: 22, height: 22, borderColor: c.bg },
  actor:            { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: c.bg3 },
  actorBadge:       { position: 'absolute', right: -4, bottom: -4 },
  thumb:            { width: 44, height: 44, borderRadius: Radius.sm, backgroundColor: c.bg3, flexShrink: 0 },
  notifBody:        { flex: 1, gap: 3 },
  notifTitle:       { fontSize: FontSizes.sm, fontWeight: '700', color: c.text, lineHeight: 20 },
  notifTitleRead:   { color: c.muted, fontWeight: '500' },
  notifPreview:     { fontSize: FontSizes.sm, fontWeight: '400', color: c.text, lineHeight: 18 },
  notifPreviewRead: { color: c.muted },
  notifTime:        { fontSize: FontSizes.xs, fontWeight: '500', color: c.muted, marginTop: 2 },
  unreadDot:        { width: 10, height: 10, borderRadius: Radius.full, backgroundColor: c.primary, marginTop: 6, flexShrink: 0 },
  separator:        { height: 1, backgroundColor: c.line, marginLeft: Spacing.md + 44 + 12 },
});
