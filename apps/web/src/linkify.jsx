import React from 'react'

// Auto-linkify URLs in message text. http/https only - we don't try to detect
// bare "www.x.com" or schemes like mailto/tel (too easy to mis-match casual
// typing). Trailing sentence punctuation is trimmed off the URL so "see
// https://foo.com." doesn't link the period.
const URL_RE   = /\bhttps?:\/\/\S+/gi
const TRAIL_RE = /[.,!?;:)\]}>"'»]+$/

// Returns the first http/https URL in `text` (with trailing punctuation
// trimmed), or null if none. Used to drive the link-preview card under chat
// bubbles - we only preview the first URL per message to keep the UI tight.
export function extractFirstUrl(text) {
  if (!text) return null
  URL_RE.lastIndex = 0
  const m = URL_RE.exec(String(text))
  if (!m) return null
  let url = m[0]
  const tm = TRAIL_RE.exec(url)
  if (tm) url = url.slice(0, -tm[0].length)
  return url || null
}

export function linkifyText(text, keyPrefix = '') {
  if (!text) return text
  const s = String(text)
  const out = []
  let lastIdx = 0
  let m
  URL_RE.lastIndex = 0
  while ((m = URL_RE.exec(s)) !== null) {
    let url = m[0]
    const tm = TRAIL_RE.exec(url)
    if (tm) url = url.slice(0, -tm[0].length)
    if (!url) continue
    const start = m.index
    const end   = start + url.length
    if (start > lastIdx) out.push(s.slice(lastIdx, start))
    out.push(
      <a
        key={`${keyPrefix}u${start}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        onClick={(e) => e.stopPropagation()}
      >{url}</a>
    )
    lastIdx = end
    URL_RE.lastIndex = end
  }
  if (lastIdx < s.length) out.push(s.slice(lastIdx))
  return out.length > 0 ? out : s
}
