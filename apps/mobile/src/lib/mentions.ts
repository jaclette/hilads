/**
 * @mention helpers — shared between the composer (build offsets at send) and the
 * renderer (split content into text + mention segments).
 *
 * Offsets are JS string indices into `content` and are computed at SEND time by
 * scanning the final text for each selected @username (so deletion/edits before
 * send are handled: a token that's no longer present is simply dropped). Messages
 * are immutable, so offsets stay valid for the message's lifetime.
 */

import type { MentionRef } from '@/types';
export type { MentionRef };

export interface SelectedMention {
  userId:   string;
  username: string;
}

const HANDLE_CHAR = /[a-z0-9_]/i;

/**
 * Build the stored mention list from the final text + the set of mentions the
 * user explicitly selected. Each selected @username is matched to its first
 * non-overlapping, word-boundary occurrence in the text. Tokens that no longer
 * appear (user deleted/altered them) are dropped — so "@ + space, no selection"
 * and broken half-mentions never become mentions.
 */
export function buildMentionsFromText(text: string, selected: SelectedMention[]): MentionRef[] {
  const out: MentionRef[] = [];
  const used: { start: number; end: number }[] = [];
  for (const sel of selected) {
    const token = '@' + sel.username;
    let from = 0;
    while (from <= text.length) {
      const idx = text.indexOf(token, from);
      if (idx === -1) break;
      const end     = idx + token.length;
      const nextCh  = text[end];
      const boundaryOk = nextCh === undefined || !HANDLE_CHAR.test(nextCh);
      const overlap = used.some(u => idx < u.end && end > u.start);
      if (boundaryOk && !overlap) {
        out.push({ userId: sel.userId, username: sel.username, offset: idx, length: token.length });
        used.push({ start: idx, end });
        break;
      }
      from = idx + 1;
    }
  }
  return out;
}

export type MentionSegment =
  | { type: 'text';    text: string }
  | { type: 'mention'; userId: string; username: string };

/**
 * Split content into renderable segments using resolved mentions (which carry the
 * CURRENT username from the backend). Out-of-range / overlapping mentions are
 * skipped so a stale offset degrades to plain text rather than corrupting output.
 */
export function splitContentByMentions(content: string, mentions?: MentionRef[] | null): MentionSegment[] {
  if (!mentions || mentions.length === 0) return [{ type: 'text', text: content }];
  const valid = mentions
    .filter(m => Number.isInteger(m.offset) && m.offset >= 0 && m.length > 0 && m.offset + m.length <= content.length)
    .sort((a, b) => a.offset - b.offset);

  const segs: MentionSegment[] = [];
  let cursor = 0;
  for (const m of valid) {
    if (m.offset < cursor) continue; // overlap guard
    if (m.offset > cursor) segs.push({ type: 'text', text: content.slice(cursor, m.offset) });
    segs.push({ type: 'mention', userId: m.userId, username: m.username });
    cursor = m.offset + m.length;
  }
  if (cursor < content.length) segs.push({ type: 'text', text: content.slice(cursor) });
  return segs;
}

/**
 * Detect an active "@query" immediately before the cursor (for autocomplete).
 * Returns the query text + the index of the '@', or null when not in a mention.
 * The '@' must start the string or follow whitespace.
 */
export function detectActiveMention(textBeforeCursor: string): { query: string; at: number } | null {
  const m = textBeforeCursor.match(/(?:^|\s)@([a-z0-9_]{0,20})$/i);
  if (!m) return null;
  return { query: m[1], at: textBeforeCursor.length - m[1].length - 1 };
}
