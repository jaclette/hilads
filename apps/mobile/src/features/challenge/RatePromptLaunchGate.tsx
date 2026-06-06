import { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { fetchRatePrompts } from '@/api/challenges';
import { RateSheet } from '@/components/RateSheet';
import type { RatePrompt } from '@/types';

/**
 * Auto-open the RateSheet on app cold-start when the caller has at least one
 * rate-eligible meet-up (proposed_ends_at < now() AND not yet rated).
 *
 * Mounted in app/_layout.tsx so it lives above the entire navigation stack;
 * the sheet renders over whatever tab the user landed on after login.
 *
 * Per-session policy:
 *   - Fires ONCE per fresh _layout mount (which is once per cold start).
 *   - After submit OR dismiss ("Not now"), the gate doesn't re-open in the
 *     same session — the existing on-/threads banner remains as the fallback
 *     surface for subsequent prompts and re-engagement.
 *
 * Other gates:
 *   - Anon / guest viewers skip entirely (account?.id required — the API
 *     requires auth anyway, but bailing client-side avoids a 401 in logs).
 *   - The fetch runs once per `account.id` change; switching accounts in the
 *     same session re-fires the gate for the new account.
 */
export function RatePromptLaunchGate() {
  const { account } = useApp();
  const [prompt,  setPrompt]  = useState<RatePrompt | null>(null);
  const [closed,  setClosed]  = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!account?.id) { setPrompt(null); setClosed(false); return; }
    if (closed) return; // already shown + dismissed this session

    (async () => {
      const prompts = await fetchRatePrompts();
      if (cancelled || prompts.length === 0) return;
      setPrompt(prompts[0]);
    })();
    return () => { cancelled = true; };
  }, [account?.id, closed]);

  function handleClose() {
    setPrompt(null);
    setClosed(true);
  }

  // RateSheet's onSubmitted fires after a successful POST. It also fires on
  // recoverable races (409 / 403) where the prompt was stale — either way
  // we treat it as "this prompt is done" and don't re-show.
  function handleSubmitted() {
    setPrompt(null);
    setClosed(true);
  }

  return (
    <RateSheet
      prompt={prompt}
      visible={prompt !== null}
      onClose={handleClose}
      onSubmitted={handleSubmitted}
    />
  );
}
