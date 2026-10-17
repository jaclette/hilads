import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import type { FeedItem } from '@/types';
import { FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Card, Chip } from '@/ui';
import { AttendeeAvatars } from '@/components/AttendeeAvatars';
import { formatExpiresIn } from '@/lib/expiry';

// ── Shared pulse (topic) card ───────────────────────────────────────────────
// Used by the Now feed and the Past archive so a pulse looks identical in both
// places. Pass `pastMode` on the archive to hide the live "Active now" badge
// (expired pulses are never active) and surface the reply count without the
// "be first" nudge.

const CATEGORY_ICONS: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  general: 'chatbubbles-outline', tips: 'bulb-outline', food: 'restaurant-outline',
  drinks: 'wine-outline', help: 'help-buoy-outline', meetup: 'people-outline',
};

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60)    return i18n.t('time.justNow', { ns: 'common' });
  if (diff < 3600)  return i18n.t('time.mAgo', { ns: 'common', count: Math.floor(diff / 60) });
  if (diff < 86400) return i18n.t('time.hAgo', { ns: 'common', count: Math.floor(diff / 3600) });
  return i18n.t('time.dAgo', { ns: 'common', count: Math.floor(diff / 86400) });
}

export function TopicCard({
  topic, onPress, pastMode = false, distanceLabel, onAvatarsPress, isHost = false,
}: {
  topic: FeedItem & { kind: 'topic' };
  onPress: () => void;
  pastMode?: boolean;
  // NOW feed only - formatted distance from the viewer (creator's coords).
  distanceLabel?: string | null;
  // NOW feed only - tapping the member row opens the members list.
  onAvatarsPress?: () => void;
  // NOW feed only - viewer created this hangout (show "waiting" not "say hi to self").
  isHost?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const icon      = CATEGORY_ICONS[topic.category ?? 'general'] ?? 'chatbubble-outline';
  const replies   = topic.message_count ?? 0;
  const lastAct   = topic.last_activity_at;
  const activeNow = !pastMode && topic.active_now === true;
  const expiresIn = pastMode ? null : formatExpiresIn(topic.expires_at);

  return (
    <TouchableOpacity activeOpacity={0.75} onPress={onPress} accessibilityRole="button">
      <Card style={styles.card}>
        <View style={styles.chips}>
          <Chip icon="flash-outline" label={t('nowTag', { ns: 'now' })} />
          {activeNow && <Chip tone="local" label={t('activeNow')} />}
          {expiresIn && <Chip variant="outline" label={expiresIn} />}
        </View>
        <View style={styles.titleRow}>
          <View style={styles.icon}>
            <Ionicons name={icon} size={18} color={colors.primaryOnTint} />
          </View>
          <Text style={styles.title} numberOfLines={2}>{topic.title}</Text>
        </View>
        {topic.description ? (
          <Text style={styles.desc} numberOfLines={2}>{topic.description}</Text>
        ) : null}
        {distanceLabel ? (
          <View style={styles.metaRow}>
            <Ionicons name="location-outline" size={15} color={colors.muted} />
            <Text style={styles.location} numberOfLines={1}>{distanceLabel}</Text>
          </View>
        ) : null}
        <Text style={styles.meta}>
          {replies > 0
            ? `${t('replies', { count: replies })}${lastAct ? ` · ${timeAgo(lastAct)}` : ''}`
            : pastMode ? t('noReplies')
            : isHost ? t('hostWaiting')
            : (topic.host_nickname ? t('sayHi', { name: topic.host_nickname }) : t('noRepliesFirst'))}
        </Text>
        {!pastMode ? (
          <AttendeeAvatars
            preview={topic.participants_preview ?? []}
            total={topic.participant_count ?? 0}
            onPress={onAvatarsPress}
          />
        ) : null}
      </Card>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:     { padding: Spacing.md, gap: 8, borderColor: c.primary },
  chips:    { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon:     { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  title:    { flex: 1, fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  desc:     { fontSize: FontSizes.sm, fontWeight: '400', color: c.muted, lineHeight: 20 },
  metaRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  location: { flex: 1, fontSize: FontSizes.sm, fontWeight: '600', color: c.muted },
  meta:     { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryText },
});
