import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { dailyErrorCode, fetchDailyProofStates, unvoteDailyProof, voteDailyProof } from '@/api/daily';
import type { DailyProof, DailyVoteState } from '@/types';

// Daily Challenge votes, shared by every place a proof shows (channel card,
// sheet tile, viewer, results) so they always agree. Filled from the data the
// screens already load (sheet, today); channel cards, whose payload is a
// snapshot from approval, ask for the live state in batches
// (GET /daily/proofs/state). Votes are optimistic with rollback.
// Counts stay live: every 30 s, proofs on screen whose voting is still open are
// asked again (one batched call), only while the app is in the foreground.

const STALE_MS = 60_000;
const REFRESH_MS = 30_000;
const BATCH_MS = 250;
const BATCH_MAX = 50;

type Entry = DailyVoteState & { at: number };

const states = new Map<string, Entry>();
let votesLeft: number | null = null;     // for today's challenge; null = unknown / guest
let viewerKey: string | null = null;     // states are per viewer
let viewerSet = false;
const listeners = new Set<() => void>();
let version = 0;

// Proof data also carries comments (count, 2 latest): comments.ts listens here.
type StateSink = (proofId: string, commentCount: number | undefined, latest?: DailyVoteState['latestComments']) => void;
const sinks = new Set<StateSink>();
export function onProofStates(sink: StateSink) { sinks.add(sink); }

function emit() {
  version++;
  listeners.forEach(l => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Forget everything when the viewer changes (sign in / out); the first call only records it. */
export function setVoteViewer(key: string | null) {
  if (viewerSet && key === viewerKey) return;
  const first = !viewerSet;
  viewerSet = true;
  viewerKey = key;
  if (first) return;
  states.clear();
  votesLeft = null;
  emit();
}

/** Store the state of proofs a screen just loaded. */
export function seedProofs(proofs: (DailyProof | null | undefined)[], votingOpen: boolean) {
  const at = Date.now();
  let changed = false;
  for (const p of proofs) {
    if (!p || p.status !== 'approved') continue;
    states.set(p.id, {
      voteCount: p.voteCount, validatedByLocal: p.validatedByLocal, myVote: p.myVote,
      isMine: p.isMine, votingOpen, at,
    });
    sinks.forEach(f => f(p.id, p.commentCount));
    changed = true;
  }
  if (changed) emit();
}

export function seedVotesLeft(left: number | null | undefined) {
  if (left === undefined || left === votesLeft) return;
  votesLeft = left;
  emit();
}

// ── Batched state requests (channel cards, viewer) ─────────────────────────

const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let batchGuestId: string | null = null;

/** Ask for a proof's live state unless it is fresh. Batched. */
export function requestVoteState(proofId: string, guestId?: string | null, maxAge = STALE_MS) {
  const s = states.get(proofId);
  if (s && Date.now() - s.at < maxAge) return;
  pending.add(proofId);
  batchGuestId = guestId ?? null;
  if (!timer) timer = setTimeout(flush, BATCH_MS);
}

async function flush() {
  timer = null;
  const ids = [...pending];
  pending.clear();
  for (let i = 0; i < ids.length; i += BATCH_MAX) {
    const chunk = ids.slice(i, i + BATCH_MAX);
    try {
      const res = await fetchDailyProofStates(chunk, batchGuestId);
      const at = Date.now();
      for (const [id, st] of Object.entries(res.items)) {
        states.set(id, { ...st, at });
        sinks.forEach(f => f(id, st.commentCount, st.latestComments));
      }
      if (res.myVotes) votesLeft = res.myVotes.left;
      emit();
    } catch (err) {
      console.warn('[daily] vote states failed:', String(err));
    }
  }
}

// ── Live refresh of the proofs on screen ───────────────────────────────────

const watched = new Map<string, number>();   // proof id → mounted cards showing it
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function watchProof(proofId: string) {
  watched.set(proofId, (watched.get(proofId) ?? 0) + 1);
  refreshTimer ??= setInterval(refreshWatched, REFRESH_MS);
}

function unwatchProof(proofId: string) {
  const n = (watched.get(proofId) ?? 1) - 1;
  if (n <= 0) watched.delete(proofId); else watched.set(proofId, n);
  if (watched.size === 0 && refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function refreshWatched() {
  if (AppState.currentState !== 'active') return;
  for (const id of watched.keys()) {
    if (states.get(id)?.votingOpen === false) continue;   // closed: the count is final
    requestVoteState(id, batchGuestId, REFRESH_MS - 1000);
  }
}

// ── Hooks ──────────────────────────────────────────────────────────────────

export function useVoteState(proofId: string | null | undefined, guestId?: string | null): DailyVoteState | null {
  useSyncExternalStore(subscribe, () => version);
  useEffect(() => {
    if (!proofId) return;
    requestVoteState(proofId, guestId);
    watchProof(proofId);
    return () => unwatchProof(proofId);
  }, [proofId, guestId]);
  return proofId ? states.get(proofId) ?? null : null;
}

export function useVotesLeft(): number | null {
  useSyncExternalStore(subscribe, () => version);
  return votesLeft;
}

// ── Voting ─────────────────────────────────────────────────────────────────

/**
 * Vote, or withdraw my vote, on a proof. Optimistic; rolls back on error.
 * Returns null on success, else the API error code ('vote_limit',
 * 'voting_closed', 'rate_limited', 'own_proof', 'not_found', 'generic').
 */
export async function toggleVote(proofId: string): Promise<{ error: string | null; voted: boolean }> {
  const before = states.get(proofId);
  if (!before) return { error: 'generic', voted: false };
  const leftBefore = votesLeft;
  const voting = !before.myVote;

  states.set(proofId, {
    ...before,
    myVote: voting,
    voteCount: Math.max(0, before.voteCount + (voting ? 1 : -1)),
  });
  if (votesLeft !== null) votesLeft = Math.max(0, votesLeft + (voting ? -1 : 1));
  emit();

  try {
    const res = voting ? await voteDailyProof(proofId) : await unvoteDailyProof(proofId);
    states.set(proofId, {
      ...before, myVote: res.voted, voteCount: res.voteCount, validatedByLocal: res.validatedByLocal, at: Date.now(),
    });
    votesLeft = res.votesLeft;
    emit();
    return { error: null, voted: res.voted };
  } catch (err) {
    const code = dailyErrorCode(err) ?? 'generic';
    states.set(proofId, code === 'voting_closed' ? { ...before, votingOpen: false } : before);
    votesLeft = code === 'vote_limit' ? 0 : leftBefore;
    emit();
    return { error: code, voted: before.myVote };
  }
}
