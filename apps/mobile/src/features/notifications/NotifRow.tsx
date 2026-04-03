/**
 * Shared notification row components used by both the preview screen
 * (notifications.tsx) and the full-history screen (notifications-history.tsx).
 */

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
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
  if (diffSec < 60)    return 'now';
  if (diffSec < 3600)  return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

// ── Notification icon ─────────────────────────────────────────────────────────

export function NotifIcon({ type, unread }: { type: Notification['type']; unread: boolean }) {
  const iconName: React.ComponentProps<typeof Feather>['name'] =
    type === 'dm_message'      ? 'message-circle' :
    type === 'event_message'   ? 'message-square' :
    type === 'event_join'      ? 'users'           :
    type === 'new_event'       ? 'zap'             :
    type === 'channel_message' ? 'hash'            :
    type === 'city_join'       ? 'user-plus'       :
    type === 'friend_added'    ? 'user-plus'       :
    type === 'vibe_received'   ? 'star'            :
    type === 'profile_view'    ? 'eye'             :
    /* fallback */               'bell';

  const color  = unread ? Colors.white : Colors.muted;
  const bg     = unread ? 'rgba(255,122,60,0.15)' : Colors.bg3;
  const border = unread ? 'rgba(255,122,60,0.3)'  : Colors.border;

  return (
    <View style={[styles.notifIcon, { backgroundColor: bg, borderColor: border }]}>
      <Feather name={iconName} size={20} color={color} />
    </View>
  );
}

// ── Notification row ──────────────────────────────────────────────────────────

export function NotifRow({ notif, onPress }: { notif: Notification; onPress: () => void }) {
  const unread = !notif.is_read;
  const time   = relativeTime(notif.created_at);

  return (
    <TouchableOpacity
      style={[styles.notifRow, unread && styles.notifRowUnread]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {unread && <View style={styles.accentBar} />}

      <NotifIcon type={notif.type} unread={unread} />

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

      {unread && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );
}

// ── Separator ─────────────────────────────────────────────────────────────────

export function NotifSeparator() {
  return <View style={styles.separator} />;
}

// ── Styles ────────────────────────────────────────────────────────────────────

export const styles = StyleSheet.create({
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
  notifBody:        { flex: 1, gap: 4 },
  notifTitle:       { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.white, lineHeight: 20 },
  notifTitleRead:   { color: Colors.muted, fontWeight: '500' },
  notifPreview:     { fontSize: FontSizes.sm, color: Colors.text, lineHeight: 18 },
  notifPreviewRead: { color: Colors.muted2 },
  notifTime:        { fontSize: FontSizes.xs, color: Colors.muted2, marginTop: 2 },
  unreadDot: {
    width:           10,
    height:          10,
    borderRadius:    5,
    backgroundColor: Colors.accent,
    marginTop:       6,
    flexShrink:      0,
  },
  separator: {
    height:           1,
    backgroundColor:  Colors.border,
    marginLeft:       Spacing.md + 44 + Spacing.sm,
  },
});
