// Expo Router deep-link path rewriter. Runs for EVERY incoming deep link
// (iOS universal links, Android app links, and the hilads:// custom scheme)
// before the router resolves a route.
//
// Shared links can carry a locale prefix (/fr/event/…, /vi/city/…, /es/e/…),
// but the app's routes are not locale-prefixed (app/event/[id].tsx, etc.). So a
// prefixed link would open the app and land on +not-found. Strip the locale
// segment and route to the canonical screen. The locale prefixes here must stay
// in sync with the web i18n SUPPORTED list (minus 'en', which has no prefix).
const LOCALE_PREFIXES = ['fr', 'vi', 'es', 'it', 'pt-br', 'pt-pt', 'de', 'nl', 'zh-hans', 'zh-hant', 'ja', 'ko', 'fil', 'th', 'id', 'hi', 'ru'];

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
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
      return prefix + stripped + suffix;
    }
    return path;
  } catch {
    // Never block a deep link on a parsing error — fall back to the raw path.
    return path;
  }
}
