import { useEffect, useSyncExternalStore } from 'react';
import {
  dailyErrorCode, deletePhotoComment, fetchPhotoComments, likePhotoComment, postPhotoComment,
  reportPhotoComment, type PhotoCommentReportReason,
} from '@/api/daily';
import { socket } from '@/lib/socket';
import type { PhotoComment, User } from '@/types';
import { onProofStates, requestVoteState } from './votes';

// Comments on Daily photos, shared by every place a photo shows (chat card,
// story viewer, mosaic, viewers, the comments sheet) so they always agree.
// - the count and the 2 latest come with the photo's live state
//   (GET /daily/proofs/state, see votes.ts) and from the proofs screens load;
// - a photo on screen is watched on the socket ('proofComment': created,
//   deleted, liked), which keeps counts, previews and open threads live;
// - the sheet loads the thread (pages of 30, oldest first). Posting is
//   optimistic: the comment shows at once, 'failed' with a retry on error.

export type CommentItem = PhotoComment & {
  /** Local only: 'sending' until the server answers, 'failed' after an error. */
  pending?: 'sending' | 'failed';
  /** Local id of an optimistic comment (its id is negative until saved). */
  tempId?: string;
  /** Arrived live (ms), for a soft highlight. */
  liveAt?: number;
};

interface Thread {
  items:   CommentItem[];
  hasMore: boolean;
  loading: boolean;
  loaded:  boolean;
  error:   boolean;
}

export interface CommentSummary {
  count:   number;
  latest:  PhotoComment[];
  /** When the count last grew live (ms), for the chat card's highlight. */
  bumpedAt: number | null;
}

const counts  = new Map<string, number>();
const latest  = new Map<string, PhotoComment[]>();
const bumped  = new Map<string, number>();
const threads = new Map<string, Thread>();
const listeners = new Set<() => void>();
let version = 0;
let tempSeq = 0;

function emit() {
  version++;
  listeners.forEach(l => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Count (and 2 latest) of a photo from data a screen or the state call loaded. */
export function seedComments(proofId: string, count: number | undefined, last?: PhotoComment[]) {
  if (count === undefined) return;   // an older API: nothing to say
  let changed = counts.get(proofId) !== count;
  counts.set(proofId, count);
  if (last) { latest.set(proofId, last); changed = true; }
  if (changed) emit();
}

onProofStates(seedComments);

// ── Live updates ───────────────────────────────────────────────────────────

interface ProofCommentEvent {
  proofId:         string;
  kind:            'created' | 'deleted' | 'liked';
  comment?:        PhotoComment;
  commentId?:      number;
  likeCount?:      number;
  commentCount?:   number;
  latestComments?: PhotoComment[];
}

socket.on('proofComment', (raw) => {
  const e = raw as unknown as ProofCommentEvent;
  if (!e.proofId) return;
  if (typeof e.commentCount === 'number') {
    if (e.kind === 'created' && e.commentCount > (counts.get(e.proofId) ?? 0)) bumped.set(e.proofId, Date.now());
    counts.set(e.proofId, e.commentCount);
  }
  if (e.latestComments) latest.set(e.proofId, e.latestComments);
  const t = threads.get(e.proofId);
  if (t) {
    if (e.kind === 'created' && e.comment) {
      const c = e.comment;
      if (!t.items.some(i => i.id === c.id)) {
        // My own comment coming back before the POST answer: it replaces the optimistic one.
        const mine = t.items.findIndex(i => i.pending === 'sending' && i.user.id === c.user.id && i.body === c.body);
        if (mine >= 0) t.items[mine] = { ...c, isMine: true, canDelete: true };
        else t.items = [...t.items.filter(i => !i.pending), { ...c, liveAt: Date.now() }, ...t.items.filter(i => i.pending)];
      }
    } else if (e.kind === 'deleted') {
      t.items = t.items.filter(i => i.id !== e.commentId);
    } else if (e.kind === 'liked' && typeof e.likeCount === 'number') {
      t.items = t.items.map(i => (i.id === e.commentId ? { ...i, likeCount: e.likeCount! } : i));
    }
  }
  if (e.kind === 'liked') {
    const l = latest.get(e.proofId);
    if (l) latest.set(e.proofId, l.map(i => (i.id === e.commentId ? { ...i, likeCount: e.likeCount ?? i.likeCount } : i)));
  }
  emit();
});

// ── Hooks ──────────────────────────────────────────────────────────────────

/**
 * Count and 2 latest comments of a photo on screen. Asks for its live state
 * (batched) and watches it on the socket while mounted.
 */
export function useCommentSummary(proofId: string | null | undefined, guestId?: string | null): CommentSummary {
  useSyncExternalStore(subscribe, () => version);
  useEffect(() => {
    if (!proofId) return;
    requestVoteState(proofId, guestId);
    return socket.watchProof(proofId);
  }, [proofId, guestId]);
  return {
    count:    proofId ? counts.get(proofId) ?? 0 : 0,
    latest:   proofId ? latest.get(proofId) ?? [] : [],
    bumpedAt: proofId ? bumped.get(proofId) ?? null : null,
  };
}

const EMPTY_THREAD: Thread = { items: [], hasMore: false, loading: false, loaded: false, error: false };

/** The open thread of a photo (the sheet). Loads it, watches it. */
export function useCommentThread(proofId: string | null, guestId?: string | null): Thread {
  useSyncExternalStore(subscribe, () => version);
  useEffect(() => {
    if (!proofId) return;
    void loadThread(proofId, guestId);
    return socket.watchProof(proofId);
  }, [proofId, guestId]);
  return proofId ? threads.get(proofId) ?? EMPTY_THREAD : EMPTY_THREAD;
}

// ── Actions ────────────────────────────────────────────────────────────────

/** Load (or reload) the latest page; keeps my comments still being sent. */
export async function loadThread(proofId: string, guestId?: string | null): Promise<void> {
  const before = threads.get(proofId) ?? EMPTY_THREAD;
  threads.set(proofId, { ...before, loading: true, error: false });
  emit();
  try {
    const page = await fetchPhotoComments(proofId, null, guestId);
    const pending = (threads.get(proofId)?.items ?? []).filter(i => i.pending);
    threads.set(proofId, { items: [...page.items, ...pending], hasMore: page.hasMore, loading: false, loaded: true, error: false });
    counts.set(proofId, page.commentCount);
  } catch (err) {
    console.warn('[comments] load failed:', String(err));
    threads.set(proofId, { ...(threads.get(proofId) ?? before), loading: false, error: true });
  }
  emit();
}

/** Older comments, above the ones shown. */
export async function loadOlder(proofId: string, guestId?: string | null): Promise<void> {
  const t = threads.get(proofId);
  const first = t?.items.find(i => !i.pending);
  if (!t || !t.hasMore || t.loading || !first) return;
  threads.set(proofId, { ...t, loading: true });
  emit();
  try {
    const page = await fetchPhotoComments(proofId, first.id, guestId);
    const now = threads.get(proofId) ?? t;
    const known = new Set(now.items.map(i => i.id));
    threads.set(proofId, { ...now, items: [...page.items.filter(i => !known.has(i.id)), ...now.items], hasMore: page.hasMore, loading: false });
  } catch (err) {
    console.warn('[comments] older failed:', String(err));
    threads.set(proofId, { ...(threads.get(proofId) ?? t), loading: false });
  }
  emit();
}

/**
 * Post a comment (optimistic). Returns null when saved, else the API error
 * code ('moderation_blocked', 'rate_limited', 'invalid_body', 'signup_required', 'generic').
 */
export async function sendComment(
  proofId: string, body: string, me: User, replyTo: PhotoComment | null, photoIsMine: boolean, retryTempId?: string,
): Promise<string | null> {
  const tempId = retryTempId ?? `t${++tempSeq}`;
  const optimistic: CommentItem = {
    id: -(++tempSeq), photoId: proofId, body,
    user: { id: me.id, username: me.username ?? null, displayName: me.display_name ?? null, photoUrl: me.profile_photo_url ?? null, city: null },
    isAuthor: photoIsMine, isMine: true, canDelete: true, likeCount: 0, myLike: false,
    replyTo: replyTo ? { id: replyTo.id, username: replyTo.user.username, body: replyTo.body.slice(0, 120) } : null,
    mentions: [], createdAt: Math.floor(Date.now() / 1000), editedAt: null,
    pending: 'sending', tempId,
  };
  const t = threads.get(proofId) ?? { ...EMPTY_THREAD, loaded: true };
  threads.set(proofId, { ...t, items: [...t.items.filter(i => i.tempId !== tempId), optimistic] });
  counts.set(proofId, (counts.get(proofId) ?? 0) + (retryTempId ? 0 : 1));
  emit();
  try {
    const res = await postPhotoComment(proofId, body, replyTo?.id ?? null);
    const now = threads.get(proofId) ?? t;
    const saved = now.items.some(i => i.id === res.comment.id);
    threads.set(proofId, {
      ...now,
      items: saved ? now.items.filter(i => i.tempId !== tempId) : now.items.map(i => (i.tempId === tempId ? res.comment : i)),
    });
    counts.set(proofId, res.commentCount);
    emit();
    return null;
  } catch (err) {
    const code = dailyErrorCode(err) ?? 'generic';
    const now = threads.get(proofId) ?? t;
    if (code === 'moderation_blocked' || code === 'invalid_body' || code === 'signup_required') {
      // Not worth a retry: take it back, the composer keeps the text.
      threads.set(proofId, { ...now, items: now.items.filter(i => i.tempId !== tempId) });
      counts.set(proofId, Math.max(0, (counts.get(proofId) ?? 1) - 1));
    } else {
      threads.set(proofId, { ...now, items: now.items.map(i => (i.tempId === tempId ? { ...i, pending: 'failed' as const } : i)) });
    }
    emit();
    return code;
  }
}

/** Forget a failed comment (the user gave up on it). */
export function discardFailed(proofId: string, tempId: string) {
  const t = threads.get(proofId);
  if (!t) return;
  threads.set(proofId, { ...t, items: t.items.filter(i => i.tempId !== tempId) });
  counts.set(proofId, Math.max(0, (counts.get(proofId) ?? 1) - 1));
  emit();
}

export async function removeComment(proofId: string, id: number): Promise<boolean> {
  const t = threads.get(proofId);
  const before = t?.items;
  if (t) threads.set(proofId, { ...t, items: t.items.filter(i => i.id !== id) });
  emit();
  try {
    const res = await deletePhotoComment(id);
    counts.set(proofId, res.commentCount);
    const l = latest.get(proofId);
    if (l) latest.set(proofId, l.filter(i => i.id !== id));
    emit();
    return true;
  } catch (err) {
    console.warn('[comments] delete failed:', String(err));
    const now = threads.get(proofId);
    if (now && before) threads.set(proofId, { ...now, items: before });
    emit();
    return false;
  }
}

/** Heart a comment, or take it back. Optimistic. */
export async function toggleCommentLike(proofId: string, id: number): Promise<void> {
  const t = threads.get(proofId);
  const c = t?.items.find(i => i.id === id);
  if (!t || !c) return;
  const on = !c.myLike;
  const set = (likeCount: number, myLike: boolean) => {
    const now = threads.get(proofId) ?? t;
    threads.set(proofId, { ...now, items: now.items.map(i => (i.id === id ? { ...i, likeCount, myLike } : i)) });
    emit();
  };
  set(Math.max(0, c.likeCount + (on ? 1 : -1)), on);
  try {
    const res = await likePhotoComment(id, on);
    set(res.likeCount, res.myLike);
  } catch (err) {
    console.warn('[comments] like failed:', String(err));
    set(c.likeCount, c.myLike);
  }
}

/** Report a comment. Returns 'ok', 'already' or 'error'. */
export async function reportComment(id: number, reason: PhotoCommentReportReason, guestId?: string | null): Promise<'ok' | 'already' | 'error'> {
  try {
    await reportPhotoComment(id, reason, guestId);
    return 'ok';
  } catch (err) {
    return dailyErrorCode(err) === 'already_reported' ? 'already' : 'error';
  }
}
