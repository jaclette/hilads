import { useEffect, useState } from 'react'
import { fetchDailyToday } from '../../api'
import { setSeasonalEvent } from '../event/seasonal'
import { track } from '../../lib/analytics'
import { deviceStore } from '../map/spotsShared'
import { openAppModal } from '../AppModal'
import Icon from '../Icon'
import { themeIcon } from '../../lib/icons'
import { useDaily, useDc, StatusChip, setLastToday } from '../daily/dailyShared'

/**
 * Today's Daily Challenge pinned on top of Chat, city and World (W3, the app's
 * DailyPinBar, V3 polish 5): theme, "Daily Challenge", the challenge on one
 * line, and "Take it" (the store; proofs are posted from the app) or my
 * proof's status. The bar opens the challenge screen. `compact` (the feed
 * scrolled into history): a slim pill. Once my photo is in, a slim "You
 * played · See the world" pill instead (the world's photos). `onToday`: the
 * day's data once loaded (the chat's quick-start theme chip).
 */
export default function DailyPinBar({ compact = false, onToday }) {
  const { t, i18n } = useDc()
  const { cityId, openDaily } = useDaily()
  const [data, setData] = useState(null)

  useEffect(() => {
    let alive = true
    fetchDailyToday(cityId, i18n.language).then(d => { setSeasonalEvent(d?.event); if (alive) { setData(d); setLastToday(d); onToday?.(d) } }).catch(() => {})
    return () => { alive = false }
  }, [cityId, i18n.language]) // eslint-disable-line react-hooks/exhaustive-deps

  const challenge = data?.challenge
  if (!challenge) return null
  const myProof = data.myProof ?? null
  const store = deviceStore()
  const open = () => {
    track('daily_challenge_viewed', { source: 'chat_pin', date: challenge.date, platform_surface: 'web' })
    openDaily('challenge', { date: challenge.date, source: 'chat_pin' })
  }
  const take = () => { track('web_today_take_clicked', { store: store ?? 'ios', surface: 'chat_pin' }); openAppModal({ action: 'play', surface: 'chat_pin' }) }
  if (myProof?.status === 'approved') {
    return (
      <button type="button" className="pin-pill" onClick={() => openDaily('countries', { source: 'chat_pin' })}>
        <Icon name="checkmark-circle" size={16} />
        <span className="pin-pill-text">{t('hero.played')}</span>
        <Icon name="chevron-forward" size={15} />
      </button>
    )
  }
  if (compact) {
    const canTake = challenge.isActive && !myProof
    return (
      <button type="button" className="pin-pill" onClick={canTake ? take : open} aria-label={`${t('kicker')}: ${challenge.text}`}>
        <Icon name={challenge.theme ? themeIcon(challenge.theme.key, challenge.special) : 'flame-outline'} size={15} />
        <span className="pin-pill-text">{challenge.headline || challenge.text}</span>
        {canTake && <span className="pin-pill-take">{t('takeIt')}</span>}
      </button>
    )
  }
  return (
    <div className="pin-bar" role="button" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open() }}
         aria-label={`${t('kicker')}: ${challenge.text}`}>
      <span className="pin-bar-icon" aria-hidden="true" style={{ color: 'var(--primary-on-tint)' }}><Icon name={challenge.theme ? themeIcon(challenge.theme.key, challenge.special) : 'flame-outline'} size={20} /></span>
      <span className="pin-bar-body">
        <span className="pin-bar-kicker">{t('kicker')}</span>
        <span className="pin-bar-text">{challenge.text}</span>
      </span>
      {myProof ? <StatusChip status={myProof.status} /> : challenge.isActive && (
        <button type="button" className="pin-bar-take"
           onClick={(e) => { e.stopPropagation(); take() }}>
          {t('takeIt')}
        </button>
      )}
    </div>
  )
}
