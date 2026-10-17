// Where sign-up / sign-in send the user back after success (?returnTo).
// Accepted only on the surfaces we launch auth from, so a tampered deeplink
// can't redirect out of the app or to a screen we didn't intend.
const RETURN_TO_ALLOWLIST = [
  '/challenge/', '/event/', '/t/', '/daily/', '/spot/', '/topic/create',
  '/my-spots', '/friends', '/(tabs)/',
];

export function safeReturnTo(raw: string | undefined): string | null {
  if (!raw) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(raw); } catch { return null; }
  if (!decoded.startsWith('/')) return null;          // no external URLs
  if (decoded.startsWith('//'))  return null;          // no protocol-relative
  return RETURN_TO_ALLOWLIST.some(p => decoded.startsWith(p)) ? decoded : null;
}

/** Query string carrying returnTo and the gated action between the auth screens. */
export function authQuery(returnTo?: string | null, action?: string | null): string {
  const q = [
    returnTo ? `returnTo=${encodeURIComponent(returnTo)}` : null,
    action ? `action=${encodeURIComponent(action)}` : null,
  ].filter(Boolean).join('&');
  return q ? `?${q}` : '';
}
