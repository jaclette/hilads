/**
 * Edit Event screen - host-only, parity with web CreateEventModal in edit mode.
 *
 * Web source: apps/web/src/components/CreateEventModal.jsx (with isEdit=true)
 *
 * Differences from create.tsx:
 *   - Form is pre-filled from the fetched event (via useEventDetail).
 *   - No quick presets / no repeat selector (editing always keeps the event as-is).
 *   - Submit calls updateEvent() + router.back().
 *   - Adds a "Delete event" CTA at the bottom with native Alert confirmation.
 *   - Host-only: if !isOwner, bounce back to the event detail.
 */

import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Modal, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { updateEvent, deleteEvent } from '@/api/events';
import { useEventDetail } from '@/hooks/useEventDetail';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import { PrimaryButton } from '@/components/PrimaryButton';

// ── Types ─────────────────────────────────────────────────────────────────────

type EventType = 'drinks' | 'party' | 'music' | 'food' | 'coffee' | 'sport' | 'meetup' | 'other';

// ── Category config - mirrors create.tsx ──────────────────────────────────────

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

// ── Time helpers ──────────────────────────────────────────────────────────────

function fromUnix(sec: number): Date { return new Date(sec * 1000); }
function toUnix(d: Date): number     { return Math.floor(d.getTime() / 1000); }

function timeStr(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
/** Replace the day-of-month/month/year on $time with the calendar date of $date. Time-of-day preserved. */
function withDate(time: Date, date: Date): Date {
  const out = new Date(time);
  out.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  return out;
}

// ── Inline time picker - lifted verbatim from create.tsx to keep UX identical ─

const MINUTE_STEPS = [0, 15, 30, 45];

function TimePicker({
  label, value, onChange,
}: { label: string; value: Date; onChange: (d: Date) => void }) {
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
              <Text style={styles.pickerDoneText}>{t('done')}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// ── Inline date picker modal - lifted from create.tsx so create/edit match ───
// Month-grid view with prev/next nav. Past days and dates beyond `maxDays`
// ahead are disabled. Lets the host move the event to a different day.

function DatePicker({
  value, onChange, onClose, maxDays = 180,
}: {
  value:    Date;
  onChange: (d: Date) => void;
  onClose:  () => void;
  maxDays?: number;
}) {
  const { t } = useTranslation('common');
  const [view, setView] = useState<Date>(() => new Date(value.getFullYear(), value.getMonth(), 1));

  const today      = startOfDay(new Date());
  const maxDate    = startOfDay(addDays(today, maxDays));
  const monthLabel = view.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' });

  const firstOfMonth = new Date(view.getFullYear(), view.getMonth(), 1);
  const startOffset  = firstOfMonth.getDay(); // 0=Sun
  const daysInMonth  = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(view.getFullYear(), view.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);

  const prevMonth = () => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1));
  const nextMonth = () => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1));

  const prevDisabled = view.getFullYear() === today.getFullYear() && view.getMonth() === today.getMonth();
  const nextDisabled = view.getFullYear() === maxDate.getFullYear() && view.getMonth() === maxDate.getMonth();

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.datePickerBox} onStartShouldSetResponder={() => true}>
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

          <View style={styles.dpRow}>
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
              <Text key={d} style={styles.dpDow}>{d}</Text>
            ))}
          </View>

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

export default function EditEventScreen() {
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
      router.back();
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

  // ── Loading / not-found guards ──────────────────────────────────────────────
  if (loading || !seeded) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
            <Ionicons name="chevron-back" size={20} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>{t('editEvent')}</Text>
          </View>
        </View>
        <View style={styles.loadingBlock}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Edit event</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
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
                    color={sel ? Colors.accent : Colors.muted}
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
            placeholderTextColor={Colors.muted2}
            maxLength={100}
            autoCorrect={false}
          />
        </View>

        {/* ── DATE ──────────────────────────────────────────────────────────── */}
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
              <Ionicons name="calendar-outline" size={14} color={isCustomDate ? Colors.accent : Colors.muted} />
              <Text style={[styles.dateChipText, isCustomDate && styles.dateChipTextActive]}>
                {isCustomDate ? customDateLabel : t('pickDate')}
              </Text>
            </TouchableOpacity>
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
        <View style={[styles.section, styles.timeRow]}>
          <TimePicker label={t('starts')} value={startsAt} onChange={setStartsAt} />
          <TimePicker label={t('ends')}   value={endsAt}   onChange={setEndsAt} />
        </View>

        {/* ── LOCATION ──────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.fieldLabel}>{t('location')}</Text>
          <TextInput
            style={styles.input}
            value={location}
            onChangeText={setLocation}
            placeholder={t('locationOptional')}
            placeholderTextColor={Colors.muted2}
            maxLength={100}
            autoCorrect={false}
          />
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* ── Save ──────────────────────────────────────────────────────────── */}
        <PrimaryButton
          label={t('saveChanges')}
          onPress={handleSave}
          loading={submitting}
          disabled={deleting}
        />

        {/* ── Delete ────────────────────────────────────────────────────────── */}
        <TouchableOpacity
          style={[styles.deleteBtn, deleting && styles.submitDisabled]}
          onPress={handleDelete}
          activeOpacity={0.85}
          disabled={submitting || deleting}
          accessibilityRole="button"
          accessibilityLabel={t('deleteEvent')}
        >
          {deleting ? (
            <ActivityIndicator color={Colors.red} />
          ) : (
            <Text style={styles.deleteText}>{t('deleteBtn')}</Text>
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

  loadingBlock: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  fieldLabel: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         Colors.muted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  section: { gap: 10 },

  // ── Category grid ─────────────────────────────────────────────────────────
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  catChip: {
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

  // ── Inputs ────────────────────────────────────────────────────────────────
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
  dateChipText:       { fontSize: FontSizes.md, color: Colors.muted, fontWeight: '600' },
  dateChipTextActive: { color: Colors.accent, fontWeight: '700' },

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

  errorText: { fontSize: FontSizes.sm, color: Colors.red, textAlign: 'center' },

  // Save button uses the shared <PrimaryButton>. The Delete button below
  // reuses `submitDisabled` for its disabled state.
  submitDisabled: { opacity: 0.55 },

  // ── Delete button - red outline, matches web danger style ────────────────
  deleteBtn: {
    marginTop:       Spacing.sm,
    borderWidth:     1,
    borderColor:     Colors.red,
    backgroundColor: 'transparent',
    borderRadius:    14,
    paddingVertical: 15,
    alignItems:      'center',
    justifyContent:  'center',
    minHeight:       50,
  },
  deleteText: {
    color:      Colors.red,
    fontSize:   FontSizes.md,
    fontWeight: '700',
  },
});
