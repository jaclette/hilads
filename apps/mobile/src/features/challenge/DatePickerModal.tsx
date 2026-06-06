import { useContext, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, ScrollView, Platform,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

/**
 * Date+time+venue picker for propose-a-date flows.
 *
 * Extracted from ThreadScheduleBlock so both that component (counter-propose
 * path) and the parent ChallengeChatScreen (initial-propose path, triggered
 * from the pipeline sub-CTA) can use the same UI without state-sharing
 * gymnastics. Each instance owns its own state.
 *
 * Pill-based, zero deps — fits Hilads' "dead simple" rule.
 */

export const TIME_PRESETS = [
  { key: '10:00', hours: 10, minutes: 0  },
  { key: '12:30', hours: 12, minutes: 30 },
  { key: '14:00', hours: 14, minutes: 0  },
  { key: '17:00', hours: 17, minutes: 0  },
  { key: '19:00', hours: 19, minutes: 0  },
  { key: '21:30', hours: 21, minutes: 30 },
];

export interface DatePickerProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (startsAtUnix: number, endsAtUnix: number | null, venue: string | null) => void;
  submitLabel: string;
  /** Pre-fill day + time pills from an existing proposal (counter-propose path). */
  initialStartsAt?: number | null;
  initialEndsAt?:   number | null;
  initialVenue?:    string | null;
}

export function DatePickerModal({
  visible,
  onClose,
  onSubmit,
  submitLabel,
  initialStartsAt,
  initialEndsAt,
  initialVenue,
}: DatePickerProps) {
  const { t } = useTranslation('challenge');
  const insets = useSafeAreaInsets();
  // When the picker is shown over a tab-bar-bearing screen (e.g. /challenge/
  // [id] which Expo Router pushes on top of (tabs)), this returns the tab
  // bar height so we can keep the Submit button above it. Returns 0 when no
  // Tabs ancestor is mounted — no phantom dead space elsewhere.
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
  const bottomInset = tabBarHeight || insets.bottom;
  const [dayOffset, setDayOffset] = useState<number | null>(0);
  const [timeKey,   setTimeKey]   = useState<string | null>('19:00');
  const [endTimeKey, setEndTimeKey] = useState<string | null>(null);
  const [venue,     setVenue]     = useState<string>(initialVenue ?? '');
  // Free-form selections (any date / any time) that fall outside the chip
  // grid. When set, the corresponding preset state is cleared (and vice-
  // versa) so the picker always has exactly one selected value per axis.
  const [customDate, setCustomDate] = useState<Date | null>(null);
  const [customTime, setCustomTime] = useState<{ h: number; m: number } | null>(null);
  const [customEndTime, setCustomEndTime] = useState<{ h: number; m: number } | null>(null);
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [showEndTime, setShowEndTime] = useState(false);

  // Pre-fill from existing proposal (counter-propose path). If the existing
  // value matches a preset, use the chips; otherwise drop into custom state
  // so the user sees the actual proposed date+time round-tripped correctly.
  useEffect(() => {
    if (!initialStartsAt) return;
    const d = new Date(initialStartsAt * 1000);
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
    const offset = Math.round(
      (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - todayMidnight.getTime()) / 86400000,
    );
    if (offset >= 0 && offset <= 7) {
      setDayOffset(offset);
      setCustomDate(null);
    } else {
      setDayOffset(null);
      const dd = new Date(d); dd.setHours(0, 0, 0, 0);
      setCustomDate(dd);
    }
    const matched = TIME_PRESETS.find(p => p.hours === d.getHours() && p.minutes === d.getMinutes());
    if (matched) {
      setTimeKey(matched.key);
      setCustomTime(null);
    } else {
      setTimeKey(null);
      setCustomTime({ h: d.getHours(), m: d.getMinutes() });
    }
    if (initialVenue) setVenue(initialVenue);
  }, [initialStartsAt, initialVenue]);

  // Pre-fill the END-time state from the existing proposal too. Same
  // chip-or-custom branch as start time. Without this, counter-proposing
  // would silently reset the end to "not set" — a worse round-trip than
  // before, when the auto-end always populated it.
  useEffect(() => {
    if (!initialEndsAt) return;
    const d = new Date(initialEndsAt * 1000);
    const matched = TIME_PRESETS.find(p => p.hours === d.getHours() && p.minutes === d.getMinutes());
    if (matched) {
      setEndTimeKey(matched.key);
      setCustomEndTime(null);
    } else {
      setEndTimeKey(null);
      setCustomEndTime({ h: d.getHours(), m: d.getMinutes() });
    }
  }, [initialEndsAt]);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dayLabels = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(today); d.setDate(today.getDate() + i);
    if (i === 0) return { offset: i, label: t('schedule.today') };
    if (i === 1) return { offset: i, label: t('schedule.tomorrow') };
    return { offset: i, label: d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) };
  });

  // Min selectable date for the native picker — today, so users can't
  // propose meet-ups in the past. Max = +90 days, plenty of headroom.
  const minPickerDate = new Date(today);
  const maxPickerDate = new Date(today); maxPickerDate.setDate(today.getDate() + 90);

  const customDateLabel = customDate
    ? customDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : t('schedule.picker.otherDate');
  const customTimeLabel = customTime
    ? `${String(customTime.h).padStart(2, '0')}:${String(customTime.m).padStart(2, '0')}`
    : t('schedule.picker.otherTime');
  const customEndTimeLabel = customEndTime
    ? `${String(customEndTime.h).padStart(2, '0')}:${String(customEndTime.m).padStart(2, '0')}`
    : t('schedule.picker.otherTime');

  // Resolved start/end times in minutes-since-midnight, used to validate
  // that end is strictly after start. Returns null when a field hasn't been
  // picked yet — the canSubmit gate below treats null as "incomplete".
  const startMinutes: number | null = (() => {
    if (customTime) return customTime.h * 60 + customTime.m;
    if (timeKey) {
      const p = TIME_PRESETS.find(x => x.key === timeKey);
      if (p) return p.hours * 60 + p.minutes;
    }
    return null;
  })();
  const endMinutes: number | null = (() => {
    if (customEndTime) return customEndTime.h * 60 + customEndTime.m;
    if (endTimeKey) {
      const p = TIME_PRESETS.find(x => x.key === endTimeKey);
      if (p) return p.hours * 60 + p.minutes;
    }
    return null;
  })();
  const endIsAfterStart = startMinutes !== null && endMinutes !== null && endMinutes > startMinutes;

  const canSubmit = (dayOffset !== null || customDate !== null)
                 && startMinutes !== null
                 && endMinutes   !== null
                 && endIsAfterStart;

  function handleDateChange(_: DateTimePickerEvent, picked?: Date) {
    // iOS keeps the spinner open until manually dismissed; Android auto-
    // closes after one tap. Either way, a non-null `picked` is the chosen
    // value (or the wheel's current value on iOS). `dismissed` action sends
    // no date — bail without mutating state.
    if (Platform.OS !== 'ios') setShowDate(false);
    if (!picked) return;
    const d = new Date(picked); d.setHours(0, 0, 0, 0);
    setCustomDate(d);
    setDayOffset(null);
  }

  function handleTimeChange(_: DateTimePickerEvent, picked?: Date) {
    if (Platform.OS !== 'ios') setShowTime(false);
    if (!picked) return;
    setCustomTime({ h: picked.getHours(), m: picked.getMinutes() });
    setTimeKey(null);
  }

  function handleEndTimeChange(_: DateTimePickerEvent, picked?: Date) {
    if (Platform.OS !== 'ios') setShowEndTime(false);
    if (!picked) return;
    setCustomEndTime({ h: picked.getHours(), m: picked.getMinutes() });
    setEndTimeKey(null);
  }

  function submit() {
    if (!canSubmit) return;
    // Resolve date (custom overrides preset; both branches checked by canSubmit).
    const d = customDate ? new Date(customDate) : (() => {
      const x = new Date(); x.setHours(0, 0, 0, 0);
      x.setDate(x.getDate() + (dayOffset ?? 0));
      return x;
    })();
    // Resolve start time
    const startTotal = startMinutes!; // canSubmit guarantees non-null
    const startH = Math.floor(startTotal / 60);
    const startM = startTotal % 60;
    const start = new Date(d);
    start.setHours(startH, startM, 0, 0);
    const startsAt = Math.floor(start.getTime() / 1000);
    // Resolve end time — same calendar day as start (canSubmit asserted end > start).
    // No more +1h / +2h auto-default: the proposer ALWAYS sets end explicitly.
    // The rating window opens at proposed_ends_at, so the proposer effectively
    // controls when rating becomes available.
    const endTotal = endMinutes!;
    const endH = Math.floor(endTotal / 60);
    const endM = endTotal % 60;
    const end = new Date(d);
    end.setHours(endH, endM, 0, 0);
    const endsAt = Math.floor(end.getTime() / 1000);
    onSubmit(startsAt, endsAt, venue.trim() || null);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Sheet — header pinned top, content scrolls in the middle, Submit
            pinned bottom. paddingBottom clears any bottom tab bar that's
            mounted under us. */}
        <View style={[styles.sheet, { paddingBottom: bottomInset + 8 }]}>
          <View style={styles.handle} />

          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} accessibilityLabel={t('cancel', { ns: 'common' })}>
              <Ionicons name="close" size={22} color={Colors.muted} />
            </TouchableOpacity>
            <Text style={styles.title}>{t('schedule.picker.title')}</Text>
            <View style={{ width: 22 }} />
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.sectionLabel}>{t('schedule.picker.whenLabel')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillsRow}>
              {dayLabels.map(d => {
                const selected = d.offset === dayOffset && customDate === null;
                return (
                  <TouchableOpacity
                    key={d.offset}
                    style={[styles.pill, selected && styles.pillSelected]}
                    onPress={() => { setDayOffset(d.offset); setCustomDate(null); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{d.label}</Text>
                  </TouchableOpacity>
                );
              })}
              {/* Free-form date — opens the native calendar picker. When a
                  custom date is set, the pill shows the chosen date and is
                  treated as selected; tapping it again re-opens the picker. */}
              <TouchableOpacity
                style={[styles.pill, customDate !== null && styles.pillSelected]}
                onPress={() => setShowDate(true)}
                activeOpacity={0.7}
                accessibilityLabel={t('schedule.picker.otherDate')}
              >
                <Ionicons
                  name="calendar-outline"
                  size={13}
                  color={customDate !== null ? '#FF7A3C' : Colors.muted}
                  style={{ marginRight: 4 }}
                />
                <Text style={[styles.pillText, customDate !== null && styles.pillTextSelected]}>
                  {customDateLabel}
                </Text>
              </TouchableOpacity>
            </ScrollView>

            <Text style={styles.sectionLabel}>{t('schedule.picker.timeLabel')}</Text>
            <View style={styles.pillsGrid}>
              {TIME_PRESETS.map(p => {
                const selected = p.key === timeKey && customTime === null;
                return (
                  <TouchableOpacity
                    key={p.key}
                    style={[styles.pill, selected && styles.pillSelected]}
                    onPress={() => { setTimeKey(p.key); setCustomTime(null); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{p.key}</Text>
                  </TouchableOpacity>
                );
              })}
              {/* Free-form time. Same pattern as the date pill above. */}
              <TouchableOpacity
                style={[styles.pill, customTime !== null && styles.pillSelected]}
                onPress={() => setShowTime(true)}
                activeOpacity={0.7}
                accessibilityLabel={t('schedule.picker.otherTime')}
              >
                <Ionicons
                  name="time-outline"
                  size={13}
                  color={customTime !== null ? '#FF7A3C' : Colors.muted}
                  style={{ marginRight: 4 }}
                />
                <Text style={[styles.pillText, customTime !== null && styles.pillTextSelected]}>
                  {customTimeLabel}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Native pickers — iOS renders inline (default 'spinner'), so we
                wrap in a small frame for visual consistency. Android renders
                as a transient dialog and auto-dismisses on selection. */}
            {showDate && (
              <View style={Platform.OS === 'ios' ? styles.nativePickerWrap : undefined}>
                <DateTimePicker
                  value={customDate ?? new Date()}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  minimumDate={minPickerDate}
                  maximumDate={maxPickerDate}
                  onChange={handleDateChange}
                  themeVariant="dark"
                />
                {Platform.OS === 'ios' && (
                  <TouchableOpacity
                    style={styles.nativePickerDone}
                    onPress={() => setShowDate(false)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.nativePickerDoneText}>{t('done', { ns: 'common', defaultValue: 'Done' })}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            {showTime && (
              <View style={Platform.OS === 'ios' ? styles.nativePickerWrap : undefined}>
                <DateTimePicker
                  value={(() => {
                    const d = new Date();
                    if (customTime) d.setHours(customTime.h, customTime.m, 0, 0);
                    return d;
                  })()}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  is24Hour
                  onChange={handleTimeChange}
                  themeVariant="dark"
                />
                {Platform.OS === 'ios' && (
                  <TouchableOpacity
                    style={styles.nativePickerDone}
                    onPress={() => setShowTime(false)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.nativePickerDoneText}>{t('done', { ns: 'common', defaultValue: 'Done' })}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* END TIME — required, no default. The rating window opens at
                this moment (proposed_ends_at), so the proposer effectively
                controls when rating becomes available. */}
            <Text style={styles.sectionLabel}>{t('schedule.picker.endTimeLabel')}</Text>
            <View style={styles.pillsGrid}>
              {TIME_PRESETS.map(p => {
                const selected = p.key === endTimeKey && customEndTime === null;
                return (
                  <TouchableOpacity
                    key={p.key}
                    style={[styles.pill, selected && styles.pillSelected]}
                    onPress={() => { setEndTimeKey(p.key); setCustomEndTime(null); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{p.key}</Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                style={[styles.pill, customEndTime !== null && styles.pillSelected]}
                onPress={() => setShowEndTime(true)}
                activeOpacity={0.7}
                accessibilityLabel={t('schedule.picker.otherTime')}
              >
                <Ionicons
                  name="time-outline"
                  size={13}
                  color={customEndTime !== null ? '#FF7A3C' : Colors.muted}
                  style={{ marginRight: 4 }}
                />
                <Text style={[styles.pillText, customEndTime !== null && styles.pillTextSelected]}>
                  {customEndTimeLabel}
                </Text>
              </TouchableOpacity>
            </View>
            {/* Inline validation hint when both times are set but end ≤ start. */}
            {startMinutes !== null && endMinutes !== null && !endIsAfterStart && (
              <Text style={styles.validationHint}>{t('schedule.picker.endAfterStart')}</Text>
            )}
            {showEndTime && (
              <View style={Platform.OS === 'ios' ? styles.nativePickerWrap : undefined}>
                <DateTimePicker
                  value={(() => {
                    const d = new Date();
                    if (customEndTime) d.setHours(customEndTime.h, customEndTime.m, 0, 0);
                    return d;
                  })()}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  is24Hour
                  onChange={handleEndTimeChange}
                  themeVariant="dark"
                />
                {Platform.OS === 'ios' && (
                  <TouchableOpacity
                    style={styles.nativePickerDone}
                    onPress={() => setShowEndTime(false)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.nativePickerDoneText}>{t('done', { ns: 'common', defaultValue: 'Done' })}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <Text style={styles.sectionLabel}>{t('schedule.picker.whereLabel')}</Text>
            <TextInput
              style={styles.venueInput}
              value={venue}
              onChangeText={setVenue}
              placeholder={t('schedule.picker.wherePlaceholder')}
              placeholderTextColor={Colors.muted2}
              maxLength={200}
              returnKeyType="done"
            />
          </ScrollView>

          {/* Submit — pinned to the sheet bottom, OUTSIDE the ScrollView so
              it stays visible regardless of how tall the inner content is. */}
          <TouchableOpacity
            style={[styles.submit, !canSubmit && styles.submitDisabled]}
            onPress={submit}
            disabled={!canSubmit}
            activeOpacity={0.85}
          >
            <Text style={styles.submitText}>{submitLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.bg,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 8, maxHeight: '85%',
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.muted2, opacity: 0.5,
    alignSelf: 'center', marginBottom: 12,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  title: { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text },
  scrollContent: { padding: Spacing.md, gap: Spacing.sm },
  sectionLabel: {
    fontSize: FontSizes.xs, fontWeight: '700', color: Colors.muted,
    letterSpacing: 0.8, textTransform: 'uppercase', marginTop: Spacing.sm,
  },
  pillsRow:  { gap: 8, paddingVertical: 4, paddingRight: Spacing.md },
  pillsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full,
    backgroundColor: Colors.bg2, borderWidth: 1, borderColor: Colors.border,
  },
  pillSelected: {
    backgroundColor: 'rgba(255,122,60,0.14)', borderColor: '#FF7A3C',
  },
  pillText: { color: Colors.muted, fontWeight: '600', fontSize: FontSizes.sm },
  pillTextSelected: { color: '#FF7A3C', fontWeight: '800' },
  venueInput: {
    backgroundColor: Colors.bg2, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 2,
    fontSize: FontSizes.md, color: Colors.text,
  },
  // Inline native picker frame (iOS) — Android renders as a separate dialog
  // and doesn't need a wrapper. Border + bg matches the venue input + pills
  // so it reads as another chip-grid section rather than a system overlay.
  nativePickerWrap: {
    backgroundColor: Colors.bg2,
    borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingVertical: Spacing.xs,
    marginTop: Spacing.xs,
  },
  nativePickerDone: {
    alignSelf: 'flex-end',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  nativePickerDoneText: {
    color: '#FF7A3C', fontWeight: '800', fontSize: FontSizes.sm, letterSpacing: 0.2,
  },
  // Inline validation message shown under the END TIME chip grid when both
  // start and end are selected but end is not strictly after start.
  validationHint: {
    fontSize: FontSizes.xs, color: Colors.red, marginTop: 4, fontWeight: '600',
  },
  submit: {
    marginHorizontal: Spacing.md, marginTop: Spacing.sm,
    backgroundColor: '#FF7A3C', borderRadius: Radius.full,
    paddingVertical: Spacing.md, alignItems: 'center',
  },
  submitDisabled: { opacity: 0.45 },
  submitText: { color: Colors.white, fontWeight: '800', fontSize: FontSizes.md, letterSpacing: 0.2 },
});
