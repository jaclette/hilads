import { useEffect, useMemo, useState } from 'react'
import { appPromotion, detectOs, isInNativeApp, honorsDnt } from '../lib/appPromotion'
import { track } from '../lib/analytics'

const BANNER_KEY       = 'hilads_app_promo_banner_until'
const INTERSTITIAL_KEY = 'hilads_app_promo_interstitial_until'

const DAY_MS = 24 * 60 * 60 * 1000

function readUntil(key) {
  if (typeof window === 'undefined') return 0
  const v = Number(window.localStorage.getItem(key))
  return Number.isFinite(v) ? v : 0
}

function safeTrack(event, props) {
  if (honorsDnt()) return
  try { track(event, props) } catch { /* never break UI on analytics fail */ }
}

/**
 * Drives the Android Play Store promo banner + (gated-off) interstitial.
 *
 * Always safe to call from the App root — when the visitor isn't on Android,
 * is already in the native app, or has dismissed within the cooldown,
 * `shouldShowBanner` stays false and nothing renders.
 */
export default function useAppPromotion() {
  // Defer detection to a useEffect so SSR / first paint never depends on
  // navigator.* (the codebase is currently SPA-only, but this is a cheap
  // future-proof and matches the pattern in useBeforeInstallPrompt).
  const [ready,   setReady]   = useState(false)
  const [os,      setOs]      = useState('other')
  const [inApp,   setInApp]   = useState(false)
  const [bannerDismissedUntil,       setBannerDismissedUntil]       = useState(0)
  const [interstitialDismissedUntil, setInterstitialDismissedUntil] = useState(0)

  useEffect(() => {
    setOs(detectOs())
    setInApp(isInNativeApp())
    setBannerDismissedUntil(readUntil(BANNER_KEY))
    setInterstitialDismissedUntil(readUntil(INTERSTITIAL_KEY))
    setReady(true)
  }, [])

  // Resolve the per-OS store URL. Today only Android is enabled; flipping the
  // ios.enabled flag is enough to turn this on for iOS later.
  const storeUrl = useMemo(() => {
    if (os === 'android' && appPromotion.android.enabled) return appPromotion.android.storeUrl || null
    if (os === 'ios'     && appPromotion.ios.enabled)     return appPromotion.ios.storeUrl     || null
    return null
  }, [os])

  const now = Date.now()
  const baseEligible = ready && !inApp && !!storeUrl

  const shouldShowBanner = baseEligible
    && appPromotion.banner
    && bannerDismissedUntil < now

  const shouldShowInterstitial = baseEligible
    && appPromotion.interstitial
    && interstitialDismissedUntil < now

  // Push a `body.has-app-promo-banner` class so the existing layout can
  // compensate top padding via CSS without each page touching it.
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (shouldShowBanner) document.body.classList.add('has-app-promo-banner')
    else                  document.body.classList.remove('has-app-promo-banner')
    return () => document.body.classList.remove('has-app-promo-banner')
  }, [shouldShowBanner])

  // Fire `app_banner_shown` once per visit (when transitioning from hidden →
  // shown). Doesn't refire on rerenders.
  useEffect(() => {
    if (shouldShowBanner) safeTrack('app_banner_shown', { os, surface: 'banner' })
  }, [shouldShowBanner, os])

  useEffect(() => {
    if (shouldShowInterstitial) safeTrack('app_banner_shown', { os, surface: 'interstitial' })
  }, [shouldShowInterstitial, os])

  function dismissBanner() {
    const until = Date.now() + appPromotion.dismissalDays * DAY_MS
    window.localStorage.setItem(BANNER_KEY, String(until))
    setBannerDismissedUntil(until)
    safeTrack('app_banner_dismissed', { os, surface: 'banner' })
  }

  function dismissInterstitial() {
    const until = Date.now() + appPromotion.interstitialDismissalDays * DAY_MS
    window.localStorage.setItem(INTERSTITIAL_KEY, String(until))
    setInterstitialDismissedUntil(until)
    safeTrack('app_banner_dismissed', { os, surface: 'interstitial' })
  }

  function trackCtaClick(surface = 'banner') {
    safeTrack('app_banner_cta_clicked', { os, surface })
    if (storeUrl) window.location.assign(storeUrl)
  }

  return {
    shouldShowBanner,
    shouldShowInterstitial,
    storeUrl,
    os,
    dismissBanner,
    dismissInterstitial,
    trackCtaClick,
  }
}
