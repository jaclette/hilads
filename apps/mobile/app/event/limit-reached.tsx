/**
 * Event limit reached — shown when a non-Legend user taps any "Create event"
 * CTA after they've already created their event today. Also reached from
 * app/event/create.tsx when the POST returns `event_limit_reached` (server
 * safety net against race conditions).
 *
 * Surfaces the event that's blocking so the user can tap through to
 * view / edit / delete it.
 */

import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { fetchMyEvents } from '@/api/events';
import { EventPill } from '@/features/events/EventPill';
import type { HiladsEvent } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

export default function EventLimitReachedScreen() {
  const router = useRouter();
  const { identity, city } = useApp();
  const [blockingEvent, setBlockingEvent] = useState<HiladsEvent | null>(null);

  // Fetch the user's event from "today" (user/city timezone). Same semantics
  // as the backend rule in EventRepository::guestCreatedEventTodayCount so
  // what's shown matches what's blocking.
  useEffect(() => {
    const guestId = identity?.guestId;
    if (!guestId) return;
    let cancelled = false;
    fetchMyEvents(guestId)
      .then(events => {
        if (cancelled) return;
        const tz = city?.timezone ?? 'UTC';
        const todays = pickTodaysEvent(events, tz);
        setBlockingEvent(todays);
      })
      .catch(() => { /* non-fatal — keep the screen useful without the pill */ });
    return () => { cancelled = true; };
  }, [identity?.guestId, city?.timezone]);

  function handleLegendInfo() {
    Alert.alert(
      '👑 Become a Legend',
      "Legends are locals chosen to keep their city alive — they can host as many events as they want. Want to become one? Reach out at contact@hilads.live.",
      [{ text: 'Got it', style: 'default' }],
    );
  }

  function handleOpenEvent() {
    if (!blockingEvent) return;
    router.push(`/event/${blockingEvent.id}` as never);
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* Header: back pill only — no title, clean hero layout */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/now')}
          activeOpacity={0.75}
        >
          <Ionicons name="chevron-back" size={20} color={Colors.text} />
        </TouchableOpacity>
      </View>

      {/* Centered hero */}
      <View style={styles.hero}>
        <Text style={styles.emoji}>🎉</Text>
        <Text style={styles.title}>You've already created your event today!</Text>
        <Text style={styles.body}>
          At Hilads, we keep things fresh — one event per day so every plan
          gets the attention it deserves. Come back tomorrow to create another
          one.
        </Text>

        {/* Blocking event — tap to open, edit, or delete. */}
        {blockingEvent && (
          <View style={styles.eventWrap}>
            <EventPill event={blockingEvent} onPress={handleOpenEvent} />
          </View>
        )}

        <TouchableOpacity
          style={styles.legendLink}
          onPress={handleLegendInfo}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Learn about becoming a Legend"
        >
          <Text style={styles.legendLinkText}>👑 Become a Legend to create unlimited events</Text>
        </TouchableOpacity>
      </View>

      {/* Primary action */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => router.replace('/(tabs)/now')}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Back to Now</Text>
        </TouchableOpacity>
      </View>

    </SafeAreaView>
  );
}

/**
 * Matches the backend's day-boundary rule: the event must have been created
 * on the current calendar day in the given timezone. Picks the most recent
 * if the user somehow created several (shouldn't happen with the 1/day
 * rule, but cheap to be defensive).
 */
function pickTodaysEvent(events: HiladsEvent[], tz: string): HiladsEvent | null {
  const today = formatYmdInTz(new Date(), tz);
  const todays = events
    .filter(e => e.source_type !== 'ticketmaster')
    .filter(e => formatYmdInTz(new Date((e.created_at ?? e.starts_at) * 1000), tz) === today);
  if (todays.length === 0) return null;
  return todays.reduce((a, b) =>
    (a.created_at ?? a.starts_at) > (b.created_at ?? b.starts_at) ? a : b,
  );
}

function formatYmdInTz(d: Date, tz: string): string {
  // en-CA locale gives 'YYYY-MM-DD' which is cheap to string-compare.
  return d.toLocaleDateString('en-CA', { timeZone: tz });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   12,
    minHeight:         56,
  },
  backBtn: {
    width:           40,
    height:          40,
    borderRadius:    12,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.10)',
    alignItems:      'center',
    justifyContent:  'center',
  },

  hero: {
    flex:              1,
    paddingHorizontal: Spacing.xl,
    alignItems:        'center',
    justifyContent:    'center',
    gap:               18,
  },
  emoji: {
    fontSize:  72,
    lineHeight: 84,
    marginBottom: 6,
  },
  title: {
    fontSize:      FontSizes.xl,
    fontWeight:    '800',
    color:         Colors.text,
    letterSpacing: -0.5,
    textAlign:     'center',
    paddingHorizontal: 12,
  },
  body: {
    fontSize:      FontSizes.md,
    lineHeight:    22,
    color:         Colors.muted,
    textAlign:     'center',
    paddingHorizontal: 8,
  },
  // EventPill container — stretches across the hero's available width so the
  // pill reads like a tappable card, not a narrow chip in the middle.
  eventWrap: {
    alignSelf: 'stretch',
    marginTop: 4,
  },
  legendLink: {
    marginTop:         6,
    paddingHorizontal: 16,
    paddingVertical:   10,
  },
  legendLinkText: {
    fontSize:      FontSizes.sm,
    color:         Colors.accent,
    fontWeight:    '600',
    textAlign:     'center',
  },

  footer: {
    paddingHorizontal: Spacing.xl,
    paddingBottom:     Spacing.xl,
    paddingTop:        Spacing.md,
  },
  primaryBtn: {
    backgroundColor: Colors.accent,
    borderRadius:    Radius.lg,
    paddingVertical: 17,
    alignItems:      'center',
    justifyContent:  'center',
    minHeight:       54,
  },
  primaryBtnText: {
    color:         Colors.white,
    fontSize:      FontSizes.md,
    fontWeight:    '700',
    letterSpacing: -0.2,
  },
});
