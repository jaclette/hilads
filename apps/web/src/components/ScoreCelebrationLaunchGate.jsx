import { useEffect, useState } from 'react'
import { ackScoreCelebration, fetchScoreCelebration } from '../api'
import ScoreCelebrationModal from './ScoreCelebrationModal'

/**
 * Web parity for the mobile ScoreCelebrationLaunchGate. Auto-opens the
 * "+X points!" modal on app load when the user has unacknowledged
 * score_events.
 *
 * Per-session policy mirrors mobile + matches the rate-prompt gate:
 *   - Fires ONCE per fresh page load.
 *   - On close, posts the seen_until watermark to the server so the same
 *     delta is never re-celebrated across devices.
 *   - Anon viewers skip (the API is auth-gated).
 */
export default function ScoreCelebrationLaunchGate({ account, refetchKey = 0, onOpenLeaderboard }) {
  const [data,   setData]   = useState(null)
  const [closed, setClosed] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!account?.id) { setData(null); setClosed(false); return }
    if (closed) return
    ;(async () => {
      const result = await fetchScoreCelebration()
      if (cancelled) return
      if (result && result.points > 0) setData(result)
    })()
    return () => { cancelled = true }
  }, [account?.id, closed])

  // Host bumps refetchKey on a WS event that earned points
  // (mutual_rating_complete, challenge_date_approved). We can't rely
  // on the cold-start effect above re-firing - `closed` is initially
  // false, so setting it to false again is a no-op and React skips
  // the dep change. Fetch directly here instead, then surface the
  // popin once we have a non-zero delta. This is what makes the
  // second rater see their +30/+40 popin without leaving the page.
  useEffect(() => {
    if (refetchKey <= 0 || !account?.id) return
    let cancelled = false
    ;(async () => {
      const result = await fetchScoreCelebration()
      if (cancelled) return
      if (result && result.points > 0) {
        setClosed(false)
        setData(result)
      }
    })()
    return () => { cancelled = true }
  }, [refetchKey, account?.id])

  // Shared cleanup - acks the watermark and closes the modal. Used by
  // both the "Let's go" CTA path and the row-tap → leaderboard path so
  // navigating away always advances the watermark.
  function ackAndClose() {
    if (data?.seen_until) {
      ackScoreCelebration(data.seen_until)
    }
    setData(null)
    setClosed(true)
  }

  return (
    <ScoreCelebrationModal
      data={data}
      visible={data !== null}
      onClose={ackAndClose}
      onOpenLeaderboard={onOpenLeaderboard ? (scope) => {
        // Ack + close BEFORE invoking the host so the watermark is
        // advanced even if the navigation interrupts our state updates.
        ackAndClose()
        onOpenLeaderboard(scope)
      } : undefined}
    />
  )
}
