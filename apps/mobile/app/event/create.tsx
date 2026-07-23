/**
 * Create Event screen - faithful port of the web CreateEventModal.jsx
 *
 * Web source: apps/web/src/components/CreateEventModal.jsx
 *
 * Visual parity checklist:
 *   ✓ Thin line Ionicons (no emoji) - matches web SVG icon set
 *   ✓ Square-ish category chips (18px radius), orange border+bg on selected
 *   ✓ Square-ish repeat chips (12px radius), orange border+text on active
 *   ✓ STARTS/ENDS time fields side by side with ⏱ icon
 *   ✓ "Every N days" option + interval input when selected
 *   ✓ Orange (#FF7A3C) Create event button - not red
 */

import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Modal, Platform, Alert, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { Ionicons } from '@expo/vector-icons';
import { requestFeatureLocation } from '@/lib/geoFeature';
import { useApp } from '@/context/AppContext';
import { createEvent, createEventSeries } from '@/api/events';
import { FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { PrimaryButton } from '@/components/PrimaryButton';
import { LocationPicker } from '@/features/chat/LocationPicker';

// ── Types ─────────────────────────────────────────────────────────────────────

type EventType  = 'drinks' | 'party' | 'music' | 'food' | 'coffee' | 'sport' | 'meetup' | 'other';
type RepeatMode = 'once' | 'daily' | 'weekly' | 'every_n_days';

// ── Category config - Ionicons matching web SVG icons ─────────────────────────
// Web icons (custom SVGs): goblet, sun/star, note, fork+knife, cup, bolt, bubble, dots-grid

const CATEGORIES: {
  type:  EventType;
  icon:  React.ComponentProps<typeof Ionicons>['name'];
}[] = [
  { type: 'drinks',  icon: 'wine-outline'          },
  { type: 'party',   icon: 'sunny-outline'         },
  { type: 'music',   icon: 'musical-note-outline'  },
  { type: 'food',    icon: 'restaurant-outline'    },
  { type: 'coffee',  icon: 'cafe-outline'          },
  { type: 'sport',   icon: 'flash-outline'         },
  { type: 'meetup',  icon: 'chatbubble-outline'    },
  { type: 'other',   icon: 'grid-outline'          },
];

// ── Repeat options - matches web (Once/Daily/Weekly/Every N days) ─────────────

const REPEAT_OPTIONS: RepeatMode[] = ['once', 'daily', 'weekly', 'every_n_days'];
// Recurrence-only options shown when the Repeat section is expanded. "Once" is
// the implicit default (collapsed) - no chip for it; deselecting a recurrence
// chip returns to one-shot.
const RECURRENCE_OPTIONS: RepeatMode[] = ['daily', 'weekly', 'every_n_days'];

// ── Quick presets - one-tap recurring event shortcuts ─────────────────────────

type PresetKey = 'daily_spot' | 'every_evening' | 'weekends';

const PRESETS: { key: PresetKey; emoji: string }[] = [
  { key: 'daily_spot',    emoji: '☀️' },
  { key: 'every_evening', emoji: '🌙' },
  { key: 'weekends',      emoji: '🎉' },
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

function timeStr(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Replace the day-of-month/month/year on $time with the calendar date of $date. Time-of-day preserved. */
function withDate(time: Date, date: Date): Date {
  const out = new Date(time);
  out.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  return out;
}

// ── Inline time picker modal (no external deps) ───────────────────────────────

const MINUTE_STEPS = [0, 15, 30, 45];

function TimePicker({
  label, value, onChange,
}: { label: string; value: Date; onChange: (d: Date) => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [h, setH] = useState(value.getHours());
  const [m, setM] = useState(
    MINUTE_STEPS.includes(value.getMinutes()) ? value.getMinutes() : 0,
  );

  function open_() {
    setH(value.getHours());
    setM(MINUTE_STEPS.includes(value.getMinutes()) ? value.getMinutes() : 0);
    setOpen(true);
  }

  function confirm() {
    const next = new Date(value);
    next.setHours(h, m, 0, 0);
    onChange(next);
    setOpen(false);
  }

  const prevM = () => setM(mv => {
    const i = MINUTE_STEPS.indexOf(mv);
    return MINUTE_STEPS[(i - 1 + MINUTE_STEPS.length) % MINUTE_STEPS.length];
  });
  const nextM = () => setM(mv => {
    const i = MINUTE_STEPS.indexOf(mv);
    return MINUTE_STEPS[(i + 1) % MINUTE_STEPS.length];
  });

  return (
    <>
      <View style={styles.timeGroup}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <TouchableOpacity style={styles.timeBtn} onPress={open_} activeOpacity={0.75}>
          <Text style={styles.timeBtnText}>{timeStr(value)}</Text>
          <Ionicons name="time-outline" size={18} color={colors.muted} />
        </TouchableOpacity>
      </View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={styles.pickerBox} onStartShouldSetResponder={() => true}>
            <Text style={styles.pickerTitle}>{label}</Text>

            <View style={styles.pickerClock}>
              {/* Hours column */}
              <View style={styles.pickerCol}>
                <TouchableOpacity style={styles.pickerArrow} onPress={() => setH(v => (v + 1) % 24)}>
                  <Ionicons name="chevron-up" size={22} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.pickerVal}>{String(h).padStart(2, '0')}</Text>
                <TouchableOpacity style={styles.pickerArrow} onPress={() => setH(v => (v - 1 + 24) % 24)}>
                  <Ionicons name="chevron-down" size={22} color={colors.text} />
                </TouchableOpacity>
              </View>

              <Text style={styles.pickerColon}>:</Text>

              {/* Minutes column */}
              <View style={styles.pickerCol}>
                <TouchableOpacity style={styles.pickerArrow} onPress={nextM}>
                  <Ionicons name="chevron-up" size={22} color={colors.text} />
                </TouchableOpacity>
                <Text style={styles.pickerVal}>{String(m).padStart(2, '0')}</Text>
                <TouchableOpacity style={styles.pickerArrow} onPress={prevM}>
                  <Ionicons name="chevron-down" size={22} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity style={styles.pickerDone} onPress={confirm} activeOpacity={0.85}>
              <Text style={styles.pickerDoneText}>{t('done')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// ── Inline date picker modal ──────────────────────────────────────────────────
// Standalone component (not pulled in via a community lib) - month-grid view
// with prev/next month navigation. Past days and dates beyond `maxDays` ahead
// are visually disabled and unselectable. Matches the existing TimePicker
// modal's visual language so the form feels cohesive.

function DatePicker({
  value, onChange, onClose, maxDays = 180,
}: {
  value:    Date;
  onChange: (d: Date) => void;
  onClose:  () => void;
  maxDays?: number;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  // Month being displayed (anchor on the first of the month).
  const [view, setView] = useState<Date>(() => new Date(value.getFullYear(), value.getMonth(), 1));

  const today      = startOfDay(new Date());
  const maxDate    = startOfDay(addDays(today, maxDays));
  const monthLabel = view.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' });

  // Build the 6×7 grid for the displayed month. Cells outside the month are
  // rendered empty so the grid stays a clean rectangle.
  const firstOfMonth = new Date(view.getFullYear(), view.getMonth(), 1);
  const startOffset  = firstOfMonth.getDay(); // 0=Sun
  const daysInMonth  = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(view.getFullYear(), view.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);

  const prevMonth = () => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1));
  const nextMonth = () => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1));

  // Don't allow navigating before the current month or beyond the cap.
  const prevDisabled = view.getFullYear() === today.getFullYear() && view.getMonth() === today.getMonth();
  const nextDisabled = view.getFullYear() === maxDate.getFullYear() && view.getMonth() === maxDate.getMonth();

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.datePickerBox} onStartShouldSetResponder={() => true}>
          {/* Header - month nav */}
          <View style={styles.dpHeader}>
            <TouchableOpacity
              onPress={prevMonth} disabled={prevDisabled}
              style={[styles.dpNavBtn, prevDisabled && styles.dpNavBtnDisabled]}
            >
              <Ionicons name="chevron-back" size={20} color={prevDisabled ? colors.muted2 : colors.text} />
            </TouchableOpacity>
            <Text style={styles.dpTitle}>{monthLabel}</Text>
            <TouchableOpacity
              onPress={nextMonth} disabled={nextDisabled}
              style={[styles.dpNavBtn, nextDisabled && styles.dpNavBtnDisabled]}
            >
              <Ionicons name="chevron-forward" size={20} color={nextDisabled ? colors.muted2 : colors.text} />
            </TouchableOpacity>
          </View>

          {/* Day-of-week labels */}
          <View style={styles.dpRow}>
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
              <Text key={d} style={styles.dpDow}>{d}</Text>
            ))}
          </View>

          {/* Day grid */}
          {Array.from({ length: cells.length / 7 }).map((_, row) => (
            <View key={row} style={styles.dpRow}>
              {cells.slice(row * 7, row * 7 + 7).map((cell, i) => {
                if (!cell) return <View key={i} style={styles.dpCell} />;
                const disabled = cell < today || cell > maxDate;
                const selected = isSameDay(cell, value);
                return (
                  <TouchableOpacity
                    key={i}
                    style={[
                      styles.dpCell,
                      selected && styles.dpCellSelected,
                      disabled && styles.dpCellDisabled,
                    ]}
                    onPress={() => { if (!disabled) { onChange(cell); onClose(); } }}
                    activeOpacity={disabled ? 1 : 0.7}
                    disabled={disabled}
                  >
                    <Text style={[
                      styles.dpCellText,
                      disabled && styles.dpCellTextDisabled,
                      selected && styles.dpCellTextSelected,
                    ]}>{cell.getDate()}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}

          <TouchableOpacity style={styles.pickerDone} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.pickerDoneText}>{t('cancel')}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
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
    router.replace('/auth-gate?reason=create_event');
    return null;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{isLocal ? t('hostTitle') : t('createTitle')}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── QUICK PRESETS (locals only) ───────────────────────────────────── */}
        {isLocal && (
          <View style={styles.section}>
            <Text style={styles.fieldLabel}>{t('quickStart')}</Text>
            <View style={styles.presetRow}>
              {PRESETS.map(p => {
                const active = selectedPreset === p.key;
                return (
                  <TouchableOpacity
                    key={p.key}
                    style={[styles.presetBtn, active && styles.presetBtnActive]}
                    onPress={() => applyPreset(p.key)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.presetEmoji}>{p.emoji}</Text>
                    <Text style={[styles.presetLabel, active && styles.presetLabelActive]}>{t(`preset.${p.key}.label`)}</Text>
                    <Text style={styles.presetDesc}>{t(`preset.${p.key}.desc`)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* ── CATEGORY ──────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.fieldLabel}>{t('category')}</Text>
          <View style={styles.catGrid}>
            {CATEGORIES.map(cat => {
              const sel = cat.type === type;
              return (
                <TouchableOpacity
                  key={cat.type}
                  style={[styles.catChip, sel && styles.catChipSel]}
                  onPress={() => setType(cat.type)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={cat.icon}
                    size={26}
                    color={sel ? colors.accent : colors.muted}
                  />
                  <Text style={[styles.catLabel, sel && styles.catLabelSel]}>
                    {t(`cat.${cat.type}`)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── TITLE ─────────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.fieldLabel}>{t('title')}</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder={t('titlePlaceholder')}
            placeholderTextColor={colors.muted2}
            maxLength={100}
            autoCorrect={false}
          />
        </View>

        {/* ── DATE ──────────────────────────────────────────────────────────── */}
        {/* Default: Today (highlighted). One tap to flip to Tomorrow, or open
            a calendar to pick any day in the next 6 months. The "today is most
            visible" nudge below is intentionally subtle - keeps "today" the
            obvious path without blocking other days. */}
        <View style={styles.section}>
          <Text style={styles.fieldLabel}>{t('date')}</Text>
          <View style={styles.dateRow}>
            <TouchableOpacity
              style={[styles.dateChip, isToday && styles.dateChipActive]}
              onPress={() => pickDate(today)}
              activeOpacity={0.75}
            >
              <Text style={[styles.dateChipText, isToday && styles.dateChipTextActive]}>{t('today')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.dateChip, isTomorrow && styles.dateChipActive]}
              onPress={() => pickDate(tomorrow)}
              activeOpacity={0.75}
            >
              <Text style={[styles.dateChipText, isTomorrow && styles.dateChipTextActive]}>{t('tomorrow')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.dateChip, isCustomDate && styles.dateChipActive]}
              onPress={() => setShowDatePicker(true)}
              activeOpacity={0.75}
            >
              <Ionicons name="calendar-outline" size={14} color={isCustomDate ? colors.accent : colors.muted} />
              <Text style={[styles.dateChipText, isCustomDate && styles.dateChipTextActive]}>
                {isCustomDate ? customDateLabel : t('pickDate')}
              </Text>
              {isCustomDate && (
                <TouchableOpacity
                  onPress={() => pickDate(today)}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                  style={{ marginLeft: 4 }}
                >
                  <Ionicons name="close" size={14} color={colors.accent} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </View>
          {isToday && <Text style={styles.dateHint}>{t('todayHint')}</Text>}
        </View>

        {/* ── STARTS / ENDS ─────────────────────────────────────────────────── */}
        <View style={[styles.section, styles.timeRow]}>
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
          >
            <Text style={styles.fieldLabel}>{t('repeat')}</Text>
            <View style={styles.repeatHeaderRight}>
              {repeat !== 'once' && (
                <Text style={styles.repeatSummary}>{t(`repeatMode.${repeat}`)}</Text>
              )}
              <Ionicons name={repeatExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted2} />
            </View>
          </TouchableOpacity>

          {repeatExpanded && (
            <>
              <View style={styles.repeatRow}>
                {RECURRENCE_OPTIONS.map(mode => {
                  const active = mode === repeat;
                  return (
                    <TouchableOpacity
                      key={mode}
                      style={[styles.repeatChip, active && styles.repeatChipActive]}
                      // Tap the active chip again to go back to one-shot ('once').
                      onPress={() => setRepeat(active ? 'once' : mode)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.repeatLabel, active && styles.repeatLabelActive]}>
                        {t(`repeatMode.${mode}`)}
                      </Text>
                    </TouchableOpacity>
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
                  />
                  <Text style={styles.intervalLabel}>{t('days')}</Text>
                </View>
              )}
            </>
          )}
        </View>

        {/* ── LOCATION (tappable → map picker; optional) ────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.fieldLabel}>{t('location')}</Text>
          <TouchableOpacity
            style={styles.locField}
            activeOpacity={0.7}
            onPress={handleOpenLocation}
          >
            <Ionicons name="location-outline" size={18} color={location ? colors.accent : colors.muted2} />
            <Text style={[styles.locFieldText, !location && styles.locFieldPlaceholder]} numberOfLines={2}>
              {location || t('locationPlaceholder')}
            </Text>
            {location ? (
              <TouchableOpacity onPress={clearLocation} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close-circle" size={18} color={colors.muted2} />
              </TouchableOpacity>
            ) : (
              <Ionicons name="chevron-forward" size={16} color={colors.muted2} />
            )}
          </TouchableOpacity>
        </View>

        {/* ── Error ─────────────────────────────────────────────────────────── */}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* ── Submit ────────────────────────────────────────────────────────── */}
        <PrimaryButton
          label={
            isLocal
              ? (repeat !== 'once' ? t('submitOpenSpot') : t('submitStart'))
              : t('submitCreate')
          }
          onPress={handleSubmit}
          loading={submitting}
        />

        <View style={{ height: Spacing.xl }} />
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
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  scroll:    { flex: 1 },
  content:   { paddingHorizontal: 18, paddingTop: 20, gap: 28 },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 16,
    paddingVertical:   12,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    minHeight:         56,
  },
  backBtn: {
    width:           40,
    height:          40,
    borderRadius:    12,
    backgroundColor: c.overlay,
    borderWidth:     1,
    borderColor:     c.overlayStrong,
    alignItems:      'center',
    justifyContent:  'center',
    zIndex:          1,
  },
  headerCenter: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  headerTitle:  { fontSize: FontSizes.xl, fontWeight: '800', color: c.text, letterSpacing: -0.5 },

  // ── Field label - same uppercase tracking as web ──────────────────────────
  fieldLabel: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         c.muted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  // ── Section ───────────────────────────────────────────────────────────────
  section: { gap: 10 },

  // ── Category grid - 4 per row, square chips matching web ─────────────────
  catGrid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           10,
  },
  catChip: {
    // 4 per row with 10px gaps: (100% - 3*10) / 4 ≈ 22.5%
    // Use fixed calculation: content width = screen - 36px padding = ~360 on 396px screen
    // (360 - 30) / 4 = 82.5px - just use aspect ratio with flex
    flex:            0,
    width:           '22.5%',
    aspectRatio:     1,
    backgroundColor: c.bg2,
    borderRadius:    18,
    borderWidth:     1,
    borderColor:     c.border,
    alignItems:      'center',
    justifyContent:  'center',
    gap:             7,
  },
  catChipSel: {
    borderColor:     c.accent,
    backgroundColor: 'rgba(255,122,60,0.10)',
    // Subtle glow matching web box-shadow
    shadowColor:     c.accent,
    shadowOffset:    { width: 0, height: 0 },
    shadowOpacity:   0.25,
    shadowRadius:    8,
    elevation:       4,
  },
  catLabel: {
    fontSize:      9,
    fontWeight:    '700',
    color:         c.muted2,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  catLabelSel: { color: c.accent },

  // ── Text input - matching web dark input style ─────────────────────────────
  input: {
    backgroundColor:   c.bg2,
    borderRadius:      12,
    borderWidth:       1,
    borderColor:       c.border,
    paddingHorizontal: 16,
    paddingVertical:   Platform.OS === 'ios' ? 15 : 12,
    color:             c.text,
    fontSize:          FontSizes.md,
  },

  // Tappable location field - opens the map picker (mirrors `input` styling).
  locField: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               10,
    backgroundColor:   c.bg2,
    borderRadius:      12,
    borderWidth:       1,
    borderColor:       c.border,
    paddingHorizontal: 16,
    paddingVertical:   Platform.OS === 'ios' ? 14 : 12,
    minHeight:         52,
  },
  locFieldText:        { flex: 1, color: c.text, fontSize: FontSizes.md, lineHeight: 20 },
  locFieldPlaceholder: { color: c.muted2 },

  // ── Time pickers ──────────────────────────────────────────────────────────
  timeRow:   { flexDirection: 'row', gap: 14 },
  timeGroup: { flex: 1, gap: 10 },
  timeBtn: {
    backgroundColor:   c.bg2,
    borderRadius:      12,
    borderWidth:       1,
    borderColor:       c.border,
    paddingHorizontal: 16,
    paddingVertical:   Platform.OS === 'ios' ? 15 : 12,
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
  },
  timeBtnText: { fontSize: FontSizes.lg, fontWeight: '600', color: c.text },

  // ── Time picker modal ─────────────────────────────────────────────────────
  overlay: {
    flex:            1,
    backgroundColor: c.scrim,
    alignItems:      'center',
    justifyContent:  'center',
  },
  pickerBox: {
    backgroundColor: c.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     c.border,
    padding:         Spacing.lg,
    alignItems:      'center',
    gap:             12,
    minWidth:        230,
  },
  pickerTitle: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         c.muted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom:  4,
  },
  pickerClock: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pickerCol:   { alignItems: 'center', gap: 4 },
  pickerArrow: { padding: 8 },
  pickerVal:   {
    fontSize:   40,
    fontWeight: '700',
    color:      c.text,
    minWidth:   64,
    textAlign:  'center',
  },
  pickerColon: { fontSize: 36, fontWeight: '700', color: c.muted, marginBottom: 4 },
  pickerDone: {
    marginTop:         8,
    backgroundColor:   c.accent,
    borderRadius:      Radius.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical:   Spacing.sm,
    alignSelf:         'stretch',
    alignItems:        'center',
  },
  pickerDoneText: { color: c.white, fontWeight: '700', fontSize: FontSizes.md },

  // ── Date selector chips (Today / Tomorrow / Pick a date) ─────────────────
  dateRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  dateChip: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               6,
    paddingHorizontal: 14,
    paddingVertical:   10,
    backgroundColor:   c.bg2,
    borderRadius:      12,
    borderWidth:       1,
    borderColor:       c.border,
  },
  dateChipActive: {
    borderColor:     c.accent,
    backgroundColor: 'rgba(255,122,60,0.08)',
  },
  dateChipText:        { fontSize: FontSizes.md, color: c.muted, fontWeight: '600' },
  dateChipTextActive:  { color: c.accent, fontWeight: '700' },
  dateHint:            { fontSize: FontSizes.xs, color: c.muted2, marginTop: 8 },

  // ── Inline date-picker modal ─────────────────────────────────────────────
  datePickerBox: {
    backgroundColor: c.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     c.border,
    padding:         Spacing.lg,
    gap:             6,
    width:           320,
    maxWidth:        '90%',
  },
  dpHeader: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    paddingBottom:  Spacing.sm,
  },
  dpTitle: { fontSize: FontSizes.md, fontWeight: '700', color: c.text },
  dpNavBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.bg3,
  },
  dpNavBtnDisabled: { opacity: 0.3 },
  dpRow: { flexDirection: 'row', justifyContent: 'space-between' },
  dpDow: {
    width:      36,
    textAlign:  'center',
    fontSize:   11,
    fontWeight: '700',
    color:      c.muted2,
    letterSpacing: 0.5,
    paddingVertical: 6,
  },
  dpCell: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  dpCellSelected: { backgroundColor: c.accent },
  dpCellDisabled: { opacity: 0.25 },
  dpCellText:         { fontSize: FontSizes.sm, color: c.text, fontWeight: '600' },
  dpCellTextSelected: { color: c.white, fontWeight: '800' },
  dpCellTextDisabled: { color: c.muted2 },

  // ── Quick presets ─────────────────────────────────────────────────────────
  presetRow: { flexDirection: 'row', gap: 8 },
  presetBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 14,
    backgroundColor: c.bg2, borderRadius: 14,
    borderWidth: 1, borderColor: c.border, gap: 4,
  },
  presetBtnActive: {
    borderColor: c.accent,
    backgroundColor: 'rgba(255,122,60,0.08)',
  },
  presetEmoji: { fontSize: 20 },
  presetLabel: { fontSize: FontSizes.sm, fontWeight: '700', color: c.muted },
  presetLabelActive: { color: c.accent },
  presetDesc:  { fontSize: 10, color: c.muted2, textAlign: 'center' },

  // ── Repeat chips - square-ish matching web (not pill) ─────────────────────
  repeatHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  repeatHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  repeatSummary: { fontSize: 13, fontWeight: '700', color: c.accent },
  repeatRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 },
  repeatChip: {
    paddingHorizontal: 16,
    paddingVertical:   11,
    borderRadius:      12,
    backgroundColor:   c.bg2,
    borderWidth:       1,
    borderColor:       c.border,
    minWidth:          68,
    alignItems:        'center',
  },
  repeatChipActive: {
    borderColor:     c.accent,
    backgroundColor: 'rgba(255,122,60,0.08)',
  },
  repeatLabel:       { fontSize: FontSizes.md, color: c.muted, fontWeight: '500' },
  repeatLabelActive: { color: c.accent, fontWeight: '700' },

  // ── "Every N days" interval input ─────────────────────────────────────────
  intervalRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           10,
    marginTop:     8,
  },
  intervalLabel: { fontSize: FontSizes.md, color: c.muted },
  intervalInput: {
    backgroundColor:   c.bg2,
    borderRadius:      10,
    borderWidth:       1,
    borderColor:       c.border,
    paddingHorizontal: 14,
    paddingVertical:   Platform.OS === 'ios' ? 10 : 7,
    color:             c.text,
    fontSize:          FontSizes.lg,
    fontWeight:        '600',
    minWidth:          60,
    textAlign:         'center',
  },
  repeatNote: { fontSize: FontSizes.xs, color: c.accent3, marginTop: 6 },

  // ── Error ─────────────────────────────────────────────────────────────────
  errorText: { fontSize: FontSizes.sm, color: c.red, textAlign: 'center' },

});
