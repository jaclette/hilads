/**
 * Detect a shared INTERNAL Hilads link inside a chat message (leaderboard,
 * challenge, Hi plan/event, Hi now/topic) so the feed can hide the raw URL and
 * render a fun contextual CTA that opens it in-app. External links → null.
 *
 * Manual path parsing (no URL global - Hermes support is inconsistent).
 */

const LOCALE = /^\/(?:fr|vi|es|it|pt-br|pt-pt|de|nl|zh-hans|zh-hant|ja|ko|fil|th|id|hi|ru|ar)(?=\/)/i;

export interface SharedLink {
  url:     string;
  kind:    'leaderboard' | 'challenge' | 'event' | 'topic';
  id?:     string;
  scope?:  string;
  period?: string;
  campaign?: boolean;   // Hilads campaign challenge (?c=1) → 2× points + scope pill
}

export function parseSharedHiladsLink(content?: string | null): SharedLink | null {
  if (!content) return null;
  const m = content.match(/https?:\/\/\S+/i);
  if (!m) return null;
  const url = m[0];

  // Path = everything after the host, minus query/hash and an optional locale.
  const afterProto = url.replace(/^https?:\/\//i, '');
  const slash = afterProto.indexOf('/');
  let path = slash === -1 ? '/' : afterProto.slice(slash);
  path = path.split('?')[0].split('#')[0].replace(LOCALE, '') || '/';

  if (/^\/leaderboard$/.test(path)) {
    const q = url.split('?')[1] || '';
    const get = (k: string) => {
      const mm = q.match(new RegExp('(?:^|&)' + k + '=([^&#]*)'));
      return mm ? decodeURIComponent(mm[1]) : null;
    };
    return { url, kind: 'leaderboard', scope: get('scope') || 'city', period: get('period') || 'month' };
  }
  const qparam = (k: string): string | null => {
    const q = url.split('?')[1] || '';
    const mm = q.match(new RegExp('(?:^|&)' + k + '=([^&#]*)'));
    return mm ? decodeURIComponent(mm[1]) : null;
  };
  let mm: RegExpMatchArray | null;
  if ((mm = path.match(/^\/challenge\/(?:[a-z0-9-]+-)?([a-f0-9]{16})$/i))) {
    return { url, kind: 'challenge', id: mm[1], campaign: qparam('c') === '1', scope: qparam('scope') || undefined };
  }
  if ((mm = path.match(/^\/event\/(?:[a-z0-9-]+-)?([a-f0-9]{16})$/i)) || (mm = path.match(/^\/e\/([a-f0-9]{16})$/i))) return { url, kind: 'event', id: mm[1] };
  if ((mm = path.match(/^\/(?:t|topic)\/(?:[a-z0-9-]+-)?([a-f0-9]{16})$/i))) return { url, kind: 'topic', id: mm[1] };
  return null;
}

/** Route target for a parsed shared link (expo-router push path). */
export function sharedLinkRoute(link: SharedLink): string {
  switch (link.kind) {
    case 'leaderboard': return `/leaderboard?scope=${encodeURIComponent(link.scope ?? 'city')}&period=${encodeURIComponent(link.period ?? 'month')}`;
    case 'challenge':   return `/challenge/${link.id}`;
    case 'event':       return `/event/${link.id}`;
    case 'topic':       return `/topic/${link.id}`;
  }
}
