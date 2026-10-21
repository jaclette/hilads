/**
 * Edit a plan - host only. Differences from create.tsx:
 *   - The form is pre-filled from the fetched event (via useEventDetail).
 *   - No quick presets / no repeat selector (editing keeps the event as-is).
 *   - The location is a plain text field (create uses the map picker).
 *   - Save calls updateEvent() + router.back(); Delete asks with a native Alert.
 *   - Host-only: if !isOwner, bounce back to the event detail.
 */

import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { useApp } from '@/context/AppContext';
import { updateEvent, deleteEvent } from '@/api/events';
import { useEventDetail } from '@/hooks/useEventDetail';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Button, Chip, Screen, ScreenHeader, SectionTitle, TextField } from '@/ui';
import { CategoryPicker, DatePicker, TimePicker, type EventType, addDays, isSameDay, startOfDay, withDate } from '@/features/events/EventPickers';
import { goBack } from '@/lib/nav';

// ── Time helpers ──────────────────────────────────────────────────────────────

function fromUnix(sec: number): Date { return new Date(sec * 1000); }
function toUnix(d: Date): number     { return Math.floor(d.getTime() / 1000); }

// ── Screen ────────────────────────────────────────────────────────────────────

export default function EditEventScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const router          = useRouter();
  const { t }           = useTranslation('event');
  const { id }          = useLocalSearchParams<{ id: string }>();
  const { identity, account } = useApp();
  const guestId         = account?.guest_id ?? identity?.guestId ?? '';

  const { event, loading, isOwner } = useEventDetail(id);

  // ── Form state - seeded from the event once it loads.
  const [type,        setType]        = useState<EventType>('other');
  const [title,       setTitle]       = useState('');
  const [selectedDate,   setSelectedDate]   = useState<Date>(() => startOfDay(new Date()));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [startsAt,    setStartsAt]    = useState<Date>(() => new Date());
  const [endsAt,      setEndsAt]      = useState<Date>(() => new Date());
  const [location,    setLocation]    = useState('');
  const [seeded,      setSeeded]      = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  const [deleting,    setDeleting]    = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  // Seed form fields once when event arrives.
  useEffect(() => {
    if (seeded || !event) return;
    setType((event.event_type as EventType) ?? 'other');
    setTitle(event.title ?? '');
    setSelectedDate(startOfDay(fromUnix(event.starts_at)));
    setStartsAt(fromUnix(event.starts_at));
    setEndsAt(event.ends_at ? fromUnix(event.ends_at) : fromUnix(event.starts_at + 3600));
    setLocation(event.location ?? '');
    setSeeded(true);
  }, [event, seeded]);

  // Host-only: if loaded event ownership doesn't match, bounce back.
  useEffect(() => {
    if (!loading && event && !isOwner) {
      router.replace(`/event/${id}` as never);
    }
  }, [loading, event, isOwner, id, router]);

  async function handleSave() {
    if (!event)        { setError(t('errNotLoaded')); return; }
    if (!title.trim()) { setError(t('errTitle')); return; }

    const startUnix = toUnix(startsAt);
    const endDate   = new Date(endsAt);
    if (toUnix(endDate) <= startUnix) endDate.setDate(endDate.getDate() + 1);
    const endUnix = toUnix(endDate);

    if (endUnix - startUnix < 15 * 60) {
      setError(t('errDuration'));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await updateEvent(event.id, guestId, {
        title:         title.trim(),
        location_hint: location.trim() || null,
        starts_at:     startUnix,
        ends_at:       endUnix,
        type,
      });
      goBack();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('errUpdate'));
    } finally {
      setSubmitting(false);
    }
  }

  function handleDelete() {
    if (!event || deleting) return;
    Alert.alert(
      t('deleteTitle'),
      t('deleteBody'),
      [
        { text: t('cancel', { ns: 'common' }), style: 'cancel' },
        {
          text: t('deleteConfirm'), style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteEvent(event.id, guestId);
              // Event and its detail screen are gone - replace to the city channel
              // so back-gesture doesn't return to a 404.
              router.replace('/(tabs)/chat' as never);
            } catch (e: unknown) {
              setError(e instanceof Error ? e.message : t('errDelete'));
              setDeleting(false);
            }
          },
        },
      ],
    );
  }

  // Re-anchor start/end to the chosen day while preserving hours/minutes.
  function pickDate(d: Date) {
    const date = startOfDay(d);
    setSelectedDate(date);
    setStartsAt(prev => withDate(prev, date));
    setEndsAt(prev   => withDate(prev, date));
  }

  const today        = startOfDay(new Date());
  const tomorrow     = addDays(today, 1);
  const isToday      = isSameDay(selectedDate, today);
  const isTomorrow   = isSameDay(selectedDate, tomorrow);
  const isCustomDate = !isToday && !isTomorrow;
  const customDateLabel = selectedDate.toLocaleDateString(i18n.language, { weekday: 'short', month: 'short', day: 'numeric' });

  // ── Loading guard ───────────────────────────────────────────────────────────
  if (loading || !seeded) {
    return (
      <Screen>
        <ScreenHeader title={t('editEvent')} />
        <View style={styles.loadingBlock}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title={t('editEvent')} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── CATEGORY ──────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <SectionTitle small title={t('category')} />
          <CategoryPicker value={type} onChange={setType} />
        </View>

        {/* ── TITLE ─────────────────────────────────────────────────────────── */}
        <TextField
          label={t('title')}
          value={title}
          onChangeText={setTitle}
          placeholder={t('titlePlaceholder')}
          maxLength={100}
          autoCorrect={false}
        />

        {/* ── DATE ──────────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <SectionTitle small title={t('date')} />
          <View style={styles.chipRow}>
            <Chip variant="filter" label={t('today')} selected={isToday} onPress={() => pickDate(today)} />
            <Chip variant="filter" label={t('tomorrow')} selected={isTomorrow} onPress={() => pickDate(tomorrow)} />
            <Chip variant="filter" label={isCustomDate ? customDateLabel : t('pickDate')} selected={isCustomDate} onPress={() => setShowDatePicker(true)} />
          </View>
        </View>

        {showDatePicker && (
          <DatePicker
            value={selectedDate}
            onChange={pickDate}
            onClose={() => setShowDatePicker(false)}
            maxDays={180}
          />
        )}

        {/* ── STARTS / ENDS ─────────────────────────────────────────────────── */}
        <View style={styles.timeRow}>
          <TimePicker label={t('starts')} value={startsAt} onChange={setStartsAt} />
          <TimePicker label={t('ends')}   value={endsAt}   onChange={setEndsAt} />
        </View>

        {/* ── LOCATION ──────────────────────────────────────────────────────── */}
        <TextField
          label={t('location')}
          value={location}
          onChangeText={setLocation}
          placeholder={t('locationOptional')}
          maxLength={100}
          autoCorrect={false}
        />

        {error ? <Text style={styles.errorText} accessibilityRole="alert">{error}</Text> : null}

        {/* ── Save / Delete ─────────────────────────────────────────────────── */}
        <View style={styles.actions}>
          <Button label={t('saveChanges')} onPress={handleSave} loading={submitting} disabled={deleting} />
          <Button
            variant="danger"
            icon="trash-outline"
            label={t('deleteBtn')}
            onPress={handleDelete}
            loading={deleting}
            disabled={submitting}
            accessibilityLabel={t('deleteEvent')}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  scroll:       { flex: 1 },
  content:      { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: Spacing.xl, gap: 24 },
  loadingBlock: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  section:      { gap: 10 },
  chipRow:      { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  timeRow:      { flexDirection: 'row', gap: 12 },
  actions:      { gap: 10 },
  errorText:    { fontSize: FontSizes.sm, fontWeight: '600', color: c.red, textAlign: 'center' },
});
