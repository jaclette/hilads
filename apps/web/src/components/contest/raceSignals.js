import { useEffect, useState } from 'react'

/**
 * The web's race signals (the app's raceSignals.ts), per browser and campaign (localStorage): Today
 * visits (the banner is the full postcard for the first N), my race rank as last known and a rank
 * change (from → to, when). A change keeps the banner full for H hours, lights the Trip tab's dot
 * until the tab is opened, and adds a line to "While you were away" until it's seen.
 */
const KEY = 'hilads_trip_race_signals_v1'
let state = (() => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') ?? null } catch { return null } })()
  ?? { id: null, rank: null, visits: 0, change: null }
const subs = new Set()
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* storage off */ } subs.forEach(f => f()) }
const forSeason = id => { if (state.id !== id) state = { id, rank: null, visits: 0, change: null } }

/** The overview answered: my rank in the race now (null = not ranked). */
export function syncRaceRank(seasonId, rank) {
  const before = state.id
  forSeason(seasonId)
  if (rank == null || rank === state.rank) { if (before !== seasonId) save(); return }
  if (state.rank != null) state.change = { from: state.rank, to: rank, at: Date.now(), awayAck: false, tabAck: false }
  state.rank = rank
  save()
}

/** The overview's rank for me (ranked players only). */
export function noteRank(d) {
  const s = d?.season
  if (!s) return
  const race = d.me?.joined ? d.me.race : null
  syncRaceRank(s.id, race?.rank && race.points > 0 ? race.rank : null)
}

export function countTodayVisit(seasonId) { forSeason(seasonId); state.visits += 1; save(); return state.visits }
export function ackRankAway() { if (state.change && !state.change.awayAck) { state.change.awayAck = true; save() } }
export function ackRankTab() { if (state.change && !state.change.tabAck) { state.change.tabAck = true; save() } }

export function useRaceSignals(seasonId) {
  const [, tick] = useState(0)
  useEffect(() => { const f = () => tick(n => n + 1); subs.add(f); return () => { subs.delete(f) } }, [])
  if (seasonId == null || state.id !== seasonId) return { visits: 0, change: null }
  return { visits: state.visits, change: state.change }
}

/** Full or slim for this visit (the app's bannerSize). */
export function bannerSize(s, visit, changeAt, now) {
  const cfg = s.tab?.banner ?? { fullVisits: 3, momentHours: 24 }
  if (visit > 0 && visit <= cfg.fullVisits) return 'full'
  const H = cfg.momentHours * 3600000
  const at = iso => (iso ? Date.parse(iso) : NaN)
  const after = t => Number.isFinite(t) && now >= t && now < t + H
  const ends = at(s.endsAt)
  if (after(at(s.startsAt)) || after(at(s.finalAt))) return 'full'
  if (Number.isFinite(ends) && now >= ends - H && now < ends) return 'full'
  if (changeAt != null && now - changeAt < H) return 'full'
  return 'slim'
}

/** The campaign the signals are about (the last overview seen), for screens without the overview. */
export function useRaceSeasonId() {
  const [, tick] = useState(0)
  useEffect(() => { const f = () => tick(n => n + 1); subs.add(f); return () => { subs.delete(f) } }, [])
  return state.id
}
