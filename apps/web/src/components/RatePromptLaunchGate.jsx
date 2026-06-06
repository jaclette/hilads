import { useEffect, useState } from 'react'
import { fetchRatePrompts } from '../api'
import RateSheet from './RateSheet'

/**
 * Web parity for the mobile RatePromptLaunchGate.
 *
 * Auto-opens the RateSheet on app load when the caller has at least one
 * rate-eligible meet-up (proposed_ends_at < now() AND not yet rated).
 *
 * Mounted in App.jsx at the page-root level — sits above the threads /
 * city-chat surfaces so the sheet renders on top regardless of where the
 * user landed after login (city chat by default, deep-link target, etc.).
 *
 * Per-session policy mirrors mobile:
 *   - Fires ONCE per fresh page load (the natural "session" boundary on web).
 *   - After submit OR dismiss ("Not now"), the gate doesn't re-open in the
 *     same session — the /threads banner remains the fallback surface.
 *
 * Other gates:
 *   - Anon viewers skip entirely (the API requires auth; bail client-side
 *     so we don't spam a 401 into the network tab).
 *   - The fetch re-runs when account.id changes (account switch in same tab).
 *
 * Props mirror the mobile component:
 *   - account: { id, ... } | null
 */
export default function RatePromptLaunchGate({ account }) {
  const [prompt, setPrompt] = useState(null)
  const [closed, setClosed] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!account?.id) { setPrompt(null); setClosed(false); return }
    if (closed) return // already shown + dismissed this session
    ;(async () => {
      const prompts = await fetchRatePrompts()
      if (cancelled || prompts.length === 0) return
      setPrompt(prompts[0])
    })()
    return () => { cancelled = true }
  }, [account?.id, closed])

  function handleClose() {
    setPrompt(null)
    setClosed(true)
  }

  // RateSheet's onSubmitted fires after a successful POST and on
  // recoverable races (409 / 403) — treat both as "this prompt is done".
  function handleSubmitted() {
    setPrompt(null)
    setClosed(true)
  }

  return (
    <RateSheet
      prompt={prompt}
      visible={prompt !== null}
      onClose={handleClose}
      onSubmitted={handleSubmitted}
    />
  )
}
