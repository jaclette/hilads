import { useState, useEffect } from 'react'
import { thumbUrl } from '../lib/imageThumb'

/**
 * <img> that loads the lightweight thumbnail (derived from the upload URL) and
 * falls back to the full image if the thumb is missing (legacy uploads). All
 * other props (className, style, alt, onClick) pass through, so callers keep
 * their lightbox onClick which should open the full-size `src`.
 */
export default function ThumbImg({ src, onError, ...rest }) {
  const [cur, setCur] = useState(() => thumbUrl(src) || src)
  useEffect(() => { setCur(thumbUrl(src) || src) }, [src])
  return (
    <img
      {...rest}
      src={cur}
      onError={(e) => {
        if (cur !== src) { setCur(src); return } // thumb missing → full image
        onError?.(e)
      }}
    />
  )
}
