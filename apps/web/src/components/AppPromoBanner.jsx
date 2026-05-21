import useAppPromotion from '../hooks/useAppPromotion'

/**
 * Thin top bar inviting Android/iOS visitors to install the native app.
 *
 * Renders only when the hook decides to (on a supported OS, not in-app, not
 * dismissed within cooldown, store URL present). On other platforms or after
 * dismissal this returns null and contributes zero DOM. CTA copy adapts to the
 * detected OS.
 */
export default function AppPromoBanner() {
  const { shouldShowBanner, dismissBanner, trackCtaClick, os } = useAppPromotion()

  if (!shouldShowBanner) return null

  const ctaLabel    = os === 'ios' ? 'Download on the App Store' : 'Get it on Google Play'
  const regionLabel = os === 'ios' ? 'Get the Hilads iOS app'    : 'Get the Hilads Android app'

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
      aria-label={regionLabel}
      onClick={() => trackCtaClick('banner')}
    >
      <img className="app-promo-icon" src="/logo/icon.svg" alt="" aria-hidden="true" />
      <span className="app-promo-text">Get the full Hilads experience</span>
      <button
        type="button"
        className="app-promo-cta"
        onClick={handleCtaClick}
      >
        {ctaLabel}
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
