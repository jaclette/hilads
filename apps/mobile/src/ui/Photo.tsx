import { useEffect, useState } from 'react';
import { Image, type ImageProps } from 'expo-image';

/**
 * A proof or spot photo: its thumbnail, then the full photo when the thumbnail
 * fails to load (the thumbnail proxy unreachable, an expired or missing thumb),
 * so a card never stays empty.
 */
export function Photo({ thumb, full, ...rest }: Omit<ImageProps, 'source'> & { thumb?: string | null; full?: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [thumb, full]);
  const uri = (failed ? full : thumb ?? full) ?? undefined;
  return <Image {...rest} source={uri ? { uri } : undefined} onError={() => { if (!failed && thumb && full && thumb !== full) setFailed(true); }} />;
}
