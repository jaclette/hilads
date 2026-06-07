import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useApp } from '@/context/AppContext';
import { fetchRatePrompts } from '@/api/challenges';
import { RateSheet } from '@/components/RateSheet';
import { socket } from '@/lib/socket';
import type { RatePrompt } from '@/types';

/**
 * Auto-open the RateSheet when the caller has at least one rate-eligible
 * meet-up (proposed_ends_at < now() AND not yet rated). Three triggers:
 *
 *   1. Cold start — the effect runs once `account.id` is known.
 *   2. WS event `rating_received` — the counterparty just rated; surface
 *      the sheet without waiting for the user to reopen the app.
 *   3. AppState 'active' transition — covers the case where the user was
 *      backgrounded when the WS event fired (socket disconnected, server
 *      doesn't replay): every foreground refetches, so a push-tap landing
 *      back in the app finds the prompt within ms.
 *
 * Per-session policy:
 *   - After submit OR dismiss ("Not now"), the gate stays closed for the
 *     rest of the session UNLESS a fresh trigger above arrives. The
 *     `closed` flag is cleared by the WS event and by `'active'` so a new
 *     rating poke reopens it even if the user dismissed an earlier prompt.
 *
 * Anon / guest viewers skip entirely (the API is auth-gated anyway).
 */
export function RatePromptLaunchGate() {
  const { account } = useApp();
  const [prompt,  setPrompt]  = useState<RatePrompt | null>(null);
  const [closed,  setClosed]  = useState(false);
  // refetchNonce bumped by the WS/AppState handlers to force the fetch
  // effect to re-run even when `closed` was already false.
  const [refetchNonce, setRefetchNonce] = useState(0);
  const appState = useRef(AppState.currentState);

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
  }, [account?.id, closed, refetchNonce]);

  // WS poke from /ratings when the counterparty submits the FIRST rating
  // for any of this user's challenges. Reset closed + bump nonce so the
  // sheet pops back open even mid-session.
  useEffect(() => {
    if (!account?.id) return;
    const off = socket.on('rating_received', () => {
      setClosed(false);
      setPrompt(null);
      setRefetchNonce(n => n + 1);
    });
    return () => { off(); };
  }, [account?.id]);

  // AppState — every background→active transition refetches. Covers the
  // backgrounded-WS-missed case (push tap brings user back; WS reconnects
  // but the server doesn't replay, so we resync here).
  useEffect(() => {
    if (!account?.id) return;
    const sub = AppState.addEventListener('change', next => {
      const prev = appState.current;
      appState.current = next;
      if (next === 'active' && prev !== 'active') {
        setClosed(false);
        setRefetchNonce(n => n + 1);
      }
    });
    return () => sub.remove();
  }, [account?.id]);

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
