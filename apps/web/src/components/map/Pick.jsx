import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from '../Icon'
import { votePick } from '../../api'
import { track } from '../../lib/analytics'
import { useDaily } from '../daily/dailyShared'

/** "Hilads pick": an editorial spot (never a player's answer). */
export function PickBadge() {
  const { t } = useTranslation('common')
  return <span className="pick-badge"><Icon name="star" size={12} />{t('pick.badge')}</span>
}

/** A pick's "Good to know": context that stays when players' photos take the cover. */
export function GoodToKnow({ note }) {
  const { t } = useTranslation('common')
  if (!note) return null
  return (
    <div className="good-to-know">
      <span className="good-to-know-title">{t('pick.goodToKnow')}</span>
      <p>{note}</p>
    </div>
  )
}

/** A cover's credit: "Photo by @username", or a pick's "Photo: Jane Doe / Unsplash". */
export function PhotoCredit({ cover, className }) {
  const { t } = useTranslation('common')
  if (!cover?.by && !cover?.credit) return null
  return <span className={className}>{cover.credit ? t('pick.credit', { credit: cover.credit }) : t('photoBy', { username: cover.by })}</span>
}

/**
 * The heart on a Hilads pick of today's challenge: one vote per pick, its own
 * count (never a player answer's: no ranking, tour, Index or points). Guests
 * get the sign-up sheet.
 */
export function PickVoteButton({ pick }) {
  const { t } = useTranslation('challenge')
  const { account, needAccount } = useDaily()
  const [state, setState] = useState({ on: !!pick.myVote, n: pick.voteCount ?? 0 })
  const [busy, setBusy] = useState(false)
  const press = async (e) => {
    e.stopPropagation()
    if (!account) { needAccount('daily_vote', { city: pick.city?.name ?? null }); return }
    if (busy) return
    const on = !state.on
    setBusy(true)
    setState(s => ({ on, n: Math.max(0, s.n + (on ? 1 : -1)) }))   // instant, then the server's count
    try {
      const r = await votePick(pick.place.id, on)
      setState({ on: r.voted, n: r.voteCount })
      track('pick_vote_cast', { action: on ? 'vote' : 'unvote', city: pick.city?.name ?? null, platform_surface: 'web' })
    } catch {
      setState(s => ({ on: !on, n: Math.max(0, s.n + (on ? -1 : 1)) }))
    } finally {
      setBusy(false)
    }
  }
  return (
    <button type="button" className={`pick-vote${state.on ? ' pick-vote--on' : ''}`} onClick={press}
            aria-pressed={state.on} aria-label={state.on ? t('dc.vote.withdraw') : t('dc.vote.vote')}>
      <Icon name={state.on ? 'heart' : 'heart-outline'} size={16} />{state.n}
    </button>
  )
}
