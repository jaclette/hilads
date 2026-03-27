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

import { useState, useMemo } from 'react';
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
                <TouchableOpacity style={styles.pickerArrow} onPress={() => setH(v => (v - 1 + 24) % 24)}>
                  <Ionicons name="chevron-up" size={22} color={Colors.text} />
                </TouchableOpacity>
                <Text style={styles.pickerVal}>{String(h).padStart(2, '0')}</Text>
                <TouchableOpacity style={styles.pickerArrow} onPress={() => setH(v => (v + 1) % 24)}>
                  <Ionicons name="chevron-down" size={22} color={Colors.text} />
                </TouchableOpacity>
              </View>

              <Text style={styles.pickerColon}>:</Text>

              {/* Minutes column */}
              <View style={styles.pickerCol}>
                <TouchableOpacity style={styles.pickerArrow} onPress={prevM}>
                  <Ionicons name="chevron-up" size={22} color={Colors.text} />
                </TouchableOpacity>
                <Text style={styles.pickerVal}>{String(m).padStart(2, '0')}</Text>
                <TouchableOpacity style={styles.pickerArrow} onPress={nextM}>
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

// ── Screen ────────────────────────────────────────────────────────────────────

export default function CreateEventScreen() {
  const router = useRouter();
  const { city, identity, account } = useApp();

  const nickname = account?.display_name ?? identity?.nickname ?? '';
  const guestId  = account?.guest_id ?? identity?.guestId ?? '';

  // ── Form state
  const [type,         setType]         = useState<EventType>('other');
  const [title,        setTitle]        = useState('');
  const [startsAt,     setStartsAt]     = useState<Date>(() => nextHalfHour());
  const [endsAt,       setEndsAt]       = useState<Date>(() => addHours(nextHalfHour(), 2));
  const [repeat,       setRepeat]       = useState<RepeatMode>('once');
  const [intervalDays, setIntervalDays] = useState('7');
  const [location,     setLocation]     = useState('');
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  const todayWeekday = useMemo(() => new Date().getDay(), []);

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

    if (repeat !== 'once' && !account) {
      setError('Recurring events require a registered account. Sign in or choose "Once".');
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
            ...(repeat === 'weekly'       ? { weekdays:      [todayWeekday] } : {}),
            ...(repeat === 'every_n_days' ? { interval_days: iDays >= 2 ? iDays : 7 } : {}),
            location_hint: location.trim() || undefined,
          },
        );
        router.replace(`/event/${first_event.id}`);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create event');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Create event</Text>
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

        {/* ── STARTS / ENDS ─────────────────────────────────────────────────── */}
        <View style={[styles.section, styles.timeRow]}>
          <TimePicker
            label="STARTS"
            value={startsAt}
            onChange={d => { setStartsAt(d); setEndsAt(addHours(d, 2)); }}
          />
          <TimePicker label="ENDS" value={endsAt} onChange={setEndsAt} />
        </View>

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

          {repeat !== 'once' && !account && (
            <Text style={styles.repeatNote}>
              ⚠ Recurring events require a registered account
            </Text>
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
            <Text style={styles.submitText}>Create event</Text>
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
