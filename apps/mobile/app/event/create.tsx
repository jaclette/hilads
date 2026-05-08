/**
 * Create Event screen — faithful port of the web CreateEventModal.jsx
 *
 * Web source: apps/web/src/components/CreateEventModal.jsx
 *
 * Visual parity checklist:
 *   ✓ Thin line Ionicons (no emoji) — matches web SVG icon set
 *   ✓ Square-ish category chips (18px radius), orange border+bg on selected
 *   ✓ Square-ish repeat chips (12px radius), orange border+text on active
 *   ✓ STARTS/ENDS time fields side by side with ⏱ icon
 *   ✓ "Every N days" option + interval input when selected
 *   ✓ Orange (#FF7A3C) Create event button — not red
 */

import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Modal, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { createEvent, createEventSeries } from '@/api/events';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

// ── Types ─────────────────────────────────────────────────────────────────────

type EventType  = 'drinks' | 'party' | 'music' | 'food' | 'coffee' | 'sport' | 'meetup' | 'other';
type RepeatMode = 'once' | 'daily' | 'weekly' | 'every_n_days';

// ── Category config — Ionicons matching web SVG icons ─────────────────────────
// Web icons (custom SVGs): goblet, sun/star, note, fork+knife, cup, bolt, bubble, dots-grid

const CATEGORIES: {
  type:  EventType;
  label: string;
  icon:  React.ComponentProps<typeof Ionicons>['name'];
}[] = [
  { type: 'drinks',  label: 'DRINKS',  icon: 'wine-outline'          },
  { type: 'party',   label: 'PARTY',   icon: 'sunny-outline'         },
  { type: 'music',   label: 'MUSIC',   icon: 'musical-note-outline'  },
  { type: 'food',    label: 'FOOD',    icon: 'restaurant-outline'    },
  { type: 'coffee',  label: 'COFFEE',  icon: 'cafe-outline'          },
  { type: 'sport',   label: 'SPORT',   icon: 'flash-outline'         },
  { type: 'meetup',  label: 'MEETUP',  icon: 'chatbubble-outline'    },
  { type: 'other',   label: 'OTHER',   icon: 'grid-outline'          },
];

// ── Repeat options — matches web (Once/Daily/Weekly/Every N days) ─────────────

const REPEAT_OPTIONS: { mode: RepeatMode; label: string }[] = [
  { mode: 'once',        label: 'Once'       },
  { mode: 'daily',       label: 'Daily'      },
  { mode: 'weekly',      label: 'Weekly'     },
  { mode: 'every_n_days', label: 'Every N days' },
];

// ── Quick presets — one-tap recurring event shortcuts ─────────────────────────

type PresetKey = 'daily_spot' | 'every_evening' | 'weekends';

const PRESETS: { key: PresetKey; emoji: string; label: string; desc: string }[] = [
  { key: 'daily_spot',    emoji: '☀️', label: 'Daily spot',    desc: 'Every day' },
  { key: 'every_evening', emoji: '🌙', label: 'Every evening', desc: 'Daily · 8pm' },
  { key: 'weekends',      emoji: '🎉', label: 'Weekends',      desc: 'Sat & Sun' },
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
          <Ionicons name="time-outline" size={18} color={Colors.muted} />
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
                  <Ionicons name="chevron-up" size={22} color={Colors.text} />
                </TouchableOpacity>
                <Text style={styles.pickerVal}>{String(h).padStart(2, '0')}</Text>
                <TouchableOpacity style={styles.pickerArrow} onPress={() => setH(v => (v - 1 + 24) % 24)}>
                  <Ionicons name="chevron-down" size={22} color={Colors.text} />
                </TouchableOpacity>
              </View>

              <Text style={styles.pickerColon}>:</Text>

              {/* Minutes column */}
              <View style={styles.pickerCol}>
                <TouchableOpacity style={styles.pickerArrow} onPress={nextM}>
                  <Ionicons name="chevron-up" size={22} color={Colors.text} />
                </TouchableOpacity>
                <Text style={styles.pickerVal}>{String(m).padStart(2, '0')}</Text>
                <TouchableOpacity style={styles.pickerArrow} onPress={prevM}>
                  <Ionicons name="chevron-down" size={22} color={Colors.text} />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity style={styles.pickerDone} onPress={confirm} activeOpacity={0.85}>
              <Text style={styles.pickerDoneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// ── Inline date picker modal ──────────────────────────────────────────────────
// Standalone component (not pulled in via a community lib) — month-grid view
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
  // Month being displayed (anchor on the first of the month).
  const [view, setView] = useState<Date>(() => new Date(value.getFullYear(), value.getMonth(), 1));

  const today      = startOfDay(new Date());
  const maxDate    = startOfDay(addDays(today, maxDays));
  const monthLabel = view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

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
          {/* Header — month nav */}
          <View style={styles.dpHeader}>
            <TouchableOpacity
              onPress={prevMonth} disabled={prevDisabled}
              style={[styles.dpNavBtn, prevDisabled && styles.dpNavBtnDisabled]}
            >
              <Ionicons name="chevron-back" size={20} color={prevDisabled ? Colors.muted2 : Colors.text} />
            </TouchableOpacity>
            <Text style={styles.dpTitle}>{monthLabel}</Text>
            <TouchableOpacity
              onPress={nextMonth} disabled={nextDisabled}
              style={[styles.dpNavBtn, nextDisabled && styles.dpNavBtnDisabled]}
            >
              <Ionicons name="chevron-forward" size={20} color={nextDisabled ? Colors.muted2 : Colors.text} />
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
            <Text style={styles.pickerDoneText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function CreateEventScreen() {
  const router = useRouter();
  const { city, identity, account } = useApp();

  const nickname = account?.display_name ?? identity?.nickname ?? '';
  const guestId  = account?.guest_id ?? identity?.guestId ?? '';

  // ── Form state
  const [type,            setType]            = useState<EventType>('other');
  const [title,           setTitle]           = useState('');
  // selectedDate carries the day-of-month for the event. Time-of-day lives on
  // startsAt / endsAt (still full Date objects so the existing TimePicker
  // doesn't need a refactor — it just sets H/M and preserves the date). We
  // re-sync the day on startsAt / endsAt every time selectedDate flips below.
  const [selectedDate,    setSelectedDate]    = useState<Date>(() => startOfDay(new Date()));
  const [showDatePicker,  setShowDatePicker]  = useState(false);
  const [startsAt,        setStartsAt]        = useState<Date>(() => nextHalfHour());
  const [endsAt,          setEndsAt]          = useState<Date>(() => addHours(nextHalfHour(), 2));
  const [repeat,          setRepeat]          = useState<RepeatMode>('once');
  const [weekdays,        setWeekdays]        = useState<number[]>(() => [new Date().getDay()]);
  const [intervalDays,    setIntervalDays]    = useState('7');
  const [location,        setLocation]        = useState('');
  const [submitting,      setSubmitting]      = useState(false);
  const [error,           setError]           = useState<string | null>(null);
  const [selectedPreset,  setSelectedPreset]  = useState<PresetKey | null>(null);

  /**
   * Setting the date re-anchors startsAt / endsAt to the new day while
   * keeping their hours/minutes intact — so a user who picks "Tomorrow"
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
  const customDateLabel = selectedDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  function applyPreset(key: PresetKey) {
    setSelectedPreset(prev => prev === key ? null : key);
    if (selectedPreset === key) return; // toggle off
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

  async function handleSubmit() {
    if (!city)        { setError('No city selected'); return; }
    if (!title.trim()) { setError('Title is required'); return; }

    // Build end unix; advance to next day if end ≤ start (crosses midnight)
    const startUnix = toUnix(startsAt);
    const endDate   = new Date(endsAt);
    if (toUnix(endDate) <= startUnix) endDate.setDate(endDate.getDate() + 1);
    const endUnix = toUnix(endDate);

    if (endUnix - startUnix < 15 * 60) {
      setError('Event must be at least 15 minutes long');
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
            ...(repeat === 'weekly'       ? { weekdays: weekdays.length > 0 ? weekdays : [selectedDate.getDay()] } : {}),
            ...(repeat === 'every_n_days' ? { interval_days: iDays >= 2 ? iDays : 7 } : {}),
            // Anchors the recurrence series to the picked start date — so a
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
      setError(e instanceof Error ? e.message : 'Failed to create event');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Guest gate — event creation requires a registered account ───────────────
  if (!account) {
    router.replace('/auth-gate?reason=create_event');
    return null;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{isLocal ? 'Host your spot' : 'Create event'}</Text>
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
            <Text style={styles.fieldLabel}>QUICK START</Text>
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
                    <Text style={[styles.presetLabel, active && styles.presetLabelActive]}>{p.label}</Text>
                    <Text style={styles.presetDesc}>{p.desc}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* ── CATEGORY ──────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.fieldLabel}>CATEGORY</Text>
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
                    color={sel ? Colors.accent : Colors.muted}
                  />
                  <Text style={[styles.catLabel, sel && styles.catLabelSel]}>
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── TITLE ─────────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.fieldLabel}>TITLE</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Jazz night at Rooftop Bar"
            placeholderTextColor={Colors.muted2}
            maxLength={100}
            autoCorrect={false}
          />
        </View>

        {/* ── DATE ──────────────────────────────────────────────────────────── */}
        {/* Default: Today (highlighted). One tap to flip to Tomorrow, or open
            a calendar to pick any day in the next 6 months. The "today is most
            visible" nudge below is intentionally subtle — keeps "today" the
            obvious path without blocking other days. */}
        <View style={styles.section}>
          <Text style={styles.fieldLabel}>DATE</Text>
          <View style={styles.dateRow}>
            <TouchableOpacity
              style={[styles.dateChip, isToday && styles.dateChipActive]}
              onPress={() => pickDate(today)}
              activeOpacity={0.75}
            >
              <Text style={[styles.dateChipText, isToday && styles.dateChipTextActive]}>Today</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.dateChip, isTomorrow && styles.dateChipActive]}
              onPress={() => pickDate(tomorrow)}
              activeOpacity={0.75}
            >
              <Text style={[styles.dateChipText, isTomorrow && styles.dateChipTextActive]}>Tomorrow</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.dateChip, isCustomDate && styles.dateChipActive]}
              onPress={() => setShowDatePicker(true)}
              activeOpacity={0.75}
            >
              <Ionicons name="calendar-outline" size={14} color={isCustomDate ? Colors.accent : Colors.muted} />
              <Text style={[styles.dateChipText, isCustomDate && styles.dateChipTextActive]}>
                {isCustomDate ? customDateLabel : 'Pick a date'}
              </Text>
              {isCustomDate && (
                <TouchableOpacity
                  onPress={() => pickDate(today)}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                  style={{ marginLeft: 4 }}
                >
                  <Ionicons name="close" size={14} color={Colors.accent} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </View>
          {isToday && <Text style={styles.dateHint}>Hosting today gets you the most visibility 🔥</Text>}
        </View>

        {/* ── STARTS / ENDS ─────────────────────────────────────────────────── */}
        <View style={[styles.section, styles.timeRow]}>
          <TimePicker
            label="STARTS"
            value={startsAt}
            onChange={d => { setStartsAt(d); setEndsAt(addHours(d, 2)); }}
          />
          <TimePicker label="ENDS" value={endsAt} onChange={setEndsAt} />
        </View>

        {showDatePicker && (
          <DatePicker
            value={selectedDate}
            onChange={pickDate}
            onClose={() => setShowDatePicker(false)}
            maxDays={180}
          />
        )}

        {/* ── REPEAT ────────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.fieldLabel}>REPEAT</Text>
          <View style={styles.repeatRow}>
            {REPEAT_OPTIONS.map(opt => {
              const active = opt.mode === repeat;
              return (
                <TouchableOpacity
                  key={opt.mode}
                  style={[styles.repeatChip, active && styles.repeatChipActive]}
                  onPress={() => setRepeat(opt.mode)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.repeatLabel, active && styles.repeatLabelActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* "Every N days" interval input */}
          {repeat === 'every_n_days' && (
            <View style={styles.intervalRow}>
              <Text style={styles.intervalLabel}>Every</Text>
              <TextInput
                style={styles.intervalInput}
                value={intervalDays}
                onChangeText={v => setIntervalDays(v.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                maxLength={3}
              />
              <Text style={styles.intervalLabel}>days</Text>
            </View>
          )}

        </View>

        {/* ── LOCATION ──────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.fieldLabel}>LOCATION</Text>
          <TextInput
            style={styles.input}
            value={location}
            onChangeText={setLocation}
            placeholder="Optional"
            placeholderTextColor={Colors.muted2}
            maxLength={100}
            autoCorrect={false}
          />
        </View>

        {/* ── Error ─────────────────────────────────────────────────────────── */}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* ── Submit ────────────────────────────────────────────────────────── */}
        <TouchableOpacity
          style={[styles.submitBtn, submitting && styles.submitDisabled]}
          onPress={handleSubmit}
          activeOpacity={0.85}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color={Colors.white} />
          ) : (
            <Text style={styles.submitText}>
              {isLocal
                ? (repeat !== 'once' ? 'Open your spot' : 'Start a hangout')
                : 'Create event'}
            </Text>
          )}
        </TouchableOpacity>

        <View style={{ height: Spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  scroll:    { flex: 1 },
  content:   { paddingHorizontal: 18, paddingTop: 20, gap: 28 },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 16,
    paddingVertical:   12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
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
    zIndex:          1,
  },
  headerCenter: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  headerTitle:  { fontSize: FontSizes.xl, fontWeight: '800', color: Colors.text, letterSpacing: -0.5 },

  // ── Field label — same uppercase tracking as web ──────────────────────────
  fieldLabel: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         Colors.muted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  // ── Section ───────────────────────────────────────────────────────────────
  section: { gap: 10 },

  // ── Category grid — 4 per row, square chips matching web ─────────────────
  catGrid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    gap:           10,
  },
  catChip: {
    // 4 per row with 10px gaps: (100% - 3*10) / 4 ≈ 22.5%
    // Use fixed calculation: content width = screen - 36px padding = ~360 on 396px screen
    // (360 - 30) / 4 = 82.5px — just use aspect ratio with flex
    flex:            0,
    width:           '22.5%',
    aspectRatio:     1,
    backgroundColor: Colors.bg2,
    borderRadius:    18,
    borderWidth:     1,
    borderColor:     Colors.border,
    alignItems:      'center',
    justifyContent:  'center',
    gap:             7,
  },
  catChipSel: {
    borderColor:     Colors.accent,
    backgroundColor: 'rgba(255,122,60,0.10)',
    // Subtle glow matching web box-shadow
    shadowColor:     Colors.accent,
    shadowOffset:    { width: 0, height: 0 },
    shadowOpacity:   0.25,
    shadowRadius:    8,
    elevation:       4,
  },
  catLabel: {
    fontSize:      9,
    fontWeight:    '700',
    color:         Colors.muted2,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  catLabelSel: { color: Colors.accent },

  // ── Text input — matching web dark input style ─────────────────────────────
  input: {
    backgroundColor:   Colors.bg2,
    borderRadius:      12,
    borderWidth:       1,
    borderColor:       Colors.border,
    paddingHorizontal: 16,
    paddingVertical:   Platform.OS === 'ios' ? 15 : 12,
    color:             Colors.text,
    fontSize:          FontSizes.md,
  },

  // ── Time pickers ──────────────────────────────────────────────────────────
  timeRow:   { flexDirection: 'row', gap: 14 },
  timeGroup: { flex: 1, gap: 10 },
  timeBtn: {
    backgroundColor:   Colors.bg2,
    borderRadius:      12,
    borderWidth:       1,
    borderColor:       Colors.border,
    paddingHorizontal: 16,
    paddingVertical:   Platform.OS === 'ios' ? 15 : 12,
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
  },
  timeBtnText: { fontSize: FontSizes.lg, fontWeight: '600', color: Colors.text },

  // ── Time picker modal ─────────────────────────────────────────────────────
  overlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  pickerBox: {
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     Colors.border,
    padding:         Spacing.lg,
    alignItems:      'center',
    gap:             12,
    minWidth:        230,
  },
  pickerTitle: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         Colors.muted,
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
    color:      Colors.text,
    minWidth:   64,
    textAlign:  'center',
  },
  pickerColon: { fontSize: 36, fontWeight: '700', color: Colors.muted, marginBottom: 4 },
  pickerDone: {
    marginTop:         8,
    backgroundColor:   Colors.accent,
    borderRadius:      Radius.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical:   Spacing.sm,
    alignSelf:         'stretch',
    alignItems:        'center',
  },
  pickerDoneText: { color: Colors.white, fontWeight: '700', fontSize: FontSizes.md },

  // ── Date selector chips (Today / Tomorrow / Pick a date) ─────────────────
  dateRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  dateChip: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               6,
    paddingHorizontal: 14,
    paddingVertical:   10,
    backgroundColor:   Colors.bg2,
    borderRadius:      12,
    borderWidth:       1,
    borderColor:       Colors.border,
  },
  dateChipActive: {
    borderColor:     Colors.accent,
    backgroundColor: 'rgba(255,122,60,0.08)',
  },
  dateChipText:        { fontSize: FontSizes.md, color: Colors.muted, fontWeight: '600' },
  dateChipTextActive:  { color: Colors.accent, fontWeight: '700' },
  dateHint:            { fontSize: FontSizes.xs, color: Colors.muted2, marginTop: 8 },

  // ── Inline date-picker modal ─────────────────────────────────────────────
  datePickerBox: {
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     Colors.border,
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
  dpTitle: { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
  dpNavBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.bg3,
  },
  dpNavBtnDisabled: { opacity: 0.3 },
  dpRow: { flexDirection: 'row', justifyContent: 'space-between' },
  dpDow: {
    width:      36,
    textAlign:  'center',
    fontSize:   11,
    fontWeight: '700',
    color:      Colors.muted2,
    letterSpacing: 0.5,
    paddingVertical: 6,
  },
  dpCell: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  dpCellSelected: { backgroundColor: Colors.accent },
  dpCellDisabled: { opacity: 0.25 },
  dpCellText:         { fontSize: FontSizes.sm, color: Colors.text, fontWeight: '600' },
  dpCellTextSelected: { color: Colors.white, fontWeight: '800' },
  dpCellTextDisabled: { color: Colors.muted2 },

  // ── Quick presets ─────────────────────────────────────────────────────────
  presetRow: { flexDirection: 'row', gap: 8 },
  presetBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 14,
    backgroundColor: Colors.bg2, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border, gap: 4,
  },
  presetBtnActive: {
    borderColor: Colors.accent,
    backgroundColor: 'rgba(255,122,60,0.08)',
  },
  presetEmoji: { fontSize: 20 },
  presetLabel: { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.muted },
  presetLabelActive: { color: Colors.accent },
  presetDesc:  { fontSize: 10, color: Colors.muted2, textAlign: 'center' },

  // ── Repeat chips — square-ish matching web (not pill) ─────────────────────
  repeatRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  repeatChip: {
    paddingHorizontal: 16,
    paddingVertical:   11,
    borderRadius:      12,
    backgroundColor:   Colors.bg2,
    borderWidth:       1,
    borderColor:       Colors.border,
    minWidth:          68,
    alignItems:        'center',
  },
  repeatChipActive: {
    borderColor:     Colors.accent,
    backgroundColor: 'rgba(255,122,60,0.08)',
  },
  repeatLabel:       { fontSize: FontSizes.md, color: Colors.muted, fontWeight: '500' },
  repeatLabelActive: { color: Colors.accent, fontWeight: '700' },

  // ── "Every N days" interval input ─────────────────────────────────────────
  intervalRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           10,
    marginTop:     8,
  },
  intervalLabel: { fontSize: FontSizes.md, color: Colors.muted },
  intervalInput: {
    backgroundColor:   Colors.bg2,
    borderRadius:      10,
    borderWidth:       1,
    borderColor:       Colors.border,
    paddingHorizontal: 14,
    paddingVertical:   Platform.OS === 'ios' ? 10 : 7,
    color:             Colors.text,
    fontSize:          FontSizes.lg,
    fontWeight:        '600',
    minWidth:          60,
    textAlign:         'center',
  },
  repeatNote: { fontSize: FontSizes.xs, color: Colors.accent3, marginTop: 6 },

  // ── Error ─────────────────────────────────────────────────────────────────
  errorText: { fontSize: FontSizes.sm, color: Colors.red, textAlign: 'center' },

  // ── Submit button — orange (#FF7A3C) matching web, not red ────────────────
  submitBtn: {
    backgroundColor: Colors.accent,   // #FF7A3C — bright orange like web
    borderRadius:    14,
    paddingVertical: 17,
    alignItems:      'center',
    justifyContent:  'center',
    minHeight:       54,
  },
  submitDisabled: { opacity: 0.55 },
  submitText: {
    color:         Colors.white,
    fontSize:      FontSizes.md,
    fontWeight:    '700',
    letterSpacing: -0.2,
  },
});
