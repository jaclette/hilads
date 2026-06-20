import { useEffect, useState } from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';
import { thumbUrl } from '@/lib/imageThumb';

/**
 * Image that loads the lightweight thumbnail (derived from the upload URL) and
 * falls back to the full image if the thumb is missing (legacy uploads). Use in
 * grids / cards / carousels where the full-res original is wasteful. Open the
 * full image elsewhere (e.g. a lightbox) when the user taps in.
 */
export function ThumbImage({
  uri, style, resizeMode = 'cover',
}: {
  uri: string;
  style: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain' | 'center' | 'stretch';
}) {
  const [src, setSrc] = useState<string>(() => thumbUrl(uri) ?? uri);
  useEffect(() => { setSrc(thumbUrl(uri) ?? uri); }, [uri]);
  return (
    <Image
      source={{ uri: src }}
      style={style}
      resizeMode={resizeMode}
      onError={() => { if (src !== uri) setSrc(uri); }}
    />
  );
}
