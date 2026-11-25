import { useEffect, useState } from 'react'
import i18n from 'i18next'
import { fetchContest } from '../../api'

/**
 * The temporary Launch Season tab (the app's useContestTab): shown only while a season I can see
 * is Upcoming (teaser) or Running; gone when it ends. A launcher to the teaser / Prize screen, or
 * my contest home once joined. A dot when something is new (the tab appeared, the season
 * launched, the final week started), cleared on tap (per-browser, localStorage).
 */
const SEEN_KEY = 'contest_tab_seen'
const LIVE = new Set(['upcoming', 'season', 'final'])
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
  const stamp = `${s.id}:${s.phase}`
  return {
    sub: s.phase !== 'upcoming' && data.me?.joined ? 'contest' : 'contest-prize',
    isTest: !!s.isTest,
    isNew: seen !== stamp,
    glide: !opened,
    markSeen: () => {
      try { localStorage.setItem(SEEN_KEY, stamp); localStorage.setItem(OPENED_KEY, '1') } catch { /* private mode */ }
      setSeen(stamp); setOpened(true)
    },
  }
}
