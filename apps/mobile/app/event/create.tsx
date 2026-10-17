/**
 * Create a plan (event): category, title, day, start / end, repeat, location.
 * Locals also get one-tap recurring presets. The day and time pickers are
 * shared with the edit screen (features/events/EventPickers).
 */

import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { Ionicons } from '@expo/vector-icons';
import { requestFeatureLocation } from '@/lib/geoFeature';
import { useApp } from '@/context/AppContext';
import { createEvent, createEventSeries } from '@/api/events';
import { Border, FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Button, Chip, Screen, ScreenHeader, SectionTitle, TextField } from '@/ui';
import { LocationPicker } from '@/features/chat/LocationPicker';
import { CategoryPicker, DatePicker, TimePicker, type EventType, addDays, isSameDay, startOfDay, timeStr, withDate } from '@/features/events/EventPickers';

// ── Types ─────────────────────────────────────────────────────────────────────

type RepeatMode = 'once' | 'daily' | 'weekly' | 'every_n_days';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// Recurrence options shown when the Repeat section is expanded. "Once" is the
// implicit default (collapsed) - no chip for it; deselecting a recurrence
// chip returns to one-shot.
const RECURRENCE_OPTIONS: RepeatMode[] = ['daily', 'weekly', 'every_n_days'];

// ── Quick presets - one-tap recurring event shortcuts ─────────────────────────

type PresetKey = 'daily_spot' | 'every_evening' | 'weekends';

const PRESETS: { key: PresetKey; icon: IconName }[] = [
  { key: 'daily_spot',    icon: 'sunny-outline'    },
  { key: 'every_evening', icon: 'moon-outline'     },
  { key: 'weekends',      icon: 'calendar-outline' },
];

// ── Time helpers ──────────────────────────────────────────────────────────────

function nextHalfHour(): Date {
  const now = new Date();
  const m   = now.getMinutes();
  if (m < 30) { now.setMinutes(30, 0, 0); }
  else        { now.setHours(now.getHours() + 1, 0, 0, 0); }
  return now;
}

function addHours(d: Date, h: number): Date {
  return new Date(d.getTime() + h * 3_600_000);
}

function toUnix(d: Date): number { return Math.floor(d.getTime() / 1000); }

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function CreateEventScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const router = useRouter();
  const { t } = useTranslation('event');
  const { city, identity, account } = useApp();

  const nickname = account?.display_name ?? identity?.nickname ?? '';
  const guestId  = account?.guest_id ?? identity?.guestId ?? '';

  // ── Form state
  const [type,            setType]            = useState<EventType>('other');
  const [title,           setTitle]           = useState('');
  // selectedDate carries the day-of-month for the event. Time-of-day lives on
  // startsAt / endsAt (still full Date objects so the existing TimePicker
  // doesn't need a refactor - it just sets H/M and preserves the date). We
  // re-sync the day on startsAt / endsAt every time selectedDate flips below.
  const [selectedDate,    setSelectedDate]    = useState<Date>(() => startOfDay(new Date()));
  const [showDatePicker,  setShowDatePicker]  = useState(false);
  const [startsAt,        setStartsAt]        = useState<Date>(() => nextHalfHour());
  const [endsAt,          setEndsAt]          = useState<Date>(() => addHours(nextHalfHour(), 2));
  const [repeat,          setRepeat]          = useState<RepeatMode>('once');
  // Repeat section is collapsed by default (one-shot). Expands to reveal the
  // recurrence options; auto-expanded when a recurrence is already set (edit/preset).
  const [repeatExpanded,  setRepeatExpanded]  = useState(false);
  const [weekdays,        setWeekdays]        = useState<number[]>(() => [new Date().getDay()]);
  const [intervalDays,    setIntervalDays]    = useState('7');
  const [location,        setLocation]        = useState('');                 // address label (display + location_hint)
  const [locationCoords,  setLocationCoords]  = useState<{ lat: number; lng: number } | null>(null);
  const [showLocPicker,   setShowLocPicker]   = useState(false);
  const [locPickerCenter, setLocPickerCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [locPickerAuto,   setLocPickerAuto]   = useState(true);                // false when re-editing a chosen spot
  const [submitting,      setSubmitting]      = useState(false);
  const [error,           setError]           = useState<string | null>(null);
  const [selectedPreset,  setSelectedPreset]  = useState<PresetKey | null>(null);

  /**
   * Setting the date re-anchors startsAt / endsAt to the new day while
   * keeping their hours/minutes intact - so a user who picks "Tomorrow"
   * after configuring the time pickers doesn't have to redo them.
   */
  function pickDate(d: Date) {
    const date = startOfDay(d);
    setSelectedDate(date);
    setStartsAt(prev => withDate(prev, date));
    setEndsAt(prev   => withDate(prev, date));
  }

  const today    = startOfDay(new Date());
  const tomorrow = addDays(today, 1);
  const isToday    = isSameDay(selectedDate, today);
  const isTomorrow = isSameDay(selectedDate, tomorrow);
  const isCustomDate = !isToday && !isTomorrow;
  const customDateLabel = selectedDate.toLocaleDateString(i18n.language, { weekday: 'short', month: 'short', day: 'numeric' });

  function applyPreset(key: PresetKey) {
    setSelectedPreset(prev => prev === key ? null : key);
    if (selectedPreset === key) return; // toggle off
    setRepeatExpanded(true); // presets set a recurrence → reveal the Repeat options
    if (key === 'daily_spot') {
      setRepeat('daily');
      const s = new Date(); s.setHours(18, 0, 0, 0); setStartsAt(s);
      const e = new Date(); e.setHours(21, 0, 0, 0); setEndsAt(e);
    } else if (key === 'every_evening') {
      setRepeat('daily');
      const s = new Date(); s.setHours(20, 0, 0, 0); setStartsAt(s);
      const e = new Date(); e.setHours(23, 0, 0, 0); setEndsAt(e);
    } else if (key === 'weekends') {
      setRepeat('weekly');
      setWeekdays([6, 0]); // Sat + Sun
    }
  }

  const isLocal = account?.mode === 'local';

  // Open the shared map picker. Re-edit: center on the prior spot and DON'T
  // auto-locate (so it stays there). New: request permission, seed with
  // last-known position, and let the picker refine to precise GPS.
  async function handleOpenLocation() {
    if (locationCoords) {
      setLocPickerCenter(locationCoords);
      setLocPickerAuto(false);
      setShowLocPicker(true);
      return;
    }
    const geo = await requestFeatureLocation('event_location');
    if (!geo.ok) {
      if (geo.permanentlyDenied) {
        Alert.alert(t('locPermTitle'), t('locPermSettings'), [
          { text: t('cancel', { ns: 'common' }), style: 'cancel' },
          { text: t('openSettings', { ns: 'common' }), onPress: () => Linking.openSettings() },
        ]);
      } else if (geo.reason === 'denied') {
        Alert.alert(t('locNeededTitle'), t('locMapBody'));
      }
      return;
    }
    setLocPickerCenter(geo.coords ?? { lat: 0, lng: 0 });
    setLocPickerAuto(true);
    setShowLocPicker(true);
  }

  function handleLocationConfirm({ place, address, lat, lng }: { place: string; address: string; lat: number; lng: number }) {
    setShowLocPicker(false);
    // Prefer the human address; fall back to the place name. Both feed the
    // location_hint text; coords are stored separately for precise maps links.
    const label = address ? (place && !address.startsWith(place) ? `${place} - ${address}` : address) : place;
    setLocation(label);
    setLocationCoords({ lat, lng });
  }

  function clearLocation() {
    setLocation('');
    setLocationCoords(null);
  }

  async function handleSubmit() {
    if (!city)        { setError(t('errNoCity')); return; }
    if (!title.trim()) { setError(t('errTitle')); return; }

    // Build end unix; advance to next day if end ≤ start (crosses midnight)
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
      if (repeat === 'once') {
        const event = await createEvent(
          city.channelId, guestId, nickname,
          title.trim(), location.trim() || undefined,
          startUnix, endUnix, type,
          locationCoords?.lat, locationCoords?.lng,
        );
        router.replace(`/event/${event.id}`);
      } else {
        const iDays = parseInt(intervalDays, 10);
        const { first_event } = await createEventSeries(
          city.channelId,
          guestId,
          {
            title:           title.trim(),
            start_time:      timeStr(startsAt),
            end_time:        timeStr(endsAt),
            type,
            recurrence_type: repeat === 'weekly'
              ? 'weekly'
              : repeat === 'every_n_days'
                ? 'every_n_days'
                : 'daily',
            // Weekly weekdays: presets like "weekends" set multi-day arrays
            // explicitly - keep those. Otherwise (single-day default state),
            // always re-derive from the picked start date so a user creating
            // a "weekly" event on Wed but starting it next Thu gets a Thursday
            // recurrence, not a Wednesday one. Mobile has no day-picker UI;
            // the start date IS the weekday choice.
            ...(repeat === 'weekly'       ? { weekdays: weekdays.length > 1 ? weekdays : [selectedDate.getDay()] } : {}),
            ...(repeat === 'every_n_days' ? { interval_days: iDays >= 2 ? iDays : 7 } : {}),
            // Anchors the recurrence series to the picked start date - so a
            // weekly series starting "next Saturday" actually starts then,
            // and an every-7-days series counts intervals from there.
            starts_on:    ymd(selectedDate),
            location_hint: location.trim() || undefined,
          },
        );
        router.replace(`/event/${first_event.id}`);
      }
    } catch (e: unknown) {
      // Server safety net for the 1-event-per-day rule. If the preflight at
      // the CTA was stale (or the client skipped it), route to the same
      // friendly limit screen instead of showing a red error.
      const body = (e as { body?: { error?: string } } | null)?.body ?? null;
      if (body?.error === 'event_limit_reached') {
        router.replace('/event/limit-reached' as never);
        return;
      }
      setError(e instanceof Error ? e.message : t('errFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  // ── Guest gate - event creation requires a registered account ───────────────
  if (!account) {
    router.replace('/auth-gate?reason=create_event&returnTo=%2Fevent%2Fcreate' as never);
    return null;
  }


  return (
    <Screen>
      <ScreenHeader title={isLocal ? t('hostTitle') : t('createTitle')} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── QUICK PRESETS (locals only) ───────────────────────────────────── */}
        {isLocal && (
          <View style={styles.section}>
            <SectionTitle small title={t('quickStart')} />
            <View style={styles.presetRow}>
              {PRESETS.map(p => {
                const active = selectedPreset === p.key;
                return (
                  <TouchableOpacity
                    key={p.key}
                    style={[styles.tile, styles.presetTile, active && styles.tileOn]}
                    onPress={() => applyPreset(p.key)}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Ionicons name={p.icon} size={22} color={active ? colors.primaryText : colors.muted} />
                    <Text style={[styles.tileLabel, active && styles.tileLabelOn]}>{t(`preset.${p.key}.label`)}</Text>
                    <Text style={styles.presetDesc}>{t(`preset.${p.key}.desc`)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

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
        {/* Default: Today. One tap to flip to Tomorrow, or open a calendar to
            pick any day in the next 6 months. */}
        <View style={styles.section}>
          <SectionTitle small title={t('date')} />
          <View style={styles.chipRow}>
            <Chip variant="filter" label={t('today')} selected={isToday} onPress={() => pickDate(today)} />
            <Chip variant="filter" label={t('tomorrow')} selected={isTomorrow} onPress={() => pickDate(tomorrow)} />
            <Chip variant="filter" label={isCustomDate ? customDateLabel : t('pickDate')} selected={isCustomDate} onPress={() => setShowDatePicker(true)} />
            {isCustomDate && (
              <TouchableOpacity style={styles.clearDate} onPress={() => pickDate(today)} accessibilityRole="button"
                                accessibilityLabel={t('clear', { ns: 'common', defaultValue: 'Clear' })}>
                <Ionicons name="close" size={18} color={colors.muted} />
              </TouchableOpacity>
            )}
          </View>
          {isToday && <Text style={styles.hint}>{t('todayHint')}</Text>}
        </View>

        {/* ── STARTS / ENDS ─────────────────────────────────────────────────── */}
        <View style={styles.timeRow}>
          <TimePicker
            label={t('starts')}
            value={startsAt}
            onChange={d => { setStartsAt(d); setEndsAt(addHours(d, 2)); }}
          />
          <TimePicker label={t('ends')} value={endsAt} onChange={setEndsAt} />
        </View>

        {showDatePicker && (
          <DatePicker
            value={selectedDate}
            onChange={pickDate}
            onClose={() => setShowDatePicker(false)}
            maxDays={180}
          />
        )}

        {/* ── REPEAT (collapsed = one-shot; expand to pick a recurrence) ──────── */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.repeatHeader}
            activeOpacity={0.7}
            onPress={() => setRepeatExpanded(v => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: repeatExpanded }}
          >
            <SectionTitle small title={t('repeat')} />
            <View style={styles.repeatHeaderRight}>
              {repeat !== 'once' && <Text style={styles.repeatSummary}>{t(`repeatMode.${repeat}`)}</Text>}
              <Ionicons name={repeatExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
            </View>
          </TouchableOpacity>

          {repeatExpanded && (
            <>
              <View style={styles.chipRow}>
                {RECURRENCE_OPTIONS.map(mode => {
                  const active = mode === repeat;
                  return (
                    <Chip
                      key={mode}
                      variant="filter"
                      label={t(`repeatMode.${mode}`)}
                      selected={active}
                      // Tap the active chip again to go back to one-shot ('once').
                      onPress={() => setRepeat(active ? 'once' : mode)}
                    />
                  );
                })}
              </View>

              {/* "Every N days" interval input */}
              {repeat === 'every_n_days' && (
                <View style={styles.intervalRow}>
                  <Text style={styles.intervalLabel}>{t('every')}</Text>
                  <TextInput
                    style={styles.intervalInput}
                    value={intervalDays}
                    onChangeText={v => setIntervalDays(v.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    maxLength={3}
                    accessibilityLabel={`${t('every')} ${t('days')}`}
                  />
                  <Text style={styles.intervalLabel}>{t('days')}</Text>
                </View>
              )}
            </>
          )}
        </View>

        {/* ── LOCATION (tappable → map picker; optional) ────────────────────── */}
        <View style={styles.section}>
          <SectionTitle small title={t('location')} />
          <View style={styles.locField}>
            <TouchableOpacity style={styles.locMain} activeOpacity={0.7} onPress={handleOpenLocation} accessibilityRole="button"
                              accessibilityLabel={location || t('locationPlaceholder')}>
              <Ionicons name="location-outline" size={20} color={location ? colors.primaryText : colors.muted} />
              <Text style={[styles.locText, !location && styles.locPlaceholder]} numberOfLines={2}>
                {location || t('locationPlaceholder')}
              </Text>
              {!location && <Ionicons name="chevron-forward" size={18} color={colors.muted} />}
            </TouchableOpacity>
            {!!location && (
              <TouchableOpacity style={styles.locClear} onPress={clearLocation} accessibilityRole="button"
                                accessibilityLabel={t('clear', { ns: 'common', defaultValue: 'Clear' })}>
                <Ionicons name="close-circle" size={20} color={colors.muted} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ── Error ─────────────────────────────────────────────────────────── */}
        {error ? <Text style={styles.errorText} accessibilityRole="alert">{error}</Text> : null}

        {/* ── Submit ────────────────────────────────────────────────────────── */}
        <Button
          label={
            isLocal
              ? (repeat !== 'once' ? t('submitOpenSpot') : t('submitStart'))
              : t('submitCreate')
          }
          onPress={handleSubmit}
          loading={submitting}
        />
      </ScrollView>

      {/* ── Map location picker (shared with drop-my-spot) ── */}
      {showLocPicker && locPickerCenter && (
        <LocationPicker
          visible={showLocPicker}
          initialLat={locPickerCenter.lat}
          initialLng={locPickerCenter.lng}
          autoLocate={locPickerAuto}
          onConfirm={handleLocationConfirm}
          onClose={() => setShowLocPicker(false)}
        />
      )}
    </Screen>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  scroll:  { flex: 1 },
  content: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: Spacing.xl, gap: 24 },
  section: { gap: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  hint:    { fontSize: FontSizes.xs, fontWeight: '500', color: c.muted },

  // Preset tiles
  tile:        { alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: Radius.card, borderWidth: Border,
                 borderColor: c.line, backgroundColor: c.bg2 },
  tileOn:      { borderColor: c.primary, backgroundColor: c.primaryTint },
  tileLabel:   { fontSize: 12, fontWeight: '700', color: c.muted },
  tileLabelOn: { color: c.primaryOnTint },
  presetRow:   { flexDirection: 'row', gap: 8 },
  presetTile:  { flex: 1, paddingVertical: 14, paddingHorizontal: 6 },
  presetDesc:  { fontSize: 11, fontWeight: '500', color: c.muted, textAlign: 'center' },

  clearDate: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  timeRow: { flexDirection: 'row', gap: 12 },

  repeatHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  repeatHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  repeatSummary:     { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryText },
  intervalRow:       { flexDirection: 'row', alignItems: 'center', gap: 10 },
  intervalLabel:     { fontSize: FontSizes.md, fontWeight: '500', color: c.muted },
  intervalInput:     { minWidth: 64, minHeight: 48, paddingHorizontal: 14, borderRadius: Radius.button, borderWidth: Border, borderColor: c.line,
                       backgroundColor: c.bg2, color: c.text, fontSize: FontSizes.lg, fontWeight: '700', textAlign: 'center' },

  // Tappable location field - opens the map picker (looks like a TextField).
  locField:       { flexDirection: 'row', alignItems: 'center', minHeight: 52, borderRadius: Radius.button, borderWidth: Border,
                    borderColor: c.line, backgroundColor: c.bg2 },
  locMain:        { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 14, paddingVertical: 10 },
  locText:        { flex: 1, fontSize: FontSizes.md, fontWeight: '500', color: c.text },
  locPlaceholder: { color: c.mutedDim },
  locClear:       { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  errorText: { fontSize: FontSizes.sm, fontWeight: '600', color: c.red, textAlign: 'center' },
});
