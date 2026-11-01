import { useEffect, useState } from 'react';
import { Image, type ImageProps } from 'expo-image';
import { coverThumbUrl, proxyFor, webpUrl } from '@/lib/imageThumb';

/**
 * A proof or spot photo: its thumbnail (as WebP), then, when it fails to load,
 * the same size through the resize proxy (missing on the image CDN), then the
 * full photo, so a card never stays empty. `onError` fires only when all failed.
 */
export function Photo({ thumb, full, ...rest }: Omit<ImageProps, 'source'> & { thumb?: string | null; full?: string | null }) {
  const first = webpUrl(thumb) ?? full ?? undefined;
  const tries = [first, proxyFor(first), full ?? undefined].filter((u, i, all): u is string => !!u && all.indexOf(u) === i);
  const [step, setStep] = useState(0);
  useEffect(() => { setStep(0); }, [thumb, full]);
  const uri = tries[Math.min(step, tries.length - 1)];
  return <Image {...rest} source={uri ? { uri } : undefined} onError={e => {
    if (step < tries.length - 1) setStep(step + 1);
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
