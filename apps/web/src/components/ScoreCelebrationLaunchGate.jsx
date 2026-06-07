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
export default function ScoreCelebrationLaunchGate({ account }) {
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

  function handleClose() {
    // Ack BEFORE clearing local state so the watermark advances even if
    // the user navigates away immediately. Network failure is non-fatal —
    // the helper swallows errors; worst case the popin re-shows next load.
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
      onClose={handleClose}
    />
  )
}
