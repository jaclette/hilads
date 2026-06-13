import { API_URL } from '@/constants';

// Per-session cache mirroring the web side. Backend has a 24h DB cache, this
// layer just avoids re-fetching the same URL across many bubbles in one screen.
// Returns a shared Promise so concurrent N renders trigger one network hop.

export interface LinkPreview {
  url:         string;
  title:       string | null;
  description: string | null;
  image:       string | null;
  site_name:   string | null;
}

// Bounded LRU. Without a cap this Map grew for the whole app lifetime (every
// unique URL ever previewed across every city stayed forever) - a slow memory
// creep over a long session. Map keeps insertion order, so "oldest = first key"
// and a get re-inserts to mark recency.
const MAX_ENTRIES = 200;
const cache = new Map<string, Promise<LinkPreview | null>>();

export function getLinkPreview(url: string | null | undefined): Promise<LinkPreview | null> {
  if (!url) return Promise.resolve(null);
  const existing = cache.get(url);
  if (existing) {
    cache.delete(url);          // re-insert → mark as most-recently-used
    cache.set(url, existing);
    return existing;
  }

  const p: Promise<LinkPreview | null> = (async () => {
    try {
      // API_URL already ends with /api/v1 (see src/constants.ts) - no double prefix.
      const res = await fetch(`${API_URL}/link-preview?url=${encodeURIComponent(url)}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const data    = await res.json();
      const preview = data?.preview ?? null;
      if (!preview) return null;
      // No title AND no image → not useful as a card.
      if (!preview.title && !preview.image) return null;
      return preview as LinkPreview;
    } catch {
      return null;
    }
  })();
  cache.set(url, p);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value; // first key = least-recently-used
    if (oldest !== undefined) cache.delete(oldest);
  }
  return p;
}
