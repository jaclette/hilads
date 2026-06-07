import { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
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
 * Mounted in app/_layout.tsx so it sits above the nav stack — same pattern
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

  function handleClose() {
    // Ack BEFORE clearing local state so the watermark advances even if
    // the user immediately backgrounds the app. Fire-and-forget — the
    // ack helper swallows network errors (worst case the popin re-shows
    // next launch, which is harmless).
    if (data?.seen_until) {
      void ackScoreCelebration(data.seen_until);
    }
    setData(null);
    setClosed(true);
  }

  return (
    <ScoreCelebrationModal
      data={data}
      visible={data !== null}
      onClose={handleClose}
    />
  );
}
