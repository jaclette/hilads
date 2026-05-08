/**
 * App-promotion config + detection helpers.
 *
 * Hilads doesn't ship an iOS app yet — only `android.enabled` is true today.
 * When iOS launches, flip `ios.enabled`, set `ios.storeUrl`, and the existing
 * banner / interstitial / hook code already supports it (see useAppPromotion).
 *
 * App Links are configured for /e, /event, /city, /t (see
 * apps/mobile/android/app/src/main/AndroidManifest.xml + the
 * /.well-known/assetlinks.json served from this app's public/ dir). Visitors
 * with the app installed never reach this banner: Android opens the app
 * directly. So this CTA is implicitly the "you don't have the app yet" path.
 */

export const appPromotion = {
  banner:                     true,   // top-bar promo (default ON)
  interstitial:               false,  // full-screen modal (gated for an A/B later)
  dismissalDays:              7,
  interstitialDismissalDays:  30,
  android: {
    enabled:  true,
    // VITE_PLAY_STORE_URL was named PLAY_STORE_URL in the original spec —
    // this codebase uses the Vite VITE_-prefix convention everywhere else.
    storeUrl: import.meta.env.VITE_PLAY_STORE_URL
            || 'https://play.google.com/store/apps/details?id=com.hilads.app',
  },
  ios: {
    enabled:  false,
    storeUrl: null,
  },
}

// ── OS detection ──────────────────────────────────────────────────────────────

export function detectOs(ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '')) {
  if (!ua) return 'other'
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios'
  // iPad in "Request Desktop Site" mode reports MacIntel — same trick as
  // useBeforeInstallPrompt.js.
  if (typeof navigator !== 'undefined'
      && navigator.platform === 'MacIntel'
      && navigator.maxTouchPoints > 1) {
    return 'ios'
  }
  if (/Android/i.test(ua)) return 'android'
  return 'other'
}

// True when the page is rendered inside a surface where pushing the user to
// the store doesn't make sense — RN WebView, custom-UA shell, PWA standalone,
// or a Trusted Web Activity launched from the Play Store install.
export function isInNativeApp() {
  if (typeof window === 'undefined') return false
  if (window.ReactNativeWebView) return true
  if (typeof navigator !== 'undefined' && /HiladsApp\//.test(navigator.userAgent)) return true
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  if (typeof document !== 'undefined' && document.referrer.startsWith('android-app://')) return true
  return false
}

// Respect Do Not Track / GPC for analytics. Banner UI itself still renders —
// only the analytics events get gated.
export function honorsDnt() {
  if (typeof navigator === 'undefined') return false
  if (navigator.doNotTrack === '1' || navigator.doNotTrack === 'yes') return true
  if (navigator.globalPrivacyControl === true) return true
  return false
}
