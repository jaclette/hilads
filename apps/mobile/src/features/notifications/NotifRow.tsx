/**
 * Shared notification row components used by both the preview screen
 * (notifications.tsx) and the full-history screen (notifications-history.tsx).
 */

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import i18n from '@/i18n';
import { FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
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

export function NotifIcon({ type, unread }: { type: Notification['type']; unread: boolean }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
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

  const color  = unread ? colors.white : colors.muted;
  const bg     = unread ? 'rgba(255,122,60,0.15)' : colors.bg3;
  const border = unread ? 'rgba(255,122,60,0.3)'  : colors.border;

  return (
    <View style={[styles.notifIcon, { backgroundColor: bg, borderColor: border }]}>
      <Feather name={iconName} size={20} color={color} />
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
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.separator} />;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
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
    backgroundColor: c.accent,
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
  notifTitle:       { fontSize: FontSizes.sm, fontWeight: '700', color: c.text, lineHeight: 20 },
  notifTitleRead:   { color: c.muted, fontWeight: '500' },
  notifPreview:     { fontSize: FontSizes.sm, color: c.text, lineHeight: 18 },
  notifPreviewRead: { color: c.muted2 },
  notifTime:        { fontSize: FontSizes.xs, color: c.muted2, marginTop: 2 },
  unreadDot: {
    width:           10,
    height:          10,
    borderRadius:    5,
    backgroundColor: c.accent,
    marginTop:       6,
    flexShrink:      0,
  },
  separator: {
    height:           1,
    backgroundColor:  c.border,
    marginLeft:       Spacing.md + 44 + Spacing.sm,
  },
});
