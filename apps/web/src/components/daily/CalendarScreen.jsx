import { useEffect, useMemo, useState } from 'react'
import BackButton from '../BackButton'
import { fetchDailyCalendar } from '../../api'
import Icon from '../Icon'
import { THEME_ICON } from '../../lib/icons'
import { useDaily, useDc } from './dailyShared'

/** YYYY-MM-DD of a Date in UTC. */
export const ymd = (d) => d.toISOString().slice(0, 10)

/**
 * Month calendar of my Daily Challenges (the app's daily/calendar): completed
 * days, days in review, my current and best streak. A published day opens its
 * challenge screen.
 */
export default function CalendarScreen({ onBack }) {
  const { t, i18n } = useDc()
  const { openDaily } = useDaily()
  const thisMonth = ymd(new Date()).slice(0, 7)
  const [month, setMonth] = useState(thisMonth)
  const [data, setData] = useState(null)

  const { first, last } = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    return { first: `${month}-01`, last: ymd(new Date(Date.UTC(y, m, 0, 12))) }
  }, [month])
  useEffect(() => { setData(null); fetchDailyCalendar(first, last).then(setData).catch(() => {}) }, [first, last])

  const shift = (n) => {
    const [y, m] = month.split('-').map(Number)
    setMonth(ymd(new Date(Date.UTC(y, m - 1 + n, 1, 12))).slice(0, 7))
  }
  const title = new Date(`${first}T12:00:00Z`).toLocaleDateString(i18n.language, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(2026, 10, 2 + i, 12)).toLocaleDateString(i18n.language, { weekday: 'narrow', timeZone: 'UTC' }))
  const days = data?.days ?? []
  const today = data?.today ?? null
  const monthDone = days.filter(d => d.myStatus === 'approved').length

  return (
    <div className="full-page dc-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{t('calendar.title')}</span>
      </div>
      <div className="page-body dc-body">
        {data?.streak && (
          <div className="dc-stats">
            <div className="dc-stat"><span className="dc-stat-value" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="flame-outline" size={20} style={{ color: 'var(--primary-text)' }} />{data.streak.current}</span><span className="dc-muted">{t('calendar.streak')}</span></div>
            <div className="dc-stat"><span className="dc-stat-value" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="flame-outline" size={20} style={{ color: 'var(--primary-text)' }} />{data.streak.best}</span><span className="dc-muted">{t('calendar.best')}</span></div>
          </div>
        )}
        <div className="dc-month">
          <button type="button" className="v3-round" onClick={() => shift(-1)} aria-label={t('calendar.prev')}><Icon name="chevron-back" size={20} /></button>
          <span className="dc-section">{title}</span>
          <button type="button" className="v3-round" onClick={() => shift(1)} disabled={month >= thisMonth} aria-label={t('calendar.next')}><Icon name="chevron-forward" size={20} /></button>
        </div>
        <div className="dc-cal">
          {weekdays.map((w, i) => <span key={`w${i}`} className="dc-cal-weekday">{w}</span>)}
          {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
          {days.map(d => {
            const done = d.myStatus === 'approved'
            const pending = d.myStatus === 'pending'
            const off = (today !== null && d.date > today) || !d.published
            return (
              <button key={d.date} type="button" className="dc-cal-cell" disabled={!d.published}
                      onClick={() => openDaily('challenge', { date: d.date })}>
                <span className={`dc-cal-dot${done ? ' dc-cal-dot--done' : ''}${pending ? ' dc-cal-dot--pending' : ''}${d.date === today ? ' dc-cal-dot--today' : ''}${off ? ' dc-cal-dot--off' : ''}`}>
                  {Number(d.date.slice(8))}
                </span>
                <span className={`dc-cal-emoji${off ? ' dc-cal-emoji--off' : ''}`}>{d.theme && THEME_ICON[d.theme.key] ? <Icon name={THEME_ICON[d.theme.key]} size={13} /> : null}</span>
              </button>
            )
          })}
        </div>
        {!data && <div className="dc-center"><span className="wm-spinner" aria-hidden="true" /></div>}
        <div className="dc-legend">
          <span className="dc-cal-dot dc-cal-dot--done dc-legend-dot" /> <span className="dc-muted">{t('calendar.legendDone')}</span>
          <span className="dc-cal-dot dc-cal-dot--pending dc-legend-dot" /> <span className="dc-muted">{t('calendar.legendPending')}</span>
        </div>
        {data?.streak && <p className="dc-muted">{t('calendar.monthDone', { n: monthDone })}</p>}
      </div>
    </div>
  )
}
