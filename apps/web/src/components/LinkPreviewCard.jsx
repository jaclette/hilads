import { useEffect, useState } from 'react'
import { getLinkPreview } from '../linkPreviewCache.js'

// Open Graph preview card for a URL posted in chat. Renders nothing while the
// fetch is in flight (no skeleton - link-preview is a polish layer, not core
// content; bubbles must stay readable on slow networks) and nothing if the URL
// has no usable OG metadata.
export default function LinkPreviewCard({ url }) {
  const [preview, setPreview] = useState(null)

  useEffect(() => {
    let cancelled = false
    getLinkPreview(url).then((p) => { if (!cancelled) setPreview(p) })
    return () => { cancelled = true }
  }, [url])

  if (!preview) return null

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="link-preview-card"
      onClick={(e) => e.stopPropagation()}
    >
      {preview.image && (
        <img
          src={preview.image}
          alt=""
          loading="lazy"
          className="link-preview-img"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
      )}
      <div className="link-preview-body">
        {preview.site_name && <div className="link-preview-site">{preview.site_name}</div>}
        {preview.title       && <div className="link-preview-title">{preview.title}</div>}
        {preview.description && <div className="link-preview-desc">{preview.description}</div>}
      </div>
    </a>
  )
}
