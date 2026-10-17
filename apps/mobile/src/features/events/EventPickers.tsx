/**
 * Pickers of the plan form (create + edit), no external deps: the category
 * grid, a time field opening an hour / minute sheet, and a month-grid date
 * sheet (past days and days beyond `maxDays` are disabled).
 */
import { useState } from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { Border, FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Button, Sheet } from '@/ui';

// ── Category grid ────────────────────────────────────────────────────────────

export type EventType = 'drinks' | 'party' | 'music' | 'food' | 'coffee' | 'sport' | 'meetup' | 'other';

const CATEGORIES: { type: EventType; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { type: 'drinks',  icon: 'wine-outline'          },
  { type: 'party',   icon: 'sunny-outline'         },
  { type: 'music',   icon: 'musical-note-outline'  },
  { type: 'food',    icon: 'restaurant-outline'    },
  { type: 'coffee',  icon: 'cafe-outline'          },
  { type: 'sport',   icon: 'flash-outline'         },
  { type: 'meetup',  icon: 'chatbubble-outline'    },
  { type: 'other',   icon: 'grid-outline'          },
];

/** Two rows of four tiles; the chosen one takes the primary tint. */
export function CategoryPicker({ value, onChange }: { value: EventType; onChange: (type: EventType) => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('event');
  return (
    <View style={styles.catGrid}>
      {[CATEGORIES.slice(0, 4), CATEGORIES.slice(4)].map((row, r) => (
        <View key={r} style={styles.catRow}>
          {row.map(cat => {
            const sel = cat.type === value;
            return (
              <TouchableOpacity
                key={cat.type}
                style={[styles.tile, sel && styles.tileOn]}
                onPress={() => onChange(cat.type)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ selected: sel }}
              >
                <Ionicons name={cat.icon} size={24} color={sel ? colors.primaryText : colors.muted} />
                <Text style={[styles.tileLabel, sel && styles.tileLabelOn]} numberOfLines={1}>{t(`cat.${cat.type}`)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ── Date helpers shared by the plan form ─────────────────────────────────────

export function timeStr(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Replace the calendar day of `time` with the one of `date`; the time of day is kept. */
export function withDate(time: Date, date: Date): Date {
  const out = new Date(time);
  out.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  return out;
}

// ── Time field + sheet ───────────────────────────────────────────────────────

const MINUTE_STEPS = [0, 15, 30, 45];

export function TimePicker({ label, value, onChange }: { label: string; value: Date; onChange: (d: Date) => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [h, setH] = useState(value.getHours());
  const [m, setM] = useState(MINUTE_STEPS.includes(value.getMinutes()) ? value.getMinutes() : 0);

  function show() {
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

  const stepM = (dir: 1 | -1) => setM(mv => {
    const i = MINUTE_STEPS.indexOf(mv);
    return MINUTE_STEPS[(i + dir + MINUTE_STEPS.length) % MINUTE_STEPS.length];
  });

  const Column = ({ value: v, onUp, onDown }: { value: number; onUp: () => void; onDown: () => void }) => (
    <View style={styles.col}>
      <TouchableOpacity style={styles.arrow} onPress={onUp} accessibilityRole="button" accessibilityLabel="+">
        <Ionicons name="chevron-up" size={24} color={colors.text} />
      </TouchableOpacity>
      <Text style={styles.val}>{String(v).padStart(2, '0')}</Text>
      <TouchableOpacity style={styles.arrow} onPress={onDown} accessibilityRole="button" accessibilityLabel="-">
        <Ionicons name="chevron-down" size={24} color={colors.text} />
      </TouchableOpacity>
    </View>
  );

  return (
    <>
      <View style={styles.timeGroup}>
        <Text style={styles.label}>{label}</Text>
        <TouchableOpacity style={styles.field} onPress={show} activeOpacity={0.75} accessibilityRole="button" accessibilityLabel={`${label} ${timeStr(value)}`}>
          <Text style={styles.fieldText}>{timeStr(value)}</Text>
          <Ionicons name="time-outline" size={18} color={colors.muted} />
        </TouchableOpacity>
      </View>

      <Sheet visible={open} onClose={() => setOpen(false)} closeLabel={t('cancel')}>
        <Text style={styles.title}>{label}</Text>
        <View style={styles.clock}>
          <Column value={h} onUp={() => setH(v => (v + 1) % 24)} onDown={() => setH(v => (v + 23) % 24)} />
          <Text style={styles.colon}>:</Text>
          <Column value={m} onUp={() => stepM(1)} onDown={() => stepM(-1)} />
        </View>
        <Button label={t('done')} onPress={confirm} />
      </Sheet>
    </>
  );
}

// ── Date sheet (month grid) ──────────────────────────────────────────────────

export function DatePicker({ value, onChange, onClose, maxDays = 180 }: {
  value: Date; onChange: (d: Date) => void; onClose: () => void; maxDays?: number;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const [view, setView] = useState<Date>(() => new Date(value.getFullYear(), value.getMonth(), 1));

  const today      = startOfDay(new Date());
  const maxDate    = startOfDay(addDays(today, maxDays));
  const monthLabel = view.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' });
  // Weekday initials in the app language, Sunday first (2026-02-01 is a Sunday).
  const dow = Array.from({ length: 7 }, (_, i) => new Date(2026, 1, 1 + i).toLocaleDateString(i18n.language, { weekday: 'narrow' }));

  const firstOfMonth = new Date(view.getFullYear(), view.getMonth(), 1);
  const daysInMonth  = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstOfMonth.getDay(); i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(view.getFullYear(), view.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);

  const prevDisabled = view.getFullYear() === today.getFullYear() && view.getMonth() === today.getMonth();
  const nextDisabled = view.getFullYear() === maxDate.getFullYear() && view.getMonth() === maxDate.getMonth();

  return (
    <Sheet visible onClose={onClose} closeLabel={t('cancel')}>
      <View style={styles.dpHeader}>
        <TouchableOpacity style={[styles.arrow, prevDisabled && styles.disabled]} disabled={prevDisabled} accessibilityRole="button"
                          onPress={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>{monthLabel}</Text>
        <TouchableOpacity style={[styles.arrow, nextDisabled && styles.disabled]} disabled={nextDisabled} accessibilityRole="button"
                          onPress={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}>
          <Ionicons name="chevron-forward" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.row}>
        {dow.map((d, i) => <Text key={i} style={styles.dow}>{d}</Text>)}
      </View>

      {Array.from({ length: cells.length / 7 }).map((_, r) => (
        <View key={r} style={styles.row}>
          {cells.slice(r * 7, r * 7 + 7).map((cell, i) => {
            if (!cell) return <View key={i} style={styles.cell} />;
            const disabled = cell < today || cell > maxDate;
            const selected = isSameDay(cell, value);
            return (
              <TouchableOpacity
                key={i}
                style={[styles.cell, selected && styles.cellOn, disabled && styles.disabled]}
                onPress={() => { onChange(cell); onClose(); }}
                disabled={disabled}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled }}
              >
                <Text style={[styles.cellText, selected && styles.cellTextOn]}>{cell.getDate()}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}

      <Button variant="link" label={t('cancel')} onPress={onClose} style={styles.cancel} />
    </Sheet>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  catGrid:   { gap: 8 },
  catRow:    { flexDirection: 'row', gap: 8 },
  tile:      { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 4,
               borderRadius: Radius.card, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  tileOn:    { borderColor: c.primary, backgroundColor: c.primaryTint },
  tileLabel: { fontSize: 12, fontWeight: '700', color: c.muted },
  tileLabelOn: { color: c.primaryOnTint },
  timeGroup: { flex: 1, gap: 6 },
  label:     { fontSize: FontSizes.xs, fontWeight: '700', color: c.muted },
  field:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: 14,
               borderRadius: Radius.button, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  fieldText: { fontSize: FontSizes.md, fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] },
  title:     { fontSize: FontSizes.md, fontWeight: '800', color: c.text, textAlign: 'center' },
  clock:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 8 },
  col:       { alignItems: 'center', gap: 4 },
  arrow:     { width: 44, height: 44, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', borderWidth: Border, borderColor: c.line },
  val:       { fontSize: 36, fontWeight: '800', color: c.text, fontVariant: ['tabular-nums'] },
  colon:     { fontSize: 32, fontWeight: '800', color: c.muted },
  dpHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row:       { flexDirection: 'row' },
  dow:       { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '700', color: c.muted, paddingVertical: 4 },
  cell:      { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.full },
  cellOn:    { backgroundColor: c.primary },
  cellText:  { fontSize: FontSizes.sm, fontWeight: '600', color: c.text },
  cellTextOn:{ fontWeight: '800', color: c.white },
  disabled:  { opacity: 0.3 },
  cancel:    { alignSelf: 'center' },
});
