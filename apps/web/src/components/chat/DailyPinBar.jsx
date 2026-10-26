import { useEffect, useState } from 'react'
import { fetchDailyToday } from '../../api'
import { setSeasonalEvent } from '../event/seasonal'
import { track } from '../../lib/analytics'
import { deviceStore } from '../map/spotsShared'
import { openAppModal } from '../AppModal'
import Icon from '../Icon'
import { themeIcon } from '../../lib/icons'
import { useDaily, useDc, StatusChip } from '../daily/dailyShared'

/**
 * Today's Daily Challenge pinned on top of Chat, city and World (W3, the app's
 * DailyPinBar): theme, "Daily Challenge", the challenge on one line, and
 * "Take it" (the store; proofs are posted from the app) or my proof's status.
 * The bar opens the challenge screen.
 */
export default function DailyPinBar() {
  const { t, i18n } = useDc()
  const { cityId, openDaily } = useDaily()
  const [data, setData] = useState(null)

  useEffect(() => {
    let alive = true
    fetchDailyToday(cityId, i18n.language).then(d => { setSeasonalEvent(d?.event); if (alive) setData(d) }).catch(() => {})
    return () => { alive = false }
  }, [cityId, i18n.language])

  const challenge = data?.challenge
  if (!challenge) return null
  const myProof = data.myProof ?? null
  const store = deviceStore()
  const open = () => {
    track('daily_challenge_viewed', { source: 'chat_pin', date: challenge.date, platform_surface: 'web' })
    openDaily('challenge', { date: challenge.date, source: 'chat_pin' })
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
           onClick={(e) => { e.stopPropagation(); track('web_today_take_clicked', { store: store ?? 'ios', surface: 'chat_pin' }); openAppModal({ action: 'play', surface: 'chat_pin' }) }}>
          {t('takeIt')}
        </button>
      )}
    </div>
  )
}
