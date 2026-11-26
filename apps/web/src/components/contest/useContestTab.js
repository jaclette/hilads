import { useEffect, useState } from 'react'
import i18n from 'i18next'
import { fetchContest } from '../../api'

/**
 * The campaign's temporary Trip tab (the app's useContestTab): shown only while a campaign I can
 * see is Upcoming, Running, being checked (over) or just ended (the winner, a few days); gone after.
 * Its label and icon come from the server (Admin › Launch Season), else "Trip" and a plane. A dot
 * when something is new (the tab appeared, the campaign launched, the final week, the winner),
 * cleared on tap (per browser, localStorage).
 */
const SEEN_KEY = 'contest_tab_seen'
const LIVE = new Set(['upcoming', 'season', 'final', 'over', 'ended'])
const OPENED_KEY = 'contest_tab_opened'
const readSeen = () => { try { return localStorage.getItem(SEEN_KEY) } catch { return null } }
const readOpened = () => { try { return localStorage.getItem(OPENED_KEY) === '1' } catch { return true } }

export function useContestTab() {
  const [data, setData] = useState(null)
  const [seen, setSeen] = useState(readSeen)
  // The plane's one-time takeoff glide (once per page load) until the tab was opened once.
  const [opened, setOpened] = useState(readOpened)
  useEffect(() => {
    let alive = true
    const load = () => fetchContest(i18n.language).then(d => { if (alive) setData(d) }).catch(() => {})
    load()
    const id = setInterval(load, 5 * 60 * 1000)
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVis)
    return () => { alive = false; clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [])
  const s = data?.season
  if (!s || !LIVE.has(s.phase)) return null
  const stamp = `${s.id}:${s.phase}${s.winner ? ':w' : ''}`
  return {
    label: s.tab?.label || null,
    icon: s.tab?.icon || 'airplane',
    isTest: !!s.isTest,
    isNew: seen !== stamp,
    glide: !opened,
    markSeen: () => {
      try { localStorage.setItem(SEEN_KEY, stamp); localStorage.setItem(OPENED_KEY, '1') } catch { /* private mode */ }
      setSeen(stamp); setOpened(true)
    },
  }
}
