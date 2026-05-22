import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { FeedItem } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

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
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function TopicCard({
  topic, onPress, pastMode = false,
}: {
  topic: FeedItem & { kind: 'topic' };
  onPress: () => void;
  pastMode?: boolean;
}) {
  const icon      = CATEGORY_ICONS[topic.category ?? 'general'] ?? '💬';
  const replies   = topic.message_count ?? 0;
  const lastAct   = topic.last_activity_at;
  const activeNow = !pastMode && topic.active_now === true;

  return (
    <TouchableOpacity style={styles.topicCard} activeOpacity={0.75} onPress={onPress}>
      <View style={styles.cardKindRow}>
        <View style={styles.kindBadgeTopic}><Text style={styles.kindBadgeTopicText}>Pulse</Text></View>
        {activeNow && (
          <View style={styles.activeNowBadge}>
            <Text style={styles.activeNowText}>● Active now</Text>
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
      <Text style={styles.topicMeta}>
        {replies > 0
          ? `💬 ${replies} ${replies === 1 ? 'reply' : 'replies'}${lastAct ? ` · ${timeAgo(lastAct)}` : ''}`
          : pastMode ? 'No replies' : 'No replies yet — be first'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  cardKindRow: { flexDirection: 'row', alignItems: 'center', marginBottom: -2 },
  kindBadgeTopic: {
    backgroundColor:   'rgba(96,165,250,0.12)',
    borderRadius:      Radius.full,
    paddingHorizontal: 7,
    paddingVertical:   1,
    borderWidth:       1,
    borderColor:       'rgba(96,165,250,0.22)',
  },
  kindBadgeTopicText: { fontSize: 9, fontWeight: '700', color: '#60a5fa', letterSpacing: 0.5 },

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
  topicTitle: { color: Colors.text },
  topicDesc:  { fontSize: FontSizes.sm, color: Colors.muted, lineHeight: 20 },
  topicMeta:  { flex: 1, fontSize: FontSizes.sm, color: '#60a5fa', fontWeight: '600' },

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
});
