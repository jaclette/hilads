import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { socket } from '@/lib/socket';
import {
  ackScoreCelebration,
  fetchScoreCelebration,
  type ScoreCelebration,
} from '@/api/challenges';
import { ScoreCelebrationModal } from './ScoreCelebrationModal';

/**
 * Auto-open the "+X points!" celebration on app cold-start when the user
 * has unacknowledged score_events since their last popin.
 *
 * Mounted in app/_layout.tsx so it sits above the nav stack - same pattern
 * as RatePromptLaunchGate. The two gates coexist: if the user has both a
 * pending rating AND pending points, the score popin fires first (cheap +
 * non-blocking; users complete it in a tap and the rate-sheet follows on
 * the same screen because the rate gate's effect is keyed independently).
 *
 * Per-session policy:
 *   - Fires ONCE per fresh _layout mount.
 *   - Server acknowledges via POST /me/score-celebration/seen on close so
 *     the same delta is never celebrated twice across devices.
 *   - Guests bail (account?.id required; the API is auth-gated anyway).
 */
export function ScoreCelebrationLaunchGate() {
  const router = useRouter();
  const { account } = useApp();
  const [data,   setData]   = useState<ScoreCelebration | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!account?.id) { setData(null); setClosed(false); return; }
    if (closed) return;

    (async () => {
      const result = await fetchScoreCelebration();
      if (cancelled) return;
      if (result.points > 0) setData(result);
    })();
    return () => { cancelled = true; };
  }, [account?.id, closed]);

  // Live re-fetch triggers. Any WS event that emits score_events
  // server-side fetches /me/score-celebration directly here and
  // surfaces the popin if there's a non-zero delta. We can't rely on
  // the cold-start effect above re-firing - setting closed=false
  // when it's already false is a React no-op and the dep change is
  // skipped. Direct fetch sidesteps that.
  //
  // Two surfaces today:
  //   - mutual_rating_complete: debrief +30/+40 lands
  //   - challenge_date_approved: date_locked +5/+5 lands
  // Both broadcast to BOTH parties, so the listener fires on
  // whichever side earned points.
  useEffect(() => {
    if (!account?.id) return;
    const trigger = async () => {
      try {
        const result = await fetchScoreCelebration();
        if (result?.points > 0) {
          setClosed(false);
          setData(result);
        }
      } catch {
        // non-fatal - gate stays as-is, user can re-launch the app
      }
    };
    const offRating = socket.on('mutual_rating_complete',  trigger);
    const offDate   = socket.on('challenge_date_approved', trigger);
    // Take-on accepted: phase → 'accepted' fired +5/+5 to challenger + taker.
    // Broadcast to BOTH parties (international/invited accept, and the creator's
    // approve-takeon for local), so the "+5 points!" popin lands on whichever
    // side earned it without a reload.
    const offAccept = socket.on('challenge_accepted',      trigger);
    // International debrief: photo approval = the verdict. The proof_verdict
    // trigger fires +30/+40 score events on phase = 'approved', and the
    // backend broadcasts challenge_proof_approved to both creator and
    // acceptor. Subscribe here so the modal pops without a reload.
    const offProof  = socket.on('challenge_proof_approved', trigger);
    // Challenge created: the +10 challenge_created reward fires on creation.
    // The backend pings the creator's room so the "+10 points!" modal pops
    // right after they launch a challenge (self-gates if the daily cap hit).
    const offCreate = socket.on('challenge_created_self', trigger);
    return () => { offRating(); offDate(); offAccept(); offProof(); offCreate(); };
  }, [account?.id]);

  // Shared cleanup - ack + close. Used by both the CTA path and the
  // rank-row tap path so the watermark always advances when the modal
  // closes for any reason.
  function ackAndClose() {
    if (data?.seen_until) {
      void ackScoreCelebration(data.seen_until);
    }
    setData(null);
    setClosed(true);
  }

  // PR38 - tap a rank row → ack, close, navigate to the leaderboard
  // pre-scoped to that lens via the /leaderboard?scope=world query param.
  function handleOpenLeaderboard(scope: 'city' | 'world') {
    ackAndClose();
    router.push(scope === 'world'
      ? { pathname: '/leaderboard', params: { scope: 'world' } }
      : { pathname: '/leaderboard' });
  }

  return (
    <ScoreCelebrationModal
      data={data}
      visible={data !== null}
      onClose={ackAndClose}
      onOpenLeaderboard={handleOpenLeaderboard}
    />
  );
}
