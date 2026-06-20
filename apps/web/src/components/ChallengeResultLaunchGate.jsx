import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchChallengeReveals, markNotificationsRead } from '../api'
import ChallengeResultModal from './ChallengeResultModal'

/**
 * Web parity for the mobile ChallengeResultLaunchGate. Surfaces a GROUP
 * challenge result reveal (winning photo / present / absent + the viewer's
 * points) from the UNREAD challenge_group_result_* notifications. Reaches
 * losers/absentees (no score delta). The host bumps `refetchKey` on the
 * city-room `challenge_validated` WS event; cold load is the fallback. Acks via
 * mark-read so a reveal never re-shows.
 */
export default function ChallengeResultLaunchGate({ account, refetchKey = 0 }) {
  const [queue, setQueue] = useState([])
  const current = queue[0] ?? null
  const loading = useRef(false)

  const refetch = useCallback(async () => {
    if (!account?.id || loading.current) return
    loading.current = true
    try {
      const reveals = await fetchChallengeReveals()
      if (!reveals.length) return
      setQueue((prev) => {
        const seen = new Set(prev.map((r) => r.id))
        const fresh = reveals.filter((r) => !seen.has(r.id))
        return fresh.length ? [...prev, ...fresh] : prev
      })
    } finally {
      loading.current = false
    }
  }, [account?.id])

  useEffect(() => { void refetch() }, [refetch])
  useEffect(() => { if (refetchKey > 0) void refetch() }, [refetchKey, refetch])

  const handleClose = useCallback(() => {
    if (current) markNotificationsRead([current.id])
    setQueue((prev) => prev.slice(1))
  }, [current])

  return <ChallengeResultModal reveal={current} visible={current !== null} onClose={handleClose} />
}
