import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, ScrollView,
} from 'react-native';
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
  initialVenue?:    string | null;
}

export function DatePickerModal({
  visible,
  onClose,
  onSubmit,
  submitLabel,
  initialStartsAt,
  initialVenue,
}: DatePickerProps) {
  const { t } = useTranslation('challenge');
  const [dayOffset, setDayOffset] = useState<number | null>(0);
  const [timeKey,   setTimeKey]   = useState<string | null>('19:00');
  const [venue,     setVenue]     = useState<string>(initialVenue ?? '');

  // Pre-fill from existing proposal (counter-propose path).
  useEffect(() => {
    if (!initialStartsAt) return;
    const d = new Date(initialStartsAt * 1000);
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
    const offset = Math.round(
      (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - todayMidnight.getTime()) / 86400000,
    );
    if (offset >= 0 && offset <= 7) setDayOffset(offset);
    const matched = TIME_PRESETS.find(p => p.hours === d.getHours() && p.minutes === d.getMinutes());
    if (matched) setTimeKey(matched.key);
    if (initialVenue) setVenue(initialVenue);
  }, [initialStartsAt, initialVenue]);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dayLabels = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(today); d.setDate(today.getDate() + i);
    if (i === 0) return { offset: i, label: t('schedule.today') };
    if (i === 1) return { offset: i, label: t('schedule.tomorrow') };
    return { offset: i, label: d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) };
  });

  const canSubmit = dayOffset !== null && timeKey !== null;

  function submit() {
    if (dayOffset === null || timeKey === null) return;
    const preset = TIME_PRESETS.find(p => p.key === timeKey)!;
    const d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(preset.hours, preset.minutes, 0, 0);
    const startsAt = Math.floor(d.getTime() / 1000);
    onSubmit(startsAt, startsAt + 2 * 3600, venue.trim() || null);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
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
                const selected = d.offset === dayOffset;
                return (
                  <TouchableOpacity
                    key={d.offset}
                    style={[styles.pill, selected && styles.pillSelected]}
                    onPress={() => setDayOffset(d.offset)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{d.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={styles.sectionLabel}>{t('schedule.picker.timeLabel')}</Text>
            <View style={styles.pillsGrid}>
              {TIME_PRESETS.map(p => {
                const selected = p.key === timeKey;
                return (
                  <TouchableOpacity
                    key={p.key}
                    style={[styles.pill, selected && styles.pillSelected]}
                    onPress={() => setTimeKey(p.key)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{p.key}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

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

            <TouchableOpacity
              style={[styles.submit, !canSubmit && styles.submitDisabled]}
              onPress={submit}
              disabled={!canSubmit}
              activeOpacity={0.85}
            >
              <Text style={styles.submitText}>{submitLabel}</Text>
            </TouchableOpacity>
          </ScrollView>
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
  scrollContent: { padding: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.xl },
  sectionLabel: {
    fontSize: FontSizes.xs, fontWeight: '700', color: Colors.muted,
    letterSpacing: 0.8, textTransform: 'uppercase', marginTop: Spacing.sm,
  },
  pillsRow:  { gap: 8, paddingVertical: 4, paddingRight: Spacing.md },
  pillsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
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
  submit: {
    marginTop: Spacing.md, backgroundColor: '#FF7A3C', borderRadius: Radius.full,
    paddingVertical: Spacing.md, alignItems: 'center',
  },
  submitDisabled: { opacity: 0.45 },
  submitText: { color: Colors.white, fontWeight: '800', fontSize: FontSizes.md, letterSpacing: 0.2 },
});
