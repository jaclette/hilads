import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { proposeDate, withdrawProposal, approveDate } from '@/api/challenges';
import { FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import type { ChallengeThreadSummary } from '@/types';
import { DatePickerModal } from './DatePickerModal';

/**
 * PR3 - the "Schedule" band that sits above the chat input in /thread/[id].
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
  onChange,            // called after any successful mutation - host refreshes the summary
  hideEmptyCta = false, // when true + no proposal yet, render nothing (parent
                       // owns that CTA via the pipeline's sub-CTA instead)
}: {
  thread: ChallengeThreadSummary;
  myUserId: string;
  onChange: () => void;
  hideEmptyCta?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t, i18n }  = useTranslation('challenge');
  const locale = i18n.language;
  const [busy, setBusy] = useState<'propose' | 'approve' | 'withdraw' | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const hasProposal  = thread.proposed_starts_at !== null;
  const iProposed    = hasProposal && thread.proposed_by_user_id === myUserId;
  const iAmCreator   = thread.i_am_creator;
  // PR4 - render off effective_phase. The server flips 'scheduled' to 'debrief'
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

  // ── Render: phase='scheduled' (meetup in the future) ──────────────────────
  // Either party can tap anywhere on the band to reschedule - the backend
  // flips phase back to 'accepted', clears date_approved_at, and the other
  // party re-approves the new proposal. The whole row is the touch target
  // (a 32×32 pencil button was too small to land reliably); the pencil
  // stays as a visual cue.
  if (phase === 'scheduled' && thread.proposed_starts_at) {
    return (
      <>
        <TouchableOpacity
          style={[styles.band, styles.bandScheduled]}
          onPress={() => setPickerOpen(true)}
          activeOpacity={0.75}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityLabel={t('schedule.editCta')}
        >
          <Ionicons name="checkmark-circle" size={18} color="#22c55e" />
          <View style={styles.bandTextWrap}>
            <Text style={styles.bandTitleScheduled}>{t('schedule.scheduled.title')}</Text>
            <Text style={styles.bandSubtitle} numberOfLines={2}>
              {formatDateLine(thread.proposed_starts_at, thread.proposed_ends_at, thread.proposed_venue, locale, t)}
            </Text>
          </View>
          <View style={styles.actionSecondary}>
            <Ionicons name="pencil" size={16} color={colors.muted} />
          </View>
        </TouchableOpacity>
        {pickerOpen && (
          <DatePickerModal
            visible={pickerOpen}
            onClose={() => setPickerOpen(false)}
            onSubmit={async (startsAt, endsAt, venue) => {
              setBusy('propose');
              setPickerOpen(false);
              try { await proposeDate(thread.id, startsAt, endsAt, venue); onChange?.(); }
              catch { Alert.alert(t('schedule.err.proposeFailed')); }
              finally { setBusy(null); }
            }}
            submitLabel={t('schedule.editCta')}
            initialStartsAt={thread.proposed_starts_at}
            initialEndsAt={thread.proposed_ends_at}
            initialVenue={thread.proposed_venue ?? undefined}
          />
        )}
      </>
    );
  }

  // PR6 - the manual creator-verdict block that used to live here was retired
  // when the mutual-rating flow shipped. The DB trigger on challenge_ratings
  // now flips phase to 'approved' on the second rating, so 'debrief' is a
  // transient phase the user resolves by tapping the rate-prompt banner on
  // /threads (see RateSheet). No band rendered while in 'debrief'.

  // ── PR4: approved (final ✅) ────────────────────────────────────────────────
  if (phase === 'approved') {
    return (
      <View style={[styles.band, styles.bandScheduled]}>
        <Text style={styles.verdictEmoji}>🎉</Text>
        <View style={styles.bandTextWrap}>
          <Text style={styles.bandTitleScheduled}>{t('debrief.approved.title')}</Text>
          {thread.approved_at && (
            <Text style={styles.bandSubtitle}>{formatVerdictDate(thread.approved_at, locale)}</Text>
          )}
        </View>
      </View>
    );
  }

  // ── PR4: rejected (final, muted - softer tone than 'rejected' implies) ─────
  if (phase === 'rejected') {
    return (
      <View style={[styles.band, styles.bandRejected]}>
        <Ionicons name="close-circle-outline" size={18} color={colors.muted} />
        <View style={styles.bandTextWrap}>
          <Text style={styles.bandTitle}>{t('debrief.rejected.title')}</Text>
          {thread.rejected_at && (
            <Text style={styles.bandSubtitle}>{formatVerdictDate(thread.rejected_at, locale)}</Text>
          )}
        </View>
      </View>
    );
  }

  // ── Render: phase='accepted', no proposal ──────────────────────────────────
  // When hideEmptyCta is set, the parent (e.g. /challenge/[id]) owns the
  // initial-propose action - it's reached via the pipeline's "Propose a date →"
  // sub-CTA so we don't duplicate it here.
  if (!hasProposal) {
    if (hideEmptyCta) return null;
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
            {formatDateLine(thread.proposed_starts_at, thread.proposed_ends_at, thread.proposed_venue, locale, t)}
          </Text>
        </View>
        <View style={styles.bandActions}>
          {/* The party who did NOT propose signs off. Previously this
              was gated on iAmCreator, which meant the challenger could
              approve their OWN proposal (defeating the mutual-agreement
              point) and the taker had no way to approve a creator-side
              proposal at all. */}
          {!iProposed && (
            <TouchableOpacity style={styles.actionPrimary} onPress={handleApprove} activeOpacity={0.85} disabled={busy !== null}>
              {busy === 'approve'
                ? <ActivityIndicator size="small" color={colors.white} />
                : <Ionicons name="checkmark" size={18} color={colors.white} />}
            </TouchableOpacity>
          )}
          {/* Either party can counter-propose. */}
          <TouchableOpacity style={styles.actionSecondary} onPress={() => setPickerOpen(true)} activeOpacity={0.75} disabled={busy !== null}>
            <Ionicons name="create-outline" size={16} color={colors.muted} />
          </TouchableOpacity>
          {/* Proposer can withdraw. */}
          {iProposed && (
            <TouchableOpacity style={styles.actionSecondary} onPress={handleWithdraw} activeOpacity={0.75} disabled={busy !== null}>
              {busy === 'withdraw'
                ? <ActivityIndicator size="small" color={colors.muted} />
                : <Ionicons name="close" size={16} color={colors.muted} />}
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
        initialEndsAt={thread.proposed_ends_at}
        initialVenue={thread.proposed_venue}
      />
    </>
  );
}


// ── Helpers ──────────────────────────────────────────────────────────────────

function formatVerdictDate(unixSeconds: number, locale: string): string {
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' }) + ' · ' +
         d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

// `locale` + `t` are threaded in from the component so we render the date in
// the i18n language (not the device locale, which is often English even for
// French-speaking users). Today/Tomorrow read from existing schedule keys.
function formatDateLine(
  startsAt: number | null,
  endsAt: number | null,
  venue: string | null,
  locale: string,
  t: (key: string) => string,
): string {
  if (!startsAt) return '';
  const d = new Date(startsAt * 1000);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const dayMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  let dayLabel: string;
  if (dayMidnight.getTime() === today.getTime())         dayLabel = t('schedule.today');
  else if (dayMidnight.getTime() === tomorrow.getTime()) dayLabel = t('schedule.tomorrow');
  else dayLabel = d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
  const timeLabel = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const base = `${dayLabel} · ${timeLabel}`;
  return venue ? `${base} · ${venue}` : base;
}

// ── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
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
  bandRejected: {
    backgroundColor:   c.overlayWeak,
    borderTopColor:    c.overlay,
    borderBottomColor: c.overlay,
  },
  verdictEmoji: { fontSize: 18, marginLeft: 1 },
  bandTextWrap: { flex: 1, minWidth: 0 },
  bandTitle:    { fontSize: FontSizes.sm, fontWeight: '800', color: c.text },
  bandTitleScheduled: { fontSize: FontSizes.sm, fontWeight: '800', color: '#22c55e' },
  bandSubtitle: { fontSize: 12, color: c.muted, marginTop: 2 },
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
    backgroundColor: c.overlay,
    borderWidth: 1,
    borderColor: c.overlayStrong,
  },
});

