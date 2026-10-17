/**
 * Event limit reached - shown when a non-Legend user taps any "Create event"
 * CTA after they've already created their event today. Also reached from
 * app/event/create.tsx when the POST returns `event_limit_reached` (server
 * safety net against race conditions).
 *
 * Surfaces the event that's blocking so the user can tap through to
 * view / edit / delete it.
 */

import { useEffect, useState } from 'react';
import { View, ScrollView, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/context/AppContext';
import { fetchMyEvents } from '@/api/events';
import { EventPill } from '@/features/events/EventPill';
import type { HiladsEvent } from '@/types';
import { Spacing } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { Button, EmptyState, Screen, ScreenHeader } from '@/ui';

export default function EventLimitReachedScreen() {
  const styles = useThemedStyles(makeStyles);

  const router = useRouter();
  const { t } = useTranslation('event');
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
      .catch(() => { /* non-fatal - keep the screen useful without the pill */ });
    return () => { cancelled = true; };
  }, [identity?.guestId, city?.timezone]);

  function handleLegendInfo() {
    Alert.alert(
      t('limit.legendAlertTitle'),
      t('limit.legendAlertBody'),
      [{ text: t('limit.gotIt'), style: 'default' }],
    );
  }

  function handleOpenEvent() {
    if (!blockingEvent) return;
    router.push(`/event/${blockingEvent.id}` as never);
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title="" onBack={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/events')} />

      <ScrollView contentContainerStyle={styles.hero}>
        <EmptyState
          icon="calendar-outline"
          title={t('limit.title')}
          body={t('limit.body')}
          action={
            <View style={styles.actions}>
              {/* Blocking event - tap to open, edit, or delete. */}
              {blockingEvent && <EventPill event={blockingEvent} onPress={handleOpenEvent} />}
              <Button variant="link" label={t('limit.legendLink')} onPress={handleLegendInfo} accessibilityLabel={t('limit.legendA11y')} />
            </View>
          }
        />
      </ScrollView>

      <View style={styles.footer}>
        <Button label={t('limit.backToNow')} onPress={() => router.replace('/(tabs)/events')} />
      </View>
    </Screen>
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

const makeStyles = () => StyleSheet.create({
  hero:    { flexGrow: 1, justifyContent: 'center', paddingHorizontal: Spacing.lg },
  actions: { alignSelf: 'stretch', gap: Spacing.sm, marginTop: Spacing.sm },
  footer:  { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.md },
});
