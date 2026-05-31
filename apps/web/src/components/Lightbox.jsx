import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Shared photo lightbox — used by the channel/event/topic feed (App.jsx) and
 * the DM thread (DirectMessageScreen.jsx). Renders the full-size image plus
 * two action buttons:
 *
 *   - Download — fetches the image as a blob and triggers a browser save.
 *       Done as a blob (not <a href download>) because some browsers / CDNs
 *       ignore the download attribute on cross-origin resources and just
 *       navigate to the image instead.
 *   - Share    — navigator.share with the image file when the Web Share API
 *       Level 2 (file sharing) is available; otherwise falls back to sharing
 *       the URL; otherwise copies the URL to the clipboard.
 *
 * The overlay also closes on backdrop click and on Escape.
 */
export default function Lightbox({ url, onClose }) {
  const { t } = useTranslation('chat')
  const [busy, setBusy] = useState(null)  // 'download' | 'share' | null
  const [toast, setToast] = useState(null)

  // Close on Escape — host screens were each wiring this themselves; doing it
  // here keeps it in one place and lets both call sites drop the duplicate
  // useEffect they had locally.
  useEffect(() => {
    if (!url) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [url, onClose])

  if (!url) return null

  function flashToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 2200)
  }

  async function handleDownload() {
    if (busy) return
    setBusy('download')
    try {
      const res = await fetch(url, { mode: 'cors' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = filenameFromUrl(url)
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      // Give the browser a tick to start the download before revoking.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch (e) {
      console.warn('[lightbox] download failed:', e)
      flashToast(t('downloadFailed', { defaultValue: "Couldn't download the photo" }))
    } finally {
      setBusy(null)
    }
  }

  async function handleShare() {
    if (busy) return
    setBusy('share')
    try {
      // Prefer file-level sharing (Web Share API Level 2) — the receiving app
      // gets the actual image instead of a URL preview. Available on most
      // mobile browsers; degrades gracefully below.
      const filename = filenameFromUrl(url)
      let sharedFile = false
      if (navigator.canShare && navigator.share) {
        try {
          const res = await fetch(url, { mode: 'cors' })
          const blob = await res.blob()
          const file = new File([blob], filename, { type: blob.type || 'image/jpeg' })
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file] })
            sharedFile = true
          }
        } catch (e) {
          // canShare/share rejection (user cancel, no targets, etc.) — fall
          // through to URL share. We don't want to surface user-cancellation
          // as an error.
          if (e?.name !== 'AbortError') {
            console.warn('[lightbox] file share fell through:', e)
          } else {
            sharedFile = true   // user cancelled; do NOT also try URL share
          }
        }
      }
      if (sharedFile) return
      // Tier 2 — URL share (no file, just a link)
      if (navigator.share) {
        try {
          await navigator.share({ url })
          return
        } catch (e) {
          if (e?.name === 'AbortError') return
        }
      }
      // Tier 3 — copy URL to clipboard
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
        flashToast(t('linkCopied', { defaultValue: 'Link copied' }))
        return
      }
      flashToast(t('shareUnavailable', { defaultValue: "Sharing isn't available here" }))
    } catch (e) {
      console.warn('[lightbox] share failed:', e)
      flashToast(t('shareFailed', { defaultValue: "Couldn't share the photo" }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose} aria-label="Close">✕</button>
      <img
        src={url}
        className="lightbox-img"
        alt="full-size preview"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="lightbox-actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={`lightbox-btn${busy === 'download' ? ' lightbox-btn--busy' : ''}`}
          onClick={handleDownload}
          disabled={!!busy}
        >
          <span className="lightbox-btn-icon">⬇</span>
          <span>{t('actionDownload', { defaultValue: 'Download' })}</span>
        </button>
        <button
          type="button"
          className={`lightbox-btn${busy === 'share' ? ' lightbox-btn--busy' : ''}`}
          onClick={handleShare}
          disabled={!!busy}
        >
          <span className="lightbox-btn-icon">↗</span>
          <span>{t('actionShare', { defaultValue: 'Share' })}</span>
        </button>
      </div>
      {toast && <div className="lightbox-toast">{toast}</div>}
    </div>
  )
}

function filenameFromUrl(remoteUrl) {
  try {
    const u = new URL(remoteUrl)
    const last = u.pathname.split('/').filter(Boolean).pop()
    if (last && /\.\w{2,5}$/.test(last)) return decodeURIComponent(last)
  } catch {}
  return `hilads-${Date.now()}.jpg`
}
