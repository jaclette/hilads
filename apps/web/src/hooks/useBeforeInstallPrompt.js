import { useEffect, useMemo, useState } from 'react'
import { appPromotion } from '../lib/appPromotion'

const INSTALL_DISMISS_KEY = 'hilads_install_prompt_dismissed_until'
const INSTALL_FEED_KEY = 'hilads_install_feed_prompt_seen'
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

// Capture beforeinstallprompt at module load — before React mounts.
// This ensures we never miss the event due to useEffect running after mount.
let _earlyPrompt = null
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    _earlyPrompt = e
  }, { once: true })
}

function getStoredNumber(key) {
  if (typeof window === 'undefined') return 0
  const raw = window.localStorage.getItem(key)
  const value = Number(raw)
  return Number.isFinite(value) ? value : 0
}

function isStandaloneMode() {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||
    document.referrer.startsWith('android-app://')
  )
}

function getPlatformState() {
  if (typeof navigator === 'undefined') {
    return { isIOS: false, isSafari: false, isMobile: false }
  }

  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isAndroid = /Android/i.test(ua)
  const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|Edg|OPR|Firefox|FxiOS/i.test(ua)
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || navigator.maxTouchPoints > 1

  return { isIOS, isAndroid, isSafari, isMobile }
}

export default function useBeforeInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [isInstalled, setIsInstalled] = useState(() => isStandaloneMode())
  const [dismissedUntil, setDismissedUntil] = useState(() => getStoredNumber(INSTALL_DISMISS_KEY))
  const [manualHelpVisible, setManualHelpVisible] = useState(false)
  const [feedPromptSeen, setFeedPromptSeen] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(INSTALL_FEED_KEY) === '1'
  })

  const platform = useMemo(() => getPlatformState(), [])

  useEffect(() => {
    // Pick up any event captured before React mounted
    if (_earlyPrompt) {
      setDeferredPrompt(_earlyPrompt)
      _earlyPrompt = null
    }

    const onBeforeInstallPrompt = (event) => {
      event.preventDefault()
      setDeferredPrompt(event)
    }

    const onInstalled = () => {
      setIsInstalled(true)
      setDeferredPrompt(null)
      setManualHelpVisible(false)
      window.localStorage.removeItem(INSTALL_DISMISS_KEY)
      setDismissedUntil(0)
    }

    const onDisplayModeChange = () => setIsInstalled(isStandaloneMode())

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onInstalled)

    const media = window.matchMedia?.('(display-mode: standalone)')
    media?.addEventListener?.('change', onDisplayModeChange)
    media?.addListener?.(onDisplayModeChange)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      media?.removeEventListener?.('change', onDisplayModeChange)
      media?.removeListener?.(onDisplayModeChange)
    }
  }, [])

  const dismissBanner = () => {
    const nextDismissedUntil = Date.now() + DISMISS_COOLDOWN_MS
    window.localStorage.setItem(INSTALL_DISMISS_KEY, String(nextDismissedUntil))
    setDismissedUntil(nextDismissedUntil)
    setManualHelpVisible(false)
  }

  const promptInstall = async () => {
    if (deferredPrompt) {
      const promptEvent = deferredPrompt
      setDeferredPrompt(null)
      try {
        await promptEvent.prompt()
      } catch {
        // prompt() can throw if called at wrong time; treat as dismissed
        return false
      }
      const { outcome } = await promptEvent.userChoice.catch(() => ({ outcome: 'dismissed' }))
      if (outcome === 'accepted') {
        setIsInstalled(true)
        return true
      }
      // User dismissed the native dialog — don't set a 7-day cooldown.
      // The banner stays visible in fallback mode so they can still add manually.
      return false
    }

    // No native prompt available (iOS Safari, Firefox, etc.) — show manual instructions
    setManualHelpVisible(true)
    return false
  }

  const markFeedPromptShown = () => {
    window.localStorage.setItem(INSTALL_FEED_KEY, '1')
    setFeedPromptSeen(true)
  }

  const canUseNativePrompt = !!deferredPrompt
  const isDismissed = dismissedUntil > Date.now()
  const canShowFallback = !canUseNativePrompt && !isInstalled && platform.isMobile
  // On Android, the Play Store promo banner takes precedence over the PWA
  // "Add to Home Screen" prompt — the native app is a strictly better
  // experience. Suppress the PWA banner whenever the Play Store promo would
  // show, regardless of dismissal state on either side.
  const androidPromoActive = appPromotion.banner
    && appPromotion.android.enabled
    && platform.isAndroid
    && !!appPromotion.android.storeUrl
  const shouldShowBanner = !isInstalled && !isDismissed
    && (canUseNativePrompt || canShowFallback)
    && !androidPromoActive

  const instructionText = canUseNativePrompt
    ? 'Add Hilads to your home screen'
    : platform.isIOS && platform.isSafari
      ? 'Tap Share, then "Add to Home Screen"'
      : 'Open browser menu → Add to Home Screen'

  return {
    canUseNativePrompt,
    dismissBanner,
    feedPromptSeen,
    instructionText,
    isFallback: !canUseNativePrompt,
    isInstalled,
    manualHelpVisible,
    markFeedPromptShown,
    platform,
    promptInstall,
    shouldShowBanner,
  }
}
