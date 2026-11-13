// The line of a comment notification on a Daily photo, from its type and data (the same lines as the push,
// backend/api/src/PhotoCommentNotify.php; PhotoCommentNotifyTest keeps notifications.json "photoComment" identical
// in every locale). One formatter for the Today "While you were away" card and the Notifications rows (and the web's
// twin, apps/web/src/lib/commentLine.js), so they can't drift apart:
//   a comment on my photo            → "💬 Lan commented on your photo"
//   on a photo I commented            → "💬 Lan also commented on Maxime's photo"
//   the photo's author answering      → "💬 Lan replied on their photo"
//   a reply to my comment             → "↩️ Lan replied to your comment"
//   a mention                         → "👋 Lan mentioned you"
//   grouped (n others)                → "💬 Lan and 2 others commented on Maxime's photo"
// Pure (no imports): node --test runs commentLine.test.mjs.

type TFn = (key: string, opts?: Record<string, unknown>) => string;

export interface CommentItem {
  type: string;
  count: number;
  actors: { name: string }[];
  data: Record<string, any>;
}

export const COMMENT_TYPES = ['photo_comment', 'photo_mention'];

/** The photoComment key of an item: author, previous, previous_self, reply, mention, with _many / _many_one when grouped. */
export function commentKey(item: CommentItem): string {
  const d = item.data ?? {};
  const kind: string = item.type === 'photo_mention' ? 'mention' : (d.kind ?? 'author');
  const others = Math.max(0, (item.count ?? 1) - 1);
  if (kind === 'mention' || kind === 'reply') return kind;
  if (kind === 'previous' && d.selfPhoto && others === 0) return 'previous_self';
  const base = kind === 'previous' ? 'previous' : 'author';
  return others === 0 ? base : others === 1 ? `${base}_many_one` : `${base}_many`;
}

/** The line, in the UI language; name: what to put for the actor's name (a marker to render it bold, or the name). */
export function commentLine(item: CommentItem, t: TFn, name?: string): string {
  const d = item.data ?? {};
  return t(`photoComment.${commentKey(item)}`, {
    name: name ?? item.actors[0]?.name ?? d.actorName ?? '',
    owner: d.ownerName ?? '',
    n: Math.max(0, (item.count ?? 1) - 1),
    interpolation: { escapeValue: false },
  });
}
