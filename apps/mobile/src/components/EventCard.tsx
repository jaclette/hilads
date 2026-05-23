import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { FeedItem, HiladsEvent } from '@/types';
import { Colors, FontSizes, Radius } from '@/constants';
import { AttendeeAvatars } from '@/components/AttendeeAvatars';

// Shared compact event card — used by the Now feed (tabs/now.tsx) and the
// See-what's-coming screen (upcoming-events.tsx). Keep the two screens visually
// identical by editing this one place.

const EVENT_ICONS: Record<string, string> = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
};

// `tz` is optional. The Now screen renders today-only so viewer-local is fine;
// the Upcoming screen renders future days across city timezones and needs to
// format in the city's tz so times don't shift.
function formatTime(ts: number, tz?: string): string {
  return new Date(ts * 1000).toLocaleTimeString(
    [],
    tz
      ? { timeZone: tz, hour: '2-digit', minute: '2-digit' }
      : { hour: '2-digit', minute: '2-digit' },
  );
}

type Props = {
  event:    HiladsEvent | FeedItem;
  tz?:      string;
  onPress:  () => void;
  // NOW feed only — when set, replaces the address line with the formatted
  // distance from the viewer (e.g. "300 m", "1.2 km"). Other surfaces (detail,
  // upcoming, past) omit it and keep showing the full address.
  distanceLabel?: string | null;
};

export function EventCard({ event, tz, onPress, distanceLabel }: Props) {
  const isRecurring = !!(event.series_id ?? event.recurrence_label);
  const now         = Date.now() / 1000;
  const startsAt    = (event as HiladsEvent).starts_at  ?? 0;
  const expiresAt   = (event as HiladsEvent).expires_at ?? 0;
  const endsAt      = (event as HiladsEvent).ends_at;
  const isLive      = startsAt <= now && expiresAt > now;

  // FeedItem uses event_type; HiladsEvent also has event_type — canonical field
  const eventType  = (event as FeedItem).event_type ?? (event as HiladsEvent).event_type ?? 'other';
  const icon       = EVENT_ICONS[eventType] ?? '📌';
  const sourceType = (event as FeedItem).source_type ?? (event as HiladsEvent).source_type ?? 'hilads';
  const isPublic   = sourceType === 'ticketmaster';
  const host       = (event as HiladsEvent).host_nickname;

  return (
    <TouchableOpacity
      style={[styles.card, isRecurring && styles.cardRecurring]}
      activeOpacity={0.7}
      onPress={onPress}
    >
      <View style={styles.cardTitleRow}>
        <View style={styles.kindBadgeEvent}><Text style={styles.kindBadgeText}>Event</Text></View>
        {isPublic && <View style={styles.publicBadge}><Text style={styles.publicBadgeText}>Public</Text></View>}
        <Text style={styles.cardIcon}>{icon}</Text>
        <Text style={styles.cardTitle} numberOfLines={1}>{event.title}</Text>
        {!isPublic && (event.participant_count ?? 0) > 0 ? (
          <Text style={styles.goingCount}>🙌 {event.participant_count}</Text>
        ) : null}
      </View>

      <Text style={[styles.cardMetaLine, isLive && styles.cardMetaLineLive]} numberOfLines={1}>
        🕐 {formatTime(startsAt, tz)}{endsAt ? ` → ${formatTime(endsAt, tz)}` : ''}
        {event.recurrence_label ? `  ·  ↻ ${event.recurrence_label}` : ''}
      </Text>

      {distanceLabel ? (
        <Text style={styles.cardLocation} numberOfLines={1}>
          📍 {distanceLabel}
        </Text>
      ) : (event.location ?? event.venue) ? (
        <Text style={styles.cardLocation} numberOfLines={1}>
          📍 {event.location ?? event.venue}
        </Text>
      ) : null}

      {host ? (
        <Text style={styles.cardHost} numberOfLines={1}>
          Hosted by {host}
        </Text>
      ) : null}

      {!isPublic ? (
        <AttendeeAvatars
          preview={(event as HiladsEvent).participants_preview ?? []}
          total={event.participant_count ?? 0}
        />
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     Colors.border,
    padding:         10,
    gap:             4,
  },
  cardRecurring: {
    borderColor:     'rgba(184,114,40,0.35)',
    backgroundColor: 'rgba(184,114,40,0.04)',
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardIcon:     { fontSize: 16, lineHeight: 18 },
  cardTitle:    { flex: 1, fontSize: FontSizes.md, fontWeight: '700', color: Colors.text, lineHeight: 19 },
  goingCount:   { fontSize: FontSizes.xs, color: Colors.accent, fontWeight: '700', flexShrink: 0 },
  cardMetaLine:     { fontSize: FontSizes.xs, color: Colors.muted, fontWeight: '600' },
  cardMetaLineLive: { color: Colors.accent },
  cardLocation:     { fontSize: FontSizes.xs, color: Colors.muted, lineHeight: 16 },
  cardHost:         { fontSize: 11,           color: Colors.muted2, lineHeight: 14 },

  kindBadgeEvent: {
    backgroundColor:   'rgba(255,122,60,0.12)',
    borderRadius:      Radius.full,
    paddingHorizontal: 7,
    paddingVertical:   1,
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.22)',
  },
  kindBadgeText: { fontSize: 9, fontWeight: '700', color: Colors.accent, letterSpacing: 0.5 },

  publicBadge: {
    backgroundColor:   'rgba(255,255,255,0.07)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.10)',
    marginLeft:        6,
  },
  publicBadgeText: { fontSize: 10, fontWeight: '700', color: Colors.muted, letterSpacing: 0.3 },
});
