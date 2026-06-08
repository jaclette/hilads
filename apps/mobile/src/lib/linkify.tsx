import React from 'react';
import { Linking, StyleSheet, Text, type TextStyle } from 'react-native';

// Auto-linkify URLs in message text. http/https only - bare "www.x.com" and
// schemes like mailto/tel are too easy to mis-match casual typing. Trailing
// sentence punctuation is trimmed so "see https://foo.com." doesn't link the
// period. Returns an array of strings + Text nodes that can be embedded inside
// a parent <Text> (RN allows nested Text + string children).
const URL_RE   = /\bhttps?:\/\/\S+/gi;
const TRAIL_RE = /[.,!?;:)\]}>"'»]+$/;

// First http/https URL in the text (with trailing punctuation trimmed), or
// null. Used to drive the link-preview card under chat bubbles - we only
// preview the first URL per message to keep the UI tight.
export function extractFirstUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  URL_RE.lastIndex = 0;
  const m = URL_RE.exec(String(text));
  if (!m) return null;
  let url = m[0];
  const tm = TRAIL_RE.exec(url);
  if (tm) url = url.slice(0, -tm[0].length);
  return url || null;
}

const openUrl = (url: string) => { Linking.openURL(url).catch(() => {}); };

export function linkifyText(
  text: string | null | undefined,
  linkStyle?: TextStyle,
  keyPrefix = '',
): React.ReactNode[] {
  const s = text ?? '';
  if (!s) return [];
  const out: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(s)) !== null) {
    let url = m[0];
    const tm = TRAIL_RE.exec(url);
    if (tm) url = url.slice(0, -tm[0].length);
    if (!url) continue;
    const start = m.index;
    const end   = start + url.length;
    if (start > lastIdx) out.push(s.slice(lastIdx, start));
    out.push(
      <Text
        key={`${keyPrefix}u${start}`}
        style={linkStyle ?? styles.link}
        onPress={() => openUrl(url)}
      >
        {url}
      </Text>,
    );
    lastIdx = end;
    URL_RE.lastIndex = end;
  }
  if (lastIdx < s.length) out.push(s.slice(lastIdx));
  return out;
}

const styles = StyleSheet.create({
  // Inherits text color from parent <Text> - underline alone signals the link.
  link: { textDecorationLine: 'underline' },
});
