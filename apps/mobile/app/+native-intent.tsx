// Expo Router deep-link path rewriter. Runs for EVERY incoming deep link
// (iOS universal links, Android app links, and the hilads:// custom scheme)
// before the router resolves a route.
//
// Shared links can carry a locale prefix (/fr/event/…, /vi/city/…, /es/e/…),
// but the app's routes are not locale-prefixed (app/event/[id].tsx, etc.). So a
// prefixed link would open the app and land on +not-found. Strip the locale
// segment and route to the canonical screen. The locale prefixes here must stay
// in sync with the web i18n SUPPORTED list (minus 'en', which has no prefix).
const LOCALE_PREFIXES = ['fr', 'vi', 'es', 'it', 'pt-br', 'pt-pt', 'de', 'nl', 'zh-hans', 'zh-hant', 'ja', 'ko', 'fil', 'th', 'id', 'hi', 'ru', 'ar'];

// Web challenge URLs are slug-prefixed: /challenge/some-title-abc123def4567890.
// Strip everything before the 16-hex id so the mobile [id] route matches.
// Idempotent on already-canonical paths.
function canonicalizeChallenge(p: string): string {
  return p.replace(/\/challenge\/(?:[a-z0-9-]+-)?([a-f0-9]{16})(\b|$)/i, '/challenge/$1$2');
}

// hilads.live/today (any locale) → today's Daily Challenge sheet, and a past
// challenge's web page /challenge/{date}-{slug} → that day's sheet. The app
// route is /daily/[date]; source=link lets the sheet track daily_link_opened.
// The web archive /challenges → the app's past challenges.
function rewriteToday(prefix: string, pathOnly: string, suffix: string): string | null {
  const extra = suffix.startsWith('?') ? '&' + suffix.slice(1) : '';
  if (pathOnly === '/today' || pathOnly === '/today/') return `${prefix}/daily/today?source=link${extra}`;
  const past = pathOnly.match(/^\/challenge\/(\d{4}-\d{2}-\d{2})(?:-[a-z0-9-]*)?\/?$/);
  if (past) return `${prefix}/daily/${past[1]}?source=link${extra}`;
  if (pathOnly === '/challenges' || pathOnly === '/challenges/') return `${prefix}/daily/archive${suffix}`;
  return null;
}

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    // hilads://today[?…] (custom scheme: "today" parses as the host, and the
    // router reads the host as the first path segment → hilads://daily/today).
    const custom = path.match(/^hilads:\/\/today\/?(?:\?(.*))?$/i);
    if (custom) return `hilads://daily/today?source=link${custom[1] ? '&' + custom[1] : ''}`;

    // `path` may arrive as a full URL (https://hilads.live/fr/event/x?... or
    // hilads://…) or as a bare path (/fr/event/x). Peel off scheme+host if
    // present, and keep any query/hash to reattach after stripping the locale.
    let prefix = '';
    let rest = path;
    const url = rest.match(/^([a-z][\w+.-]*:\/\/[^/]*)(\/.*)?$/i);
    if (url) {
      prefix = url[1];
      rest = url[2] || '/';
    }

    const qIdx = rest.search(/[?#]/);
    const pathOnly = qIdx === -1 ? rest : rest.slice(0, qIdx);
    const suffix = qIdx === -1 ? '' : rest.slice(qIdx);


    const segments = pathOnly.split('/'); // ['', 'fr', 'event', 'abc']
    if (LOCALE_PREFIXES.includes(segments[1])) {
      const stripped = '/' + segments.slice(2).join('/');
      return rewriteToday(prefix, stripped, suffix) ?? canonicalizeChallenge(prefix + stripped + suffix);
    }
    return rewriteToday(prefix, pathOnly, suffix) ?? canonicalizeChallenge(path);
  } catch {
    // Never block a deep link on a parsing error - fall back to the raw path.
    return path;
  }
}
