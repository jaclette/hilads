/**
 * @mention helpers (web) — mirror of apps/mobile/src/lib/mentions.ts.
 *
 * Offsets are JS string indices into `content`, computed at SEND time by scanning
 * the final text for each selected @username (deleted/altered tokens are dropped).
 * Messages are immutable, so offsets stay valid. The renderer resolves spans using
 * the CURRENT username returned by the backend.
 */

const HANDLE_CHAR = /[a-z0-9_]/i

/** Build stored mentions [{userId, offset, length}] from final text + selected mentions. */
export function buildMentionsFromText(text, selected) {
  const out = []
  const used = []
  for (const sel of selected) {
    const token = '@' + sel.username
    let from = 0
    while (from <= text.length) {
      const idx = text.indexOf(token, from)
      if (idx === -1) break
      const end = idx + token.length
      const nextCh = text[end]
      const boundaryOk = nextCh === undefined || !HANDLE_CHAR.test(nextCh)
      const overlap = used.some(u => idx < u.end && end > u.start)
      if (boundaryOk && !overlap) {
        out.push({
          ...(sel.userId  ? { userId:  sel.userId  } : {}),
          ...(sel.guestId ? { guestId: sel.guestId } : {}),
          username: sel.username,
          offset: idx,
          length: token.length,
        })
        used.push({ start: idx, end })
        break
      }
      from = idx + 1
    }
  }
  return out
}

/**
 * Split content into segments for rendering. Each segment is either
 * { type:'text', text } or { type:'mention', userId, username }. Out-of-range /
 * overlapping mentions are skipped (degrade to plain text).
 */
export function splitContentByMentions(content, mentions) {
  if (!mentions || mentions.length === 0) return [{ type: 'text', text: content }]
  const valid = mentions
    .filter(m => Number.isInteger(m.offset) && m.offset >= 0 && m.length > 0 && m.offset + m.length <= content.length)
    .sort((a, b) => a.offset - b.offset)

  const segs = []
  let cursor = 0
  for (const m of valid) {
    if (m.offset < cursor) continue
    if (m.offset > cursor) segs.push({ type: 'text', text: content.slice(cursor, m.offset) })
    // Members carry a resolved username; guests render the @name straight from
    // content (offset points at the '@', so skip it for the label).
    const label = m.username ?? content.slice(m.offset + 1, m.offset + m.length)
    segs.push({ type: 'mention', userId: m.userId ?? null, guestId: m.guestId ?? null, username: label })
    cursor = m.offset + m.length
  }
  if (cursor < content.length) segs.push({ type: 'text', text: content.slice(cursor) })
  return segs
}

/** Detect an active "@query" immediately before the cursor. Returns {query, at} or null. */
export function detectActiveMention(textBeforeCursor) {
  const m = textBeforeCursor.match(/(?:^|\s)@([a-z0-9_]{0,20})$/i)
  if (!m) return null
  return { query: m[1], at: textBeforeCursor.length - m[1].length - 1 }
}
