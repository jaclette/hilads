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
  // server-side should reset `closed` + clear `data` so the existing
  // fetch effect re-runs and the popin surfaces without the user
  // having to relaunch the app. Two known surfaces today:
  //   - mutual_rating_complete (PR47): debrief +30/+40 lands
  //   - challenge_date_approved:        date_locked +5/+5 lands
  // Both broadcast to BOTH parties (proposer + approver / rater +
  // ratee), so the listener fires on whichever side earned points.
  useEffect(() => {
    if (!account?.id) return;
    const trigger = () => { setClosed(false); setData(null); };
    const offRating = socket.on('mutual_rating_complete', trigger);
    const offDate   = socket.on('challenge_date_approved', trigger);
    return () => { offRating(); offDate(); };
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
