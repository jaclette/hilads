import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchUserDaily } from '../../api'
import { shortCityName } from '../../i18n/cityName'
import { FlagSticker } from '../joy/Joy'
import { useDaily } from '../daily/dailyShared'

/**
 * Your rivals (V6) in World › Cities (moved from Passport in the UX audit, as the app: one place
 * to compare cities): the cities I played the same challenges as, most duels first; a click opens
 * the face-off. Members only; nothing while loading.
 */
export default function RivalsBlock() {
  const { t, i18n } = useTranslation('profile', { keyPrefix: 'pp' })
  const { account, openDaily } = useDaily()
  const [rivals, setRivals] = useState(null)
  useEffect(() => {
    if (!account) return
    let alive = true
    fetchUserDaily(account.id, i18n.language).then(s => { if (alive) setRivals(s?.comparedCities ?? []) }).catch(() => {})
    return () => { alive = false }
  }, [account?.id, i18n.language]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!account || rivals === null) return null
  return (
    <div className="pp-compared-block r6-rivals" data-testid="world-rivals">
      <span className="pp-rivals-title">⚔️ {t('passport.rivals')}</span>
      {rivals.length > 0 ? (
        <div className="pp-flags">
          {rivals.map(c => (
            <button key={c.id} type="button" className="pp-flag-chip"
                    aria-label={`${shortCityName(c.name ?? '')}, ${t('passport.duels', { count: c.duels ?? 1 })}`}
                    onClick={() => openDaily('rivals', { city: c.id, user: account.id })}>
              <FlagSticker country={c.country} size={22} />
              <span className="pp-flag-name">{shortCityName(c.name ?? '')}</span>
              {!!c.duels && <span className="pp-duels">{t('passport.duels', { count: c.duels })}</span>}
            </button>
          ))}
        </div>
      ) : (
        <span className="dc-muted pp-compared">{t('passport.rivalsEmpty')}</span>
      )}
    </div>
  )
}
