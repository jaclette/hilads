import { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, Alert, ScrollView, ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { proposeDate, withdrawProposal, approveDate, approveChallenge, rejectChallenge } from '@/api/challenges';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { ChallengeThreadSummary } from '@/types';

/**
 * PR3 — the "Schedule" band that sits above the chat input in /thread/[id].
 *
 * State machine driven entirely off the ChallengeThreadSummary:
 *
 *   phase='accepted', no proposal              → "📅 Propose a date" button
 *   phase='accepted', I proposed               → "⏳ Awaiting their approval" + Withdraw
 *   phase='accepted', they proposed (creator)  → "📅 They proposed …" + Approve + Counter-propose
 *   phase='accepted', they proposed (acceptor) → "📅 They proposed …" + Counter-propose
 *   phase='scheduled'                          → "✅ Meet on …" (locked card)
 *   phase ∈ {debrief, approved, rejected}     → nothing (handled in PR4)
 *
 * Picker UX: pills (date offsets + time presets). Zero deps, fast, fits
 * Hilads' "dead simple" rule. A real datetime picker is the upgrade path.
 */
export function ThreadScheduleBlock({
  thread,
  myUserId,
  onChange,            // called after any successful mutation — host refreshes the summary
}: {
  thread: ChallengeThreadSummary;
  myUserId: string;
  onChange: () => void;
}) {
  const { t }  = useTranslation('challenge');
  const [busy, setBusy] = useState<'propose' | 'approve' | 'withdraw' | 'verdict' | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const hasProposal  = thread.proposed_starts_at !== null;
  const iProposed    = hasProposal && thread.proposed_by_user_id === myUserId;
  const iAmCreator   = thread.i_am_creator;
  // PR4 — render off effective_phase. The server flips 'scheduled' to 'debrief'
  // once the meetup's end time has passed (cross-checked again on the server
  // when the creator hits approve-challenge / reject-challenge).
  const phase        = thread.effective_phase ?? thread.phase;

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleApprove() {
    setBusy('approve');
    try {
      await approveDate(thread.id);
      onChange();
    } catch {
      Alert.alert(t('schedule.err.approveFailed'));
    } finally {
      setBusy(null);
    }
  }

  function handleWithdraw() {
    Alert.alert(
      t('schedule.withdraw.title'),
      t('schedule.withdraw.body'),
      [
        { text: t('cancel', { ns: 'common' }), style: 'cancel' },
        {
          text: t('schedule.withdraw.confirm'),
          style: 'destructive',
          onPress: async () => {
            setBusy('withdraw');
            try { await withdrawProposal(thread.id); onChange(); }
            catch { Alert.alert(t('schedule.err.withdrawFailed')); }
            finally { setBusy(null); }
          },
        },
      ],
    );
  }

  async function handlePicker(startsAtUnix: number, endsAtUnix: number | null, venue: string | null) {
    setBusy('propose');
    setPickerOpen(false);
    try {
      await proposeDate(thread.id, startsAtUnix, endsAtUnix, venue);
      onChange();
    } catch {
      Alert.alert(t('schedule.err.proposeFailed'));
    } finally {
      setBusy(null);
    }
  }

  // PR4 — debrief verdicts. Both are final, so confirm via Alert before firing.
  function handleVerdict(kind: 'approve' | 'reject') {
    Alert.alert(
      t(`debrief.confirm.${kind}.title`),
      t(`debrief.confirm.${kind}.body`),
      [
        { text: t('cancel', { ns: 'common' }), style: 'cancel' },
        {
          text: t(`debrief.confirm.${kind}.confirm`),
          style: kind === 'reject' ? 'destructive' : 'default',
          onPress: async () => {
            setBusy('verdict');
            try {
              if (kind === 'approve') await approveChallenge(thread.id);
              else                    await rejectChallenge(thread.id);
              onChange();
            } catch {
              Alert.alert(t(`debrief.err.${kind}Failed`));
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  }

  // ── Render: phase='scheduled' (meetup in the future) ──────────────────────
  if (phase === 'scheduled' && thread.proposed_starts_at) {
    return (
      <View style={[styles.band, styles.bandScheduled]}>
        <Ionicons name="checkmark-circle" size={18} color="#22c55e" />
        <View style={styles.bandTextWrap}>
          <Text style={styles.bandTitleScheduled}>{t('schedule.scheduled.title')}</Text>
          <Text style={styles.bandSubtitle} numberOfLines={2}>
            {formatDateLine(thread.proposed_starts_at, thread.proposed_ends_at, thread.proposed_venue)}
          </Text>
        </View>
      </View>
    );
  }

  // ── PR4: debrief (meetup is over, creator decides) ─────────────────────────
  if (phase === 'debrief') {
    if (iAmCreator) {
      return (
        <View style={[styles.band, styles.bandDebrief]}>
          <Ionicons name="help-circle-outline" size={18} color="#FF7A3C" />
          <View style={styles.bandTextWrap}>
            <Text style={styles.bandTitle}>{t('debrief.creatorPrompt.title')}</Text>
            <Text style={styles.bandSubtitle} numberOfLines={1}>
              {t('debrief.creatorPrompt.body', { name: thread.counterparty.displayName })}
            </Text>
          </View>
          <View style={styles.bandActions}>
            <TouchableOpacity
              style={styles.actionReject}
              onPress={() => handleVerdict('reject')}
              activeOpacity={0.85}
              disabled={busy !== null}
              accessibilityLabel={t('debrief.confirm.reject.confirm')}
            >
              {busy === 'verdict'
                ? <ActivityIndicator size="small" color={Colors.muted} />
                : <Ionicons name="close" size={18} color={Colors.muted} />}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionPrimary}
              onPress={() => handleVerdict('approve')}
              activeOpacity={0.85}
              disabled={busy !== null}
              accessibilityLabel={t('debrief.confirm.approve.confirm')}
            >
              {busy === 'verdict'
                ? <ActivityIndicator size="small" color={Colors.white} />
                : <Ionicons name="checkmark" size={18} color={Colors.white} />}
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    // Acceptor side — show a passive "waiting" pill.
    return (
      <View style={[styles.band, styles.bandDebrief]}>
        <Ionicons name="time-outline" size={18} color="#FF7A3C" />
        <View style={styles.bandTextWrap}>
          <Text style={styles.bandTitle}>{t('debrief.acceptorWaiting.title')}</Text>
          <Text style={styles.bandSubtitle} numberOfLines={1}>
            {t('debrief.acceptorWaiting.body', { name: thread.counterparty.displayName })}
          </Text>
        </View>
      </View>
    );
  }

  // ── PR4: approved (final ✅) ────────────────────────────────────────────────
  if (phase === 'approved') {
    return (
      <View style={[styles.band, styles.bandScheduled]}>
        <Text style={styles.verdictEmoji}>🎉</Text>
        <View style={styles.bandTextWrap}>
          <Text style={styles.bandTitleScheduled}>{t('debrief.approved.title')}</Text>
          {thread.approved_at && (
            <Text style={styles.bandSubtitle}>{formatVerdictDate(thread.approved_at)}</Text>
          )}
        </View>
      </View>
    );
  }

  // ── PR4: rejected (final, muted — softer tone than 'rejected' implies) ─────
  if (phase === 'rejected') {
    return (
      <View style={[styles.band, styles.bandRejected]}>
        <Ionicons name="close-circle-outline" size={18} color={Colors.muted} />
        <View style={styles.bandTextWrap}>
          <Text style={styles.bandTitle}>{t('debrief.rejected.title')}</Text>
          {thread.rejected_at && (
            <Text style={styles.bandSubtitle}>{formatVerdictDate(thread.rejected_at)}</Text>
          )}
        </View>
      </View>
    );
  }

  // ── Render: phase='accepted', no proposal ──────────────────────────────────
  if (!hasProposal) {
    return (
      <>
        <View style={styles.band}>
          <TouchableOpacity style={styles.proposeCta} onPress={() => setPickerOpen(true)} activeOpacity={0.85} disabled={busy !== null}>
            <Ionicons name="calendar-outline" size={16} color="#FF7A3C" />
            <Text style={styles.proposeCtaText}>{t('schedule.proposeCta')}</Text>
          </TouchableOpacity>
        </View>
        <DatePickerModal
          visible={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSubmit={handlePicker}
          submitLabel={t('schedule.proposeCta')}
        />
      </>
    );
  }

  // ── Render: phase='accepted', proposal exists ──────────────────────────────
  const proposerName = iProposed ? t('schedule.you') : thread.counterparty.displayName;

  return (
    <>
      <View style={[styles.band, styles.bandProposal]}>
        <Ionicons
          name={iProposed ? 'time-outline' : 'calendar-outline'}
          size={16}
          color="#FF7A3C"
        />
        <View style={styles.bandTextWrap}>
          <Text style={styles.bandTitle} numberOfLines={1}>
            {iProposed
              ? t('schedule.iProposedTitle')
              : t('schedule.theyProposedTitle', { name: proposerName })}
          </Text>
          <Text style={styles.bandSubtitle} numberOfLines={2}>
            {formatDateLine(thread.proposed_starts_at, thread.proposed_ends_at, thread.proposed_venue)}
          </Text>
        </View>
        <View style={styles.bandActions}>
          {/* Creator-only Approve, shown for ANY proposal (theirs or other's).
              Creator-proposed flow: they propose, then immediately tap Approve
              to lock — explicit by design (matches "creator approves" spec). */}
          {iAmCreator && (
            <TouchableOpacity style={styles.actionPrimary} onPress={handleApprove} activeOpacity={0.85} disabled={busy !== null}>
              {busy === 'approve'
                ? <ActivityIndicator size="small" color={Colors.white} />
                : <Ionicons name="checkmark" size={18} color={Colors.white} />}
            </TouchableOpacity>
          )}
          {/* Either party can counter-propose. */}
          <TouchableOpacity style={styles.actionSecondary} onPress={() => setPickerOpen(true)} activeOpacity={0.75} disabled={busy !== null}>
            <Ionicons name="create-outline" size={16} color={Colors.muted} />
          </TouchableOpacity>
          {/* Proposer can withdraw. */}
          {iProposed && (
            <TouchableOpacity style={styles.actionSecondary} onPress={handleWithdraw} activeOpacity={0.75} disabled={busy !== null}>
              {busy === 'withdraw'
                ? <ActivityIndicator size="small" color={Colors.muted} />
                : <Ionicons name="close" size={16} color={Colors.muted} />}
            </TouchableOpacity>
          )}
        </View>
      </View>
      <DatePickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSubmit={handlePicker}
        submitLabel={t('schedule.counterCta')}
        initialStartsAt={thread.proposed_starts_at}
        initialVenue={thread.proposed_venue}
      />
    </>
  );
}

// ── Date picker modal ────────────────────────────────────────────────────────

const TIME_PRESETS = [
  { key: '10:00', hours: 10, minutes: 0  },
  { key: '12:30', hours: 12, minutes: 30 },
  { key: '14:00', hours: 14, minutes: 0  },
  { key: '17:00', hours: 17, minutes: 0  },
  { key: '19:00', hours: 19, minutes: 0  },
  { key: '21:30', hours: 21, minutes: 30 },
];

function DatePickerModal({
  visible,
  onClose,
  onSubmit,
  submitLabel,
  initialStartsAt,
  initialVenue,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (startsAtUnix: number, endsAtUnix: number | null, venue: string | null) => void;
  submitLabel: string;
  initialStartsAt?: number | null;
  initialVenue?: string | null;
}) {
  const { t } = useTranslation('challenge');
  // Day offsets 0..7. Selected day, selected time preset, venue text.
  const [dayOffset, setDayOffset] = useState<number | null>(0);
  const [timeKey,   setTimeKey]   = useState<string | null>('19:00');
  const [venue,     setVenue]     = useState<string>(initialVenue ?? '');

  // Pre-fill from existing proposal if any (counter-propose path).
  // Note: doesn't preserve the exact previous time if not in the preset list —
  // user will see "19:00" and can adjust.
  useMemo(() => {
    if (initialStartsAt) {
      const d = new Date(initialStartsAt * 1000);
      const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
      const offset = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - todayMidnight.getTime()) / 86400000);
      if (offset >= 0 && offset <= 7) setDayOffset(offset);
      const hh = d.getHours();
      const mm = d.getMinutes();
      const matched = TIME_PRESETS.find(p => p.hours === hh && p.minutes === mm);
      if (matched) setTimeKey(matched.key);
    }
  }, [initialStartsAt]);

  const dayLabels = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Array.from({ length: 8 }, (_, i) => {
      const d = new Date(today); d.setDate(today.getDate() + i);
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      let label: string;
      if (i === 0) label = t('schedule.today');
      else if (i === 1) label = t('schedule.tomorrow');
      else label = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
      return { offset: i, label, isWeekend };
    });
  }, [t]);

  const canSubmit = dayOffset !== null && timeKey !== null;

  function submit() {
    if (dayOffset === null || timeKey === null) return;
    const preset = TIME_PRESETS.find(p => p.key === timeKey)!;
    const d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(preset.hours, preset.minutes, 0, 0);
    const startsAt = Math.floor(d.getTime() / 1000);
    const endsAt   = startsAt + 2 * 3600;  // default end = +2h
    const cleanVenue = venue.trim() || null;
    onSubmit(startsAt, endsAt, cleanVenue);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={modalStyles.backdrop}>
        <View style={modalStyles.sheet}>
          <View style={modalStyles.handle} />

          <View style={modalStyles.header}>
            <TouchableOpacity onPress={onClose} accessibilityLabel={t('cancel', { ns: 'common' })}>
              <Ionicons name="close" size={22} color={Colors.muted} />
            </TouchableOpacity>
            <Text style={modalStyles.title}>{t('schedule.picker.title')}</Text>
            <View style={{ width: 22 }} />
          </View>

          <ScrollView contentContainerStyle={modalStyles.scrollContent} keyboardShouldPersistTaps="handled">
            {/* Day pills */}
            <Text style={modalStyles.sectionLabel}>{t('schedule.picker.whenLabel')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={modalStyles.pillsRow}>
              {dayLabels.map(d => {
                const selected = d.offset === dayOffset;
                return (
                  <TouchableOpacity
                    key={d.offset}
                    style={[modalStyles.pill, selected && modalStyles.pillSelected]}
                    onPress={() => setDayOffset(d.offset)}
                    activeOpacity={0.7}
                  >
                    <Text style={[modalStyles.pillText, selected && modalStyles.pillTextSelected]}>{d.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Time pills */}
            <Text style={modalStyles.sectionLabel}>{t('schedule.picker.timeLabel')}</Text>
            <View style={modalStyles.pillsGrid}>
              {TIME_PRESETS.map(p => {
                const selected = p.key === timeKey;
                return (
                  <TouchableOpacity
                    key={p.key}
                    style={[modalStyles.pill, selected && modalStyles.pillSelected]}
                    onPress={() => setTimeKey(p.key)}
                    activeOpacity={0.7}
                  >
                    <Text style={[modalStyles.pillText, selected && modalStyles.pillTextSelected]}>{p.key}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Venue */}
            <Text style={modalStyles.sectionLabel}>{t('schedule.picker.whereLabel')}</Text>
            <TextInput
              style={modalStyles.venueInput}
              value={venue}
              onChangeText={setVenue}
              placeholder={t('schedule.picker.wherePlaceholder')}
              placeholderTextColor={Colors.muted2}
              maxLength={200}
              returnKeyType="done"
            />

            <TouchableOpacity
              style={[modalStyles.submit, !canSubmit && modalStyles.submitDisabled]}
              onPress={submit}
              disabled={!canSubmit}
              activeOpacity={0.85}
            >
              <Text style={modalStyles.submitText}>{submitLabel}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatVerdictDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' +
         d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatDateLine(startsAt: number | null, endsAt: number | null, venue: string | null): string {
  if (!startsAt) return '';
  const d = new Date(startsAt * 1000);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const dayMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  let dayLabel: string;
  if (dayMidnight.getTime() === today.getTime())         dayLabel = 'Today';
  else if (dayMidnight.getTime() === tomorrow.getTime()) dayLabel = 'Tomorrow';
  else dayLabel = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timeLabel = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const base = `${dayLabel} · ${timeLabel}`;
  return venue ? `${base} · ${venue}` : base;
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  band: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    backgroundColor:   'rgba(255,122,60,0.06)',
    borderTopWidth:    1,
    borderTopColor:    'rgba(255,122,60,0.18)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,122,60,0.18)',
  },
  bandProposal: {
    backgroundColor:   'rgba(255,122,60,0.10)',
  },
  bandScheduled: {
    backgroundColor:   'rgba(34,197,94,0.08)',
    borderTopColor:    'rgba(34,197,94,0.20)',
    borderBottomColor: 'rgba(34,197,94,0.20)',
  },
  bandDebrief: {
    backgroundColor:   'rgba(255,122,60,0.10)',
  },
  bandRejected: {
    backgroundColor:   'rgba(255,255,255,0.03)',
    borderTopColor:    'rgba(255,255,255,0.08)',
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  verdictEmoji: { fontSize: 18, marginLeft: 1 },
  actionReject: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  bandTextWrap: { flex: 1, minWidth: 0 },
  bandTitle:    { fontSize: FontSizes.sm, fontWeight: '800', color: Colors.text },
  bandTitleScheduled: { fontSize: FontSizes.sm, fontWeight: '800', color: '#22c55e' },
  bandSubtitle: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  bandActions:  { flexDirection: 'row', gap: 6 },

  proposeCta: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(255,122,60,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,122,60,0.30)',
  },
  proposeCtaText: { color: '#FF7A3C', fontWeight: '800', fontSize: 13, letterSpacing: 0.2 },

  actionPrimary: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#22c55e',
  },
  actionSecondary: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
});

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.bg,
    borderTopLeftRadius:  20,
    borderTopRightRadius: 20,
    paddingTop:           8,
    maxHeight:            '85%',
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
    fontSize: FontSizes.xs,
    fontWeight: '700',
    color: Colors.muted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: Spacing.sm,
  },

  pillsRow:  { gap: 8, paddingVertical: 4, paddingRight: Spacing.md },
  pillsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  pill: {
    paddingHorizontal: 14,
    paddingVertical:   8,
    borderRadius:      Radius.full,
    backgroundColor:   Colors.bg2,
    borderWidth:       1,
    borderColor:       Colors.border,
  },
  pillSelected: {
    backgroundColor: 'rgba(255,122,60,0.14)',
    borderColor:     '#FF7A3C',
  },
  pillText: { color: Colors.muted, fontWeight: '600', fontSize: FontSizes.sm },
  pillTextSelected: { color: '#FF7A3C', fontWeight: '800' },

  venueInput: {
    backgroundColor: Colors.bg2,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm + 2,
    fontSize: FontSizes.md,
    color: Colors.text,
  },

  submit: {
    marginTop: Spacing.md,
    backgroundColor: '#FF7A3C',
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.45 },
  submitText: { color: Colors.white, fontWeight: '800', fontSize: FontSizes.md, letterSpacing: 0.2 },
});
