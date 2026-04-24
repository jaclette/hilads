/**
 * EventPill — compact event row, reusable anywhere a single event needs to
 * be surfaced in a horizontal list-like form (profile screen, limit-reached
 * screen, etc.).
 *
 * Originally defined inline in app/user/[id].tsx; extracted here so other
 * screens don't re-implement the same visual.
 *
 * Renders: icon · title · [LIVE badge] · time · · location · chevron
 *
 * Tap behavior is owned by the parent via `onPress` so the same pill can
 * route to different destinations (event detail, back-stack pop, etc.).
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { HiladsEvent } from '@/types';
import { Colors, FontSizes, Radius, Spacing } from '@/constants';

// Icon map — mirrors the web's EVENT_ICONS in apps/web/src/cityMeta.js
const EVENT_ICONS: Record<string, string> = {
  drinks: '🍺', party: '🎉', nightlife: '🌙', music: '🎵',
  'live music': '🎸', culture: '🏛', art: '🎨', food: '🍴',
  coffee: '☕', sport: '⚽', meetup: '👋', other: '📌',
};

export function formatEventTime(ts: number): string {
  const d        = new Date(ts * 1000);
  const today    = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString())    return `Today · ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow · ${time}`;
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ` · ${time}`;
}

interface Props {
  event:    HiladsEvent;
  onPress:  () => void;
}

export function EventPill({ event, onPress }: Props) {
  const icon   = EVENT_ICONS[event.event_type] ?? '📌';
  const now    = Date.now() / 1000;
  const isLive = event.starts_at <= now && event.expires_at > now;
  return (
    <TouchableOpacity style={styles.eventPill} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.eventIcon}>{icon}</Text>
      <View style={styles.eventInfo}>
        <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
        <View style={styles.eventMeta}>
          {isLive && (
            <View style={styles.liveBadge}>
              <Text style={styles.liveBadgeText}>LIVE</Text>
            </View>
          )}
          <Text style={styles.eventTime}>{formatEventTime(event.starts_at)}</Text>
          {event.location ? (
            <Text style={styles.eventLocation} numberOfLines={1}>· {event.location}</Text>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
    </TouchableOpacity>
  );
}

// Re-exported so any screen that needs the icon lookup (e.g. custom renders)
// doesn't have to duplicate the map.
export { EVENT_ICONS };

const styles = StyleSheet.create({
  eventPill: {
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   Colors.bg2,
    borderRadius:      Radius.lg,
    borderWidth:       1,
    borderColor:       Colors.border,
    padding:           Spacing.md,
    gap:               10,
  },
  eventIcon:  { fontSize: 20 },
  eventInfo:  { flex: 1, gap: 2 },
  eventTitle: {
    fontSize:   FontSizes.sm,
    fontWeight: '700',
    color:      Colors.text,
  },
  eventMeta: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
  },
  eventTime:     { fontSize: FontSizes.xs, color: Colors.muted },
  eventLocation: { fontSize: FontSizes.xs, color: Colors.muted, flexShrink: 1 },
  liveBadge: {
    backgroundColor:   'rgba(61,220,132,0.12)',
    borderRadius:      Radius.full,
    paddingHorizontal: 6,
    paddingVertical:   2,
  },
  liveBadgeText: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         Colors.green,
    letterSpacing: 0.4,
  },
});
