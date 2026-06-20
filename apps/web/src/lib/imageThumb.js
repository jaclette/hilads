// Derive the thumbnail URL for an uploaded image. Uploads are `<32hex>.<ext>`
// and the backend writes a matching `thumb_<32hex>.jpg` (≤400px) alongside, so
// the thumb is derivable - no per-message storage. Non-uploads (avatars,
// external URLs) are returned unchanged. Thumbs from before deterministic
// naming won't exist at the derived path → callers fall back to the full URL.
export function thumbUrl(url) {
  if (!url) return url
  const m = url.match(/^(.*\/)([a-f0-9]{32})\.(?:jpe?g|png|webp)$/i)
  return m ? `${m[1]}thumb_${m[2]}.jpg` : url
}
