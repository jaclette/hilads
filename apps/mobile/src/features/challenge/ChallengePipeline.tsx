import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { ChallengeThreadSummary } from '@/types';

/**
 * Lifecycle visualizer that replaces the binary "Challenge in progress" pill
 * on the challenge detail screen. Shows the 4-step journey:
 *
 *   1. Accept   →   2. Date   →   3. Meet   →   4. Wrap up
 *
 * State source: the viewer's OWN acceptance (the per-relationship phase).
 * Visitors / creator-without-acceptance see all 4 dots muted as an educator.
 * Acceptors see the current step highlighted + a sub-CTA pointing to the
 * next action (which lives in the thread — tapping the pipeline navigates
 * there so the user can act).
 *
 * Why per-acceptance and not per-challenge: the challenge can have N
 * acceptances in N states. Picking one "current state" for the whole ad
 * doesn't reflect reality. Each viewer sees their own journey.
 */
type Step = 'accept' | 'date' | 'meet' | 'wrap';
const STEPS: Step[] = ['accept', 'date', 'meet', 'wrap'];

// Compact "Sat, Jun 6 · 9:30 PM" — locale-aware via Intl, kept short enough
// to fit on a single sub-CTA line. The schedule band uses a more verbose
// formatter (includes venue); this one is just for the pipeline preview.
function formatMeetupDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const day  = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
}

interface PipelineState {
  /** Which step is the active one. `null` when there's no acceptance to
   *  highlight (visitor / creator with no personal acceptance). */
  active: Step | null;
  /** Steps that are visibly complete (filled green w/ check). */
  done: Set<Step>;
  /** Whether the journey ended in 'rejected' (renders the wrap step muted/red). */
  rejected: boolean;
  /** i18n key under `pipeline.subcta.*` for the row below the dots. */
  subCtaKey: string;
  /** Optional interpolation arg for the subCTA key. */
  subCtaName?: string;
  /** Optional date interpolation (formatted at the call site). */
  subCtaDate?: string;
}

function derive(acceptance: ChallengeThreadSummary | null, iAmCreator: boolean): PipelineState {
  if (!acceptance) {
    // Visitor or creator without an own acceptance — educational view only.
    // Visitors don't get a sub-CTA here: the participants row below already
    // surfaces a labeled "Take on the challenge" button. Two CTAs side-by-
    // side read as the same call repeated twice (was: pipeline "Take on" +
    // a small + icon below). Creator still gets the passive "waiting" line.
    return {
      active: null,
      done: new Set(),
      rejected: false,
      subCtaKey: iAmCreator ? 'pipeline.subcta.creatorWaiting' : '',
    };
  }
  const phase = acceptance.effective_phase ?? acceptance.phase;
  const cpName = acceptance.counterparty.displayName;

  if (phase === 'accepted') {
    const hasProposal = acceptance.proposed_starts_at != null;
    return {
      active: 'date',
      done: new Set<Step>(['accept']),
      rejected: false,
      subCtaKey: hasProposal
        ? (iAmCreator ? 'pipeline.subcta.approveDate' : 'pipeline.subcta.dateAwaiting')
        : 'pipeline.subcta.proposeDate',
    };
  }
  if (phase === 'scheduled') {
    return {
      active: 'meet',
      done: new Set<Step>(['accept', 'date']),
      rejected: false,
      subCtaKey: 'pipeline.subcta.meetSoon',
      subCtaDate: acceptance.proposed_starts_at
        ? formatMeetupDate(acceptance.proposed_starts_at)
        : undefined,
    };
  }
  if (phase === 'debrief') {
    return {
      active: 'wrap',
      done: new Set<Step>(['accept', 'date', 'meet']),
      rejected: false,
      subCtaKey: iAmCreator ? 'pipeline.subcta.creatorVerdict' : 'pipeline.subcta.acceptorWaitingVerdict',
      subCtaName: iAmCreator ? cpName : cpName,
    };
  }
  if (phase === 'approved') {
    return {
      active: null,
      done: new Set<Step>(['accept', 'date', 'meet', 'wrap']),
      rejected: false,
      subCtaKey: 'pipeline.subcta.accomplished',
    };
  }
  // rejected
  return {
    active: null,
    done: new Set<Step>(['accept', 'date', 'meet']),
    rejected: true,
    subCtaKey: 'pipeline.subcta.closed',
  };
}

const STEP_ICONS: Record<Step, string> = {
  accept: '🤝',
  date:   '📅',
  meet:   '👋',
  wrap:   '✨',
};

export function ChallengePipeline({
  acceptance,
  iAmCreator,
  onPress,
}: {
  acceptance: ChallengeThreadSummary | null;
  iAmCreator: boolean;
  onPress?: () => void;
}) {
  const { t } = useTranslation('challenge');
  const state = derive(acceptance, iAmCreator);
  const interactive = !!onPress && !!acceptance;

  return (
    <TouchableOpacity
      style={styles.wrap}
      activeOpacity={interactive ? 0.7 : 1}
      onPress={interactive ? onPress : undefined}
      disabled={!interactive}
    >
      {/* Dots row */}
      <View style={styles.dotsRow}>
        {STEPS.map((step, i) => {
          const isDone   = state.done.has(step);
          const isActive = state.active === step;
          const isReject = state.rejected && step === 'wrap';
          const dotStyle =
            isReject ? styles.dotRejected
            : isDone ? styles.dotDone
            : isActive ? styles.dotActive
            : styles.dotIdle;
          return (
            <View key={step} style={styles.stepCol}>
              {/* Connector line to the LEFT of every dot except the first */}
              {i > 0 && (
                <View style={[
                  styles.connector,
                  (state.done.has(STEPS[i - 1]) || state.active === step) && styles.connectorDone,
                ]} />
              )}
              <View style={[styles.dot, dotStyle]}>
                {isDone
                  ? <Ionicons name="checkmark" size={14} color={Colors.white} />
                  : <Text style={[styles.dotEmoji, !isActive && styles.dotEmojiIdle]}>{STEP_ICONS[step]}</Text>}
              </View>
              <Text style={[
                styles.label,
                isActive && styles.labelActive,
                isDone && styles.labelDone,
                isReject && styles.labelReject,
              ]} numberOfLines={1}>
                {t(`pipeline.step.${step}`)}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Sub-CTA — current/next action hint. Empty key (visitor without
          acceptance) suppresses the row entirely — the participants row
          below carries the prominent labeled accept button instead. */}
      {!!state.subCtaKey && (
        <View style={styles.subCtaRow}>
          <Text style={styles.subCta} numberOfLines={1}>
            {t(state.subCtaKey, {
              ...(state.subCtaName ? { name: state.subCtaName } : {}),
              ...(state.subCtaDate ? { date: state.subCtaDate } : {}),
            })}
          </Text>
          {interactive && <Ionicons name="chevron-forward" size={14} color="#FF7A3C" />}
        </View>
      )}
    </TouchableOpacity>
  );
}

const DOT_SIZE = 30;

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    gap:               Spacing.sm,
  },

  dotsRow: {
    flexDirection: 'row',
    alignItems:    'flex-start',
  },
  stepCol: {
    flex:          1,
    alignItems:    'center',
    position:      'relative',
  },

  // Connector line — sits behind the dot, drawn at the dot's vertical centre.
  connector: {
    position:     'absolute',
    top:          DOT_SIZE / 2 - 1,
    left:         '-50%',
    right:        '50%',
    height:       2,
    backgroundColor: Colors.border,
  },
  connectorDone: {
    backgroundColor: '#FF7A3C',
  },

  dot: {
    width:           DOT_SIZE,
    height:          DOT_SIZE,
    borderRadius:    DOT_SIZE / 2,
    alignItems:      'center',
    justifyContent:  'center',
    borderWidth:     1.5,
  },
  dotIdle: {
    backgroundColor: Colors.bg2,
    borderColor:     Colors.border,
  },
  dotActive: {
    backgroundColor: 'rgba(255,122,60,0.15)',
    borderColor:     '#FF7A3C',
  },
  dotDone: {
    backgroundColor: '#FF7A3C',
    borderColor:     '#FF7A3C',
  },
  dotRejected: {
    backgroundColor: Colors.bg2,
    borderColor:     'rgba(255,255,255,0.20)',
  },
  dotEmoji:     { fontSize: 14 },
  dotEmojiIdle: { opacity: 0.45 },

  label: {
    fontSize:   10,
    fontWeight: '600',
    color:      Colors.muted,
    marginTop:  4,
    letterSpacing: 0.2,
  },
  labelActive: { color: '#FF7A3C', fontWeight: '800' },
  labelDone:   { color: Colors.text, fontWeight: '700' },
  labelReject: { color: Colors.muted2 },

  subCtaRow: {
    flexDirection: 'row',
    alignItems:    'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical:   6,
    paddingHorizontal: Spacing.sm,
    backgroundColor:   'rgba(255,122,60,0.08)',
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.20)',
  },
  subCta: { color: '#FF7A3C', fontWeight: '700', fontSize: FontSizes.xs + 1 },
});
