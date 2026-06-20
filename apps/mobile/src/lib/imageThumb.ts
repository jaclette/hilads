/**
 * Derive the thumbnail URL for an uploaded image.
 *
 * Uploads are stored as `<32hex>.<ext>` and the backend writes a matching
 * `thumb_<32hex>.jpg` (≤400px) alongside them. So the thumb URL is derivable
 * from the full URL with no per-message storage. Anything that isn't a known
 * upload (avatars, external URLs, already-a-thumb) is returned unchanged.
 *
 * Thumbs generated before deterministic naming used a random name and won't
 * exist at the derived path - callers must fall back to the full URL on a 404.
 */
export function thumbUrl(url?: string | null): string | null {
  if (!url) return url ?? null;
  const m = url.match(/^(.*\/)([a-f0-9]{32})\.(?:jpe?g|png|webp)$/i);
  return m ? `${m[1]}thumb_${m[2]}.jpg` : url;
}
