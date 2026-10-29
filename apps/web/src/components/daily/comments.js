import { useEffect, useSyncExternalStore } from 'react'
import { deletePhotoComment, fetchDailyProofStates, fetchPhotoComments, likePhotoComment, postPhotoComment, reportPhotoComment } from '../../api'

// Comments on Daily photos (the app's features/daily/comments.ts): one store
// for every place a photo shows (chat card, stories, viewers, the sheet).
// - count and 2 latest come with the photo's live state (GET /daily/proofs/state);
// - a photo on screen is watched on the socket ('proofComment'), which keeps
//   counts, previews and open threads live (App binds its socket here);
// - the sheet loads the thread (pages of 30, oldest first); posting is
//   optimistic, 'failed' with a retry on error.

const counts = new Map()
const latest = new Map()
const bumped = new Map()
const threads = new Map()
const listeners = new Set()
let version = 0
let tempSeq = 0
const emit = () => { version++; listeners.forEach(l => l()) }
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l) }

const EMPTY = { items: [], hasMore: false, loading: false, loaded: false, error: false }

/** Count (and 2 latest) of a photo from data a screen or the state call loaded. */
export function seedComments(proofId, count, last) {
  if (count === undefined || count === null) return
  counts.set(proofId, count)
  if (last) latest.set(proofId, last)
  emit()
}

// ── Socket ───────────────────────────────────────────────────────────────

let socket = null
let offEvent = null
const watched = new Map()      // proof id → { n, off }

/** App's socket, once created (and again after a new one): watch the photos on screen with it. */
export function bindCommentsSocket(s) {
  if (socket === s) return
  offEvent?.()
  watched.forEach(w => w.off?.())
  socket = s
  offEvent = s ? s.on('proofComment', onEvent) : null
  watched.forEach((w, id) => { w.off = s ? s.watchProof(id) : null })
}

function watch(proofId) {
  const w = watched.get(proofId)
  if (w) { w.n++; return }
  watched.set(proofId, { n: 1, off: socket ? socket.watchProof(proofId) : null })
}

function unwatch(proofId) {
  const w = watched.get(proofId)
  if (!w) return
  if (--w.n > 0) return
  w.off?.()
  watched.delete(proofId)
}

function onEvent(e) {
  if (!e?.proofId) return
  if (typeof e.commentCount === 'number') {
    if (e.kind === 'created' && e.commentCount > (counts.get(e.proofId) ?? 0)) bumped.set(e.proofId, Date.now())
    counts.set(e.proofId, e.commentCount)
  }
  if (e.latestComments) latest.set(e.proofId, e.latestComments)
  const t = threads.get(e.proofId)
  if (t) {
    if (e.kind === 'created' && e.comment) {
      const c = e.comment
      if (!t.items.some(i => i.id === c.id)) {
        // My own comment back before the POST answer: it replaces the optimistic one.
        const mine = t.items.findIndex(i => i.pending === 'sending' && i.user.id === c.user.id && i.body === c.body)
        const items = [...t.items]
        if (mine >= 0) items[mine] = { ...c, isMine: true, canDelete: true }
        threads.set(e.proofId, {
          ...t,
          items: mine >= 0 ? items : [...t.items.filter(i => !i.pending), { ...c, liveAt: Date.now() }, ...t.items.filter(i => i.pending)],
        })
      }
    } else if (e.kind === 'deleted') {
      threads.set(e.proofId, { ...t, items: t.items.filter(i => i.id !== e.commentId) })
    } else if (e.kind === 'liked' && typeof e.likeCount === 'number') {
      threads.set(e.proofId, { ...t, items: t.items.map(i => (i.id === e.commentId ? { ...i, likeCount: e.likeCount } : i)) })
    }
  }
  emit()
}

// ── Batched state (photos without their count yet) ───────────────────────

const pending = new Set()
let timer = null
function request(proofId) {
  if (counts.has(proofId)) return
  pending.add(proofId)
  timer ??= setTimeout(async () => {
    timer = null
    const ids = [...pending].slice(0, 50)
    pending.clear()
    try {
      const r = await fetchDailyProofStates(ids)
      Object.entries(r.items || {}).forEach(([id, st]) => seedComments(id, st.commentCount, st.latestComments))
    } catch { /* the count stays unknown */ }
  }, 250)
}

// ── Hooks ────────────────────────────────────────────────────────────────

/** Count and 2 latest of a photo on screen; watched live while mounted. */
export function useCommentSummary(proofId) {
  useSyncExternalStore(subscribe, () => version)
  useEffect(() => {
    if (!proofId) return
    request(proofId)
    watch(proofId)
    return () => unwatch(proofId)
  }, [proofId])
  return {
    count: proofId ? counts.get(proofId) ?? 0 : 0,
    latest: proofId ? latest.get(proofId) ?? [] : [],
    bumpedAt: proofId ? bumped.get(proofId) ?? null : null,
  }
}

/** The open thread of a photo (the sheet): loads it and watches it. */
export function useCommentThread(proofId) {
  useSyncExternalStore(subscribe, () => version)
  useEffect(() => {
    if (!proofId) return
    loadThread(proofId)
    watch(proofId)
    return () => unwatch(proofId)
  }, [proofId])
  return proofId ? threads.get(proofId) ?? EMPTY : EMPTY
}

// ── Actions ──────────────────────────────────────────────────────────────

export async function loadThread(proofId) {
  const before = threads.get(proofId) ?? EMPTY
  threads.set(proofId, { ...before, loading: true, error: false })
  emit()
  try {
    const page = await fetchPhotoComments(proofId)
    const sending = (threads.get(proofId)?.items ?? []).filter(i => i.pending)
    threads.set(proofId, { items: [...page.items, ...sending], hasMore: page.hasMore, loading: false, loaded: true, error: false })
    counts.set(proofId, page.commentCount)
  } catch {
    threads.set(proofId, { ...(threads.get(proofId) ?? before), loading: false, error: true })
  }
  emit()
}

export async function loadOlder(proofId) {
  const t = threads.get(proofId)
  const first = t?.items.find(i => !i.pending)
  if (!t || !t.hasMore || t.loading || !first) return
  threads.set(proofId, { ...t, loading: true })
  emit()
  try {
    const page = await fetchPhotoComments(proofId, first.id)
    const now = threads.get(proofId) ?? t
    const known = new Set(now.items.map(i => i.id))
    threads.set(proofId, { ...now, items: [...page.items.filter(i => !known.has(i.id)), ...now.items], hasMore: page.hasMore, loading: false })
  } catch {
    threads.set(proofId, { ...(threads.get(proofId) ?? t), loading: false })
  }
  emit()
}

/** Post a comment (optimistic). Resolves null when saved, else the error code. */
export async function sendComment(proofId, body, me, replyTo, photoIsMine, retryTempId) {
  const tempId = retryTempId ?? `t${++tempSeq}`
  const optimistic = {
    id: -(++tempSeq), photoId: proofId, body,
    user: { id: me.id, username: me.username ?? null, displayName: me.display_name ?? null, photoUrl: me.profile_photo_url ?? null, city: null },
    isAuthor: photoIsMine, isMine: true, canDelete: true, likeCount: 0, myLike: false,
    replyTo: replyTo ? { id: replyTo.id, username: replyTo.user.username, body: replyTo.body.slice(0, 120) } : null,
    mentions: [], createdAt: Math.floor(Date.now() / 1000), editedAt: null, pending: 'sending', tempId,
  }
  const t = threads.get(proofId) ?? { ...EMPTY, loaded: true }
  threads.set(proofId, { ...t, items: [...t.items.filter(i => i.tempId !== tempId), optimistic] })
  counts.set(proofId, (counts.get(proofId) ?? 0) + (retryTempId ? 0 : 1))
  emit()
  try {
    const r = await postPhotoComment(proofId, body, replyTo?.id ?? null)
    const now = threads.get(proofId) ?? t
    const saved = now.items.some(i => i.id === r.comment.id)
    threads.set(proofId, { ...now, items: saved ? now.items.filter(i => i.tempId !== tempId) : now.items.map(i => (i.tempId === tempId ? r.comment : i)) })
    counts.set(proofId, r.commentCount)
    emit()
    return null
  } catch (err) {
    const code = err.code || 'generic'
    const now = threads.get(proofId) ?? t
    if (code === 'moderation_blocked' || code === 'invalid_body' || code === 'signup_required') {
      threads.set(proofId, { ...now, items: now.items.filter(i => i.tempId !== tempId) })
      counts.set(proofId, Math.max(0, (counts.get(proofId) ?? 1) - 1))
    } else {
      threads.set(proofId, { ...now, items: now.items.map(i => (i.tempId === tempId ? { ...i, pending: 'failed' } : i)) })
    }
    emit()
    return code
  }
}

export function discardFailed(proofId, tempId) {
  const t = threads.get(proofId)
  if (!t) return
  threads.set(proofId, { ...t, items: t.items.filter(i => i.tempId !== tempId) })
  counts.set(proofId, Math.max(0, (counts.get(proofId) ?? 1) - 1))
  emit()
}

export async function removeComment(proofId, id) {
  const t = threads.get(proofId)
  const before = t?.items
  if (t) threads.set(proofId, { ...t, items: t.items.filter(i => i.id !== id) })
  emit()
  try {
    const r = await deletePhotoComment(id)
    counts.set(proofId, r.commentCount)
    const l = latest.get(proofId)
    if (l) latest.set(proofId, l.filter(i => i.id !== id))
    emit()
    return true
  } catch {
    const now = threads.get(proofId)
    if (now && before) threads.set(proofId, { ...now, items: before })
    emit()
    return false
  }
}

export async function toggleCommentLike(proofId, id) {
  const t = threads.get(proofId)
  const c = t?.items.find(i => i.id === id)
  if (!t || !c) return
  const on = !c.myLike
  const set = (likeCount, myLike) => {
    const now = threads.get(proofId) ?? t
    threads.set(proofId, { ...now, items: now.items.map(i => (i.id === id ? { ...i, likeCount, myLike } : i)) })
    emit()
  }
  set(Math.max(0, c.likeCount + (on ? 1 : -1)), on)
  try {
    const r = await likePhotoComment(id, on)
    set(r.likeCount, r.myLike)
  } catch {
    set(c.likeCount, c.myLike)
  }
}

/** 'ok', 'already' or 'error'. */
export async function reportComment(id, reason) {
  try { await reportPhotoComment(id, reason); return 'ok' } catch (err) { return err.status === 409 ? 'already' : 'error' }
}
