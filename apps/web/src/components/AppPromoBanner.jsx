import useAppPromotion from '../hooks/useAppPromotion'

/**
 * Thin top bar inviting Android visitors to install the native app.
 *
 * Renders only when the hook decides to (Android, not in-app, not dismissed
 * within cooldown, store URL present). On other platforms or after dismissal
 * this returns null and contributes zero DOM.
 */
export default function AppPromoBanner() {
  const { shouldShowBanner, dismissBanner, trackCtaClick } = useAppPromotion()

  if (!shouldShowBanner) return null

  function handleCtaClick(e) {
    e.stopPropagation()
    trackCtaClick('banner')
  }

  function handleDismiss(e) {
    e.stopPropagation()
    dismissBanner()
  }

  return (
    <aside
      className="app-promo-banner"
      role="region"
      aria-label="Get the Hilads Android app"
      onClick={() => trackCtaClick('banner')}
    >
      <img className="app-promo-icon" src="/logo/icon.svg" alt="" aria-hidden="true" />
      <span className="app-promo-text">Get the full Hilads experience</span>
      <button
        type="button"
        className="app-promo-cta"
        onClick={handleCtaClick}
      >
        Get it on Google Play
      </button>
      <button
        type="button"
        className="app-promo-dismiss"
        aria-label="Dismiss"
        onClick={handleDismiss}
      >
        ×
      </button>
    </aside>
  )
}
