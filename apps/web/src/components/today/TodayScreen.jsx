import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchDailyToday } from '../../api'
import { localizeCityName } from '../../i18n/cityName'
import { track } from '../../lib/analytics'
import { THEME_EMOJI, APP_STORE, PLAY_STORE, deviceStore } from '../map/spotsShared'

/** "5h 12m" / "12m" from seconds. */
function clock(s) {
  const h = Math.floor(s / 3600)
  const m = Math.max(0, Math.floor((s % 3600) / 60))
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

/**
 * TODAY, the web home (W1, mirrors the app's Today tab): today's Daily
 * Challenge as a ticket. Proofs are posted from the app, so "Take the
 * challenge" opens the store. The full Today (week strip, top 3, spots near
 * you, proposals) comes in W2.
 */
export default function TodayScreen({ channelId, header }) {
  const { t, i18n } = useTranslation('challenge')
  const [data, setData] = useState(null)
  const [left, setLeft] = useState(null)

  useEffect(() => {
    let alive = true
    fetchDailyToday(channelId, i18n.language)
      .then(d => { if (alive) { setData(d); setLeft(d.secondsLeft) } })
      .catch(() => {})
    return () => { alive = false }
  }, [channelId, i18n.language])

  useEffect(() => {
    if (left === null) return
    const id = setInterval(() => setLeft(s => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(id)
  }, [left === null]) // eslint-disable-line react-hooks/exhaustive-deps

  const store = deviceStore()
  const storeUrl = store === 'android' ? PLAY_STORE : APP_STORE
  const challenge = data?.challenge ?? null
  const twist = data?.twist && data?.city?.isLive ? data.twist : null
  const earlyUntil = !data?.myProof && data?.early && data.early.until * 1000 > Date.now() ? data.early.until : null

  return (
    <div className="full-page full-page--tab today-page">
      <div className="tab-app-header">{header}</div>
      <div className="page-body today-body">
        {!data ? (
          <div className="today-ticket today-ticket--loading"><span className="wm-spinner" aria-hidden="true" /></div>
        ) : !challenge ? (
          <div className="today-ticket">
            <div className="today-kicker">🔥 {t('today.kicker')}</div>
            <p className="today-text">{t('today.nothingLive')}</p>
            {left !== null && <p className="today-meta">{t('today.nextIn', { time: clock(left) })}</p>}
          </div>
        ) : (
          <div className="today-ticket">
            <div className="today-top">
              <div className="today-head">
                <span className="today-kicker">🔥 {t('today.kicker')}</span>
                {challenge.theme && (
                  <span className="today-chip">{THEME_EMOJI[challenge.theme.key] || '•'} {challenge.theme.name}</span>
                )}
              </div>
              <p className="today-text">{challenge.text}</p>
              <div className="today-meta-row">
                {left !== null && <span className="today-meta">⏱ {t('today.timeLeft', { time: clock(left) })}</span>}
                {earlyUntil && (
                  <span className="today-early">
                    {t('today.early', { time: new Date(earlyUntil * 1000).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) })}
                  </span>
                )}
              </div>
            </div>
            <div className="today-perforation" aria-hidden="true" />
            <div className="today-bottom">
              {twist && (
                <div className="today-twist">
                  <span className="today-twist-label">{t('today.twistIn', { city: localizeCityName(data.city?.name ?? '') })}</span>
                  <span className="today-twist-text">{twist.text}</span>
                </div>
              )}
              <a className="today-cta" href={storeUrl} target="_blank" rel="noopener noreferrer"
                 onClick={() => track('web_today_take_clicked', { store: store ?? 'ios' })}>
                {t('today.cta')}
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
