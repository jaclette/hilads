import { useEffect, useState } from 'react';
import { Image, type ImageProps } from 'expo-image';
import { coverThumbUrl } from '@/lib/imageThumb';

/**
 * A proof or spot photo: its thumbnail, then the full photo when the thumbnail
 * fails to load (the thumbnail proxy unreachable, an expired or missing thumb),
 * so a card never stays empty. `onError` fires only when both failed.
 */
export function Photo({ thumb, full, ...rest }: Omit<ImageProps, 'source'> & { thumb?: string | null; full?: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [thumb, full]);
  const uri = (failed ? full : thumb ?? full) ?? undefined;
  return <Image {...rest} source={uri ? { uri } : undefined} onError={e => {
    if (!failed && thumb && full && thumb !== full) setFailed(true);
    else rest.onError?.(e);
  }} />;
}

/**
 * A hero cover: the challenge's uploaded cover at a cover size (the original
 * if that fails), else `fallback` (a bundled theme cover) as is.
 */
export function CoverPhoto({ url, fallback, ...rest }: Omit<ImageProps, 'source'> & { url?: string | null; fallback?: number | null }) {
  if (url) return <Photo {...rest} thumb={coverThumbUrl(url)} full={url} />;
  return fallback != null ? <Image {...rest} source={fallback} /> : null;
}
