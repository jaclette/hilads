import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import type { FeedItem } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import { AttendeeAvatars } from '@/components/AttendeeAvatars';
import { formatExpiresIn } from '@/lib/expiry';

// ── Shared pulse (topic) card ───────────────────────────────────────────────
// Used by the Now feed and the Past archive so a pulse looks identical in both
// places. Pass `pastMode` on the archive to hide the live "Active now" badge
// (expired pulses are never active) and surface the reply count without the
// "be first" nudge.

const CATEGORY_ICONS: Record<string, string> = {
  general: '🗣️', tips: '💡', food: '🍴', drinks: '🍺', help: '🙋', meetup: '👋',
};

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60)    return i18n.t('time.justNow', { ns: 'common' });
  if (diff < 3600)  return i18n.t('time.mAgo', { ns: 'common', count: Math.floor(diff / 60) });
  if (diff < 86400) return i18n.t('time.hAgo', { ns: 'common', count: Math.floor(diff / 3600) });
  return i18n.t('time.dAgo', { ns: 'common', count: Math.floor(diff / 86400) });
}

export function TopicCard({
  topic, onPress, pastMode = false, distanceLabel, onAvatarsPress,
}: {
  topic: FeedItem & { kind: 'topic' };
  onPress: () => void;
  pastMode?: boolean;
  // NOW feed only - formatted distance from the viewer (creator's coords).
  distanceLabel?: string | null;
  // NOW feed only - tapping the member row opens the members list.
  onAvatarsPress?: () => void;
}) {
  const { t } = useTranslation('common');
  const icon      = CATEGORY_ICONS[topic.category ?? 'general'] ?? '💬';
  const replies   = topic.message_count ?? 0;
  const lastAct   = topic.last_activity_at;
  const activeNow = !pastMode && topic.active_now === true;
  const expiresIn = pastMode ? null : formatExpiresIn(topic.expires_at);

  return (
    <TouchableOpacity style={styles.topicCard} activeOpacity={0.75} onPress={onPress}>
      <View style={styles.cardKindRow}>
        <View style={styles.kindBadgeTopic}><Text style={styles.kindBadgeTopicText}>🔥 {t('nowTag', { ns: 'now' })}</Text></View>
        {activeNow && (
          <View style={styles.activeNowBadge}>
            <Text style={styles.activeNowText}>{t('activeNow')}</Text>
          </View>
        )}
        {expiresIn && (
          <View style={styles.expiryBadge}>
            <Text style={styles.expiryText}>⏱ {expiresIn}</Text>
          </View>
        )}
      </View>
      <View style={styles.cardTitleRow}>
        <Text style={styles.cardIcon}>{icon}</Text>
        <Text style={[styles.cardTitle, styles.topicTitle]} numberOfLines={2}>{topic.title}</Text>
      </View>
      {topic.description ? (
        <Text style={styles.topicDesc} numberOfLines={2}>{topic.description}</Text>
      ) : null}
      {distanceLabel ? (
        <Text style={styles.topicLocation} numberOfLines={1}>📍 {distanceLabel}</Text>
      ) : null}
      <Text style={styles.topicMeta}>
        {replies > 0
          ? `${t('replies', { count: replies })}${lastAct ? ` · ${timeAgo(lastAct)}` : ''}`
          : pastMode ? t('noReplies') : (topic.host_nickname ? t('sayHi', { name: topic.host_nickname }) : t('noRepliesFirst'))}
      </Text>
      {!pastMode ? (
        <AttendeeAvatars
          preview={topic.participants_preview ?? []}
          total={topic.participant_count ?? 0}
          onPress={onAvatarsPress}
        />
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  cardKindRow: { flexDirection: 'row', alignItems: 'center', marginBottom: -2 },
  kindBadgeTopic: {
    backgroundColor:   'rgba(255,122,60,0.12)',
    borderRadius:      Radius.full,
    paddingHorizontal: 7,
    paddingVertical:   1,
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.22)',
  },
  kindBadgeTopicText: { fontSize: 9, fontWeight: '700', color: Colors.accent, letterSpacing: 0.5 },

  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardIcon:     { fontSize: 16, lineHeight: 18 },
  cardTitle:    { flex: 1, fontSize: FontSizes.md, fontWeight: '700', color: Colors.text, lineHeight: 19 },

  topicCard: {
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     'rgba(96,165,250,0.15)',
    padding:         Spacing.md,
    gap:             8,
  },
  topicTitle:    { color: Colors.text },
  topicDesc:     { fontSize: FontSizes.sm, color: Colors.muted, lineHeight: 20 },
  topicLocation: { fontSize: FontSizes.sm, color: Colors.muted },
  topicMeta:     { flex: 1, fontSize: FontSizes.sm, color: '#60a5fa', fontWeight: '600' },

  activeNowBadge: {
    backgroundColor:   'rgba(34,197,94,0.10)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderWidth:       1,
    borderColor:       'rgba(34,197,94,0.20)',
    marginLeft:        6,
  },
  activeNowText: { fontSize: 10, fontWeight: '700', color: '#4ade80', letterSpacing: 0.3 },

  expiryBadge: {
    backgroundColor:   'rgba(255,255,255,0.06)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.10)',
    marginLeft:        6,
  },
  expiryText: { fontSize: 10, fontWeight: '700', color: Colors.muted, letterSpacing: 0.3 },
});
