import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import type { FeedItem, HiladsEvent } from '@/types';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { AttendeeAvatars } from '@/components/AttendeeAvatars';
import { eventIcon } from '@/features/events/EventPill';
import { formatRecurrence } from '@/lib/recurrence';
import { Card, Chip } from '@/ui';

// Plan card for the Hi now list ((tabs)/events.tsx). A recurring plan takes
// the caramel border and a caramel repeat line (caramel = plans on the map).

// `tz` is optional. The Now screen renders today-only so viewer-local is fine;
// the Upcoming screen renders future days across city timezones and needs to
// format in the city's tz so times don't shift.
function formatTime(ts: number, tz?: string): string {
  return new Date(ts * 1000).toLocaleTimeString(
    i18n.language,
    tz
      ? { timeZone: tz, hour: '2-digit', minute: '2-digit' }
      : { hour: '2-digit', minute: '2-digit' },
  );
}

// Day prefix for events outside today - '' for today, 'Tomorrow · ' for
// tomorrow, '{weekday} · ' further out. The Now feed now spans today + 2 days,
// so a bare time would be ambiguous. Computed in `tz` so the day boundary
// matches the city's calendar (and the backend window).
function dayPrefix(ts: number, tz?: string): string {
  const opts: Intl.DateTimeFormatOptions | undefined = tz ? { timeZone: tz } : undefined;
  const keyOf = (d: Date) => d.toLocaleDateString('en-CA', opts);
  const todayKey    = keyOf(new Date());
  const tomorrowKey = new Date(Date.parse(todayKey + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  const startKey    = keyOf(new Date(ts * 1000));
  if (startKey === todayKey)    return '';
  if (startKey === tomorrowKey) return `${i18n.t('time.tomorrow', { ns: 'common' })} · `;
  const weekday = new Date(ts * 1000).toLocaleDateString(i18n.language, {
    weekday: 'short',
    ...(tz ? { timeZone: tz } : {}),
  });
  return `${weekday} · `;
}

type Props = {
  event:    HiladsEvent | FeedItem;
  tz?:      string;
  onPress:  () => void;
  // NOW feed only - when set, replaces the address line with the formatted
  // distance from the viewer (e.g. "300 m", "1.2 km"). Other surfaces (detail,
  // upcoming, past) omit it and keep showing the full address.
  distanceLabel?: string | null;
  // NOW feed only - tapping the attendee row opens the members list instead of
  // the card. Omitted elsewhere (avatars are not tappable).
  onAvatarsPress?: () => void;
  // NOW feed only - the feed spans today + 2 days, so prefix the time with the
  // day (Today→none / Tomorrow / weekday). Other surfaces group by day already.
  showDay?: boolean;
};

export function EventCard({ event, tz, onPress, distanceLabel, onAvatarsPress, showDay = false }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const { t } = useTranslation('event');
  const recurLabel  = formatRecurrence(event);
  const isRecurring = !!(event.series_id ?? recurLabel);
  const now         = Date.now() / 1000;
  const startsAt    = (event as HiladsEvent).starts_at  ?? 0;
  const expiresAt   = (event as HiladsEvent).expires_at ?? 0;
  const endsAt      = (event as HiladsEvent).ends_at;
  const isLive      = startsAt <= now && expiresAt > now;

  // FeedItem uses event_type; HiladsEvent also has event_type - canonical field
  const eventType  = (event as FeedItem).event_type ?? (event as HiladsEvent).event_type ?? 'other';
  const sourceType = (event as FeedItem).source_type ?? (event as HiladsEvent).source_type ?? 'hilads';
  const isPublic   = sourceType === 'ticketmaster';
  const host       = (event as HiladsEvent).host_nickname;
  const place      = distanceLabel || event.location || event.venue;
  const going      = event.participant_count ?? 0;

  return (
    <TouchableOpacity activeOpacity={0.75} onPress={onPress} accessibilityRole="button">
      <Card style={[styles.card, isRecurring && styles.cardRecurring]}>
        <View style={styles.titleRow}>
          <View style={styles.icon}>
            <Ionicons name={eventIcon(eventType)} size={18} color={colors.primaryOnTint} />
          </View>
          <Text style={styles.title} numberOfLines={2}>{event.title}</Text>
          {!isPublic && going > 0 ? (
            <View style={styles.going} accessibilityLabel={t('going', { count: going })}>
              <Ionicons name="people-outline" size={16} color={colors.primaryText} />
              <Text style={styles.goingText}>{going}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.chips}>
          <Chip icon="calendar-outline" label={t('laterTag', { ns: 'now' })} />
          {isPublic && <Chip variant="outline" label={t('public')} />}
          {recurLabel ? (
            <View style={styles.recur}>
              <Ionicons name="repeat-outline" size={14} color={colors.caramel} />
              <Text style={styles.recurText} numberOfLines={1}>{recurLabel}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={15} color={isLive ? colors.primaryText : colors.muted} />
          <Text style={[styles.meta, isLive && styles.metaLive]} numberOfLines={1}>
            {showDay ? dayPrefix(startsAt, tz) : ''}{formatTime(startsAt, tz)}{endsAt ? ` → ${formatTime(endsAt, tz)}` : ''}
          </Text>
        </View>

        {place ? (
          <View style={styles.metaRow}>
            <Ionicons name="location-outline" size={15} color={colors.muted} />
            <Text style={styles.meta} numberOfLines={1}>{place}</Text>
          </View>
        ) : null}

        {host ? (
          <Text style={styles.host} numberOfLines={1}>{t('hostedBy', { name: host })}</Text>
        ) : null}

        {!isPublic ? (
          <AttendeeAvatars
            preview={(event as HiladsEvent).participants_preview ?? []}
            total={going}
            onPress={onAvatarsPress}
          />
        ) : null}
      </Card>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:          { padding: 14, gap: 8 },
  cardRecurring: { borderColor: c.caramel },
  titleRow:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon:          { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  title:         { flex: 1, fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  going:         { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  goingText:     { fontSize: FontSizes.sm, fontWeight: '800', color: c.primaryText },
  chips:         { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  recur:         { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  recurText:     { fontSize: FontSizes.xs, fontWeight: '700', color: c.caramel },
  metaRow:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta:          { flex: 1, fontSize: FontSizes.sm, fontWeight: '600', color: c.muted },
  metaLive:      { color: c.primaryText },
  host:          { fontSize: FontSizes.xs, fontWeight: '500', color: c.muted },
});
