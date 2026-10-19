import useAppPromotion from '../hooks/useAppPromotion'
import Icon from './Icon'

/**
 * Full-screen promo modal - gated OFF by default via appPromotion.interstitial.
 * The banner remains the primary surface; this is a louder variant we'll A/B
 * later. Mounted at App root behind the same hook.
 */
const PITCH_ROW = { display: 'flex', alignItems: 'center', gap: 10 }
const PITCH_ICON = { color: 'var(--primary-text)' }

export default function AppPromoInterstitial() {
  const { shouldShowInterstitial, dismissInterstitial, trackCtaClick } = useAppPromotion()

  if (!shouldShowInterstitial) return null

  return (
    <div className="app-promo-interstitial-overlay" role="dialog" aria-modal="true" aria-label="Get the Hilads Android app">
      <div className="app-promo-interstitial-card">
        <button
          type="button"
          className="app-promo-interstitial-skip-top"
          onClick={dismissInterstitial}
        >
          Continue in browser
        </button>

        <img className="app-promo-interstitial-icon" src="/logo/icon.svg" alt="" aria-hidden="true" />
        <h1 className="app-promo-interstitial-title">Play local. Compare global.</h1>

        <ul className="app-promo-interstitial-pitch">
          <li style={PITCH_ROW}><Icon name="notifications-outline" size={18} style={PITCH_ICON} />Real-time push notifications</li>
          <li style={PITCH_ROW}><Icon name="flash-outline" size={18} style={PITCH_ICON} />Faster, smoother feed</li>
          <li style={PITCH_ROW}><Icon name="sparkles-outline" size={18} style={PITCH_ICON} />Native-quality animations</li>
        </ul>

        <button
          type="button"
          className="app-promo-interstitial-cta"
          onClick={() => trackCtaClick('interstitial')}
        >
          Download on Google Play
        </button>

        <button
          type="button"
          className="app-promo-interstitial-skip"
          onClick={dismissInterstitial}
        >
          Continue in browser
        </button>
      </div>
    </div>
  )
}
