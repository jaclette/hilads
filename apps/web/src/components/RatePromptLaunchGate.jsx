import { useEffect, useState } from 'react'
import { fetchRatePrompts } from '../api'
import RateSheet from './RateSheet'

/**
 * Web parity for the mobile RatePromptLaunchGate.
 *
 * Auto-opens the RateSheet when the caller has at least one rate-eligible
 * meet-up (proposed_ends_at < now() AND not yet rated). Three triggers:
 *
 *   1. Cold start — the effect runs once `account.id` is known.
 *   2. `refetchKey` bumped by App.jsx on the `rating_received` WS event:
 *      the counterparty just submitted the first rating, surface our side
 *      without a reload.
 *   3. document `visibilitychange` → visible — covers the case where the
 *      tab was hidden when the WS event fired (the socket may have been
 *      torn down by the browser and not replayed any missed events).
 *
 * Per-session policy:
 *   - After submit OR dismiss ("Not now"), the gate stays closed UNLESS
 *     a fresh trigger above arrives. The refetchKey / visibilitychange
 *     handlers clear `closed` so a new rating poke reopens it.
 *
 * Anon viewers skip entirely (the API requires auth; bail client-side
 * so we don't spam a 401 into the network tab).
 *
 * Props:
 *   - account:    { id, ... } | null
 *   - refetchKey: number — bumps from App.jsx when WS says to re-look
 */
export default function RatePromptLaunchGate({ account, refetchKey = 0 }) {
  const [prompt, setPrompt] = useState(null)
  const [closed, setClosed] = useState(false)
  const [nonce,  setNonce]  = useState(0)

  // Reopen logic — when refetchKey changes (WS), clear `closed` and bump
  // the local nonce so the fetch effect re-runs even if `closed` was
  // already false.
  useEffect(() => {
    if (refetchKey === 0) return // ignore the initial mount value
    setClosed(false)
    setPrompt(null)
    setNonce(n => n + 1)
  }, [refetchKey])

  // visibilitychange → resync on every "back to visible" transition.
  // Cheap (one HTTP call), covers hidden-tab → WS missed → push-tap-back.
  useEffect(() => {
    if (!account?.id) return
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      setClosed(false)
      setNonce(n => n + 1)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [account?.id])

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
  }, [account?.id, closed, nonce])

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
