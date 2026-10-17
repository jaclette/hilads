/**
 * EventPill - compact event row, reusable anywhere a single event needs to
 * be surfaced in a horizontal list-like form (profile screen, limit-reached
 * screen, etc.).
 *
 * Originally defined inline in app/user/[id].tsx; extracted here so other
 * screens don't re-implement the same visual.
 *
 * Renders: stroke icon · title · [LIVE badge] · time · · location · chevron
 *
 * Tap behavior is owned by the parent via `onPress` so the same pill can
 * route to different destinations (event detail, back-stack pop, etc.).
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { Ionicons } from '@expo/vector-icons';
import type { HiladsEvent } from '@/types';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// Stroke icon per event type: the plan categories (same as the create form)
// plus the imported-event types (nightlife, live music, culture, art).
const EVENT_ICONS: Record<string, IconName> = {
  drinks: 'wine-outline', party: 'sunny-outline', nightlife: 'moon-outline', music: 'musical-note-outline',
  'live music': 'musical-notes-outline', culture: 'business-outline', art: 'color-palette-outline', food: 'restaurant-outline',
  coffee: 'cafe-outline', sport: 'flash-outline', meetup: 'chatbubble-outline', other: 'grid-outline',
};

export function eventIcon(type: string | null | undefined): IconName {
  return (type && EVENT_ICONS[type]) || 'calendar-outline';
}

export function formatEventTime(ts: number): string {
  const d        = new Date(ts * 1000);
  const today    = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const time = d.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString())    return `${i18n.t('time.today', { ns: 'common' })} · ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `${i18n.t('time.tomorrow', { ns: 'common' })} · ${time}`;
  return d.toLocaleDateString(i18n.language, { weekday: 'short', month: 'short', day: 'numeric' }) + ` · ${time}`;
}

interface Props {
  event:    HiladsEvent;
  onPress:  () => void;
}

export function EventPill({ event, onPress }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const { t } = useTranslation('common');
  const now    = Date.now() / 1000;
  const isLive = event.starts_at <= now && event.expires_at > now;
  return (
    <TouchableOpacity style={styles.eventPill} onPress={onPress} activeOpacity={0.7} accessibilityRole="button">
      <View style={styles.eventIcon}>
        <Ionicons name={eventIcon(event.event_type)} size={18} color={colors.primaryOnTint} />
      </View>
      <View style={styles.eventInfo}>
        <Text style={styles.eventTitle} numberOfLines={1}>{event.title}</Text>
        <View style={styles.eventMeta}>
          {isLive && (
            <View style={styles.liveBadge}>
              <Text style={styles.liveBadgeText}>{t('live')}</Text>
            </View>
          )}
          {!isLive && event.is_past && (
            <View style={styles.pastBadge}>
              <Text style={styles.pastBadgeText}>{t('past')}</Text>
            </View>
          )}
          <Text style={styles.eventTime}>{formatEventTime(event.starts_at)}</Text>
          {event.location ? (
            <Text style={styles.eventLocation} numberOfLines={1}>· {event.location}</Text>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  eventPill: {
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   c.bg2,
    borderRadius:      Radius.card,
    borderWidth:       1.5,
    borderColor:       c.line,
    padding:           14,
    minHeight:         56,
    gap:               10,
  },
  eventIcon:  { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  eventInfo:  { flex: 1, gap: 2 },
  eventTitle: {
    fontSize:   FontSizes.sm,
    fontWeight: '700',
    color:      c.text,
  },
  eventMeta: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
  },
  eventTime:     { fontSize: FontSizes.xs, fontWeight: '500', color: c.muted },
  eventLocation: { fontSize: FontSizes.xs, fontWeight: '500', color: c.muted, flexShrink: 1 },
  liveBadge: {
    backgroundColor:   c.localBg,
    borderRadius:      Radius.full,
    paddingHorizontal: 6,
    paddingVertical:   2,
  },
  liveBadgeText: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         c.localText,
    letterSpacing: 0.4,
  },
  pastBadge: {
    backgroundColor:   c.bg3,
    borderRadius:      Radius.full,
    paddingHorizontal: 6,
    paddingVertical:   2,
  },
  pastBadgeText: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         c.muted,
    letterSpacing: 0.4,
  },
});
