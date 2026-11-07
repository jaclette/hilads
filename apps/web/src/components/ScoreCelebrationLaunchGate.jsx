import { useCallback, useEffect, useRef, useState } from 'react'
import { ackScoreCelebration, fetchScoreCelebration } from '../api'
import { useCelebrationTurn } from '../lib/celebrationQueue'
import { track } from '../lib/analytics'
import { shortCityName } from '../i18n/cityName'
import i18n from '../i18n'
import ScoreCelebrationModal from './ScoreCelebrationModal'

const SEEN_KEY = (userId) => `hilads_score_win_seen_${userId}`
const seenOf = (userId) => { try { return localStorage.getItem(SEEN_KEY(userId)) } catch { return null } }

/**
 * The points reward (as the app's ScoreCelebrationLaunchGate): asks the server
 * for unacknowledged points on load, when the tab comes back into view and when
 * the host bumps refetchKey (the older challenge pings). One celebration at a
 * time (lib/celebrationQueue): it waits for its turn and for nothing else open.
 * Acknowledged when it opens (server watermark + localStorage), so the same
 * reward never shows twice. Guests skip (the API is auth-gated).
 */
export default function ScoreCelebrationLaunchGate({ account, refetchKey = 0, onOpenRanks, onToast }) {
  const [data, setData] = useState(null)
  const loading = useRef(false)
  const userId = account?.id ?? null

  const refetch = useCallback(async () => {
    if (!userId || loading.current) return
    loading.current = true
    try {
      const r = await fetchScoreCelebration()
      if (!(r?.points > 0) || !r.seen_until) return
      const seen = seenOf(userId)
      if (seen && r.seen_until <= seen) return
      setData(prev => prev ?? r)
    } finally {
      loading.current = false
    }
  }, [userId])

  useEffect(() => { if (!userId) setData(null); else refetch() }, [userId, refetch])
  useEffect(() => { if (refetchKey > 0) refetch() }, [refetchKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') refetch() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [refetch])

  const turn = useCelebrationTurn('score', data !== null)

  const opened = useRef(null)
  useEffect(() => {
    if (!turn || !data?.seen_until || !userId || opened.current === data.seen_until) return
    opened.current = data.seen_until
    ackScoreCelebration(data.seen_until)
    try { localStorage.setItem(SEEN_KEY(userId), data.seen_until) } catch { /* private mode */ }
    track('score_win_shown', { points: data.points, period: data.win?.period ?? null, sources: data.win?.sources?.map(s => s.source).join(',') ?? null })
  }, [turn, data, userId])

  const close = useCallback(() => setData(null), [])

  const openRanks = (to) => {
    track('score_win_ranks', to)
    close()
    onOpenRanks?.(to)
  }

  // "Share my win": the photo's page (its Result card) with "I'm #1 in Saigon today".
  const share = async (win, medal) => {
    if (!win.proof) return
    track('score_win_share', { medal: medal?.key ?? null, rank: medal?.rank ?? null })
    const line = medal ? winLine(medal, win.period) : null
    const url = `${window.location.origin}/p/${win.proof.id}?tpl=result`
    const text = line ? `${line} 🏆` : ''
    if (navigator.share) {
      try { await navigator.share({ title: text || 'Hilads', text, url }); return } catch { /* cancelled */ }
    }
    try { await navigator.clipboard?.writeText(text ? `${text} ${url}` : url); onToast?.(i18n.t('shareLink.copied', { ns: 'common' })) } catch { /* nothing more */ }
  }

  return <ScoreCelebrationModal data={data} visible={turn && data !== null} onClose={close} onOpenRanks={openRanks} onShare={share} />
}

/** "I'm #1 in Saigon today". */
function winLine(m, period) {
  const city = shortCityName(m.city?.name ?? '')
  const where = m.key === 'world' ? 'world' : m.key === 'cities' ? 'cities' : 'city'
  return i18n.t(`scoreWin.shareLine.${where}_${period}`, { ns: 'challenge', rank: m.rank, city })
}
