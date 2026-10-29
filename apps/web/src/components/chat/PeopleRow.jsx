import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchPeopleCounts } from '../../api'
import Icon from '../Icon'

const REFRESH_MS = 60_000

/**
 * The Chat people row (W3, the app's PeopleRow, SPEC 9.6): Hi now, tonight's
 * plans with who is going, arrivals this week, people here now. Only counts
 * above the threshold come back from the API; an empty row is hidden.
 */
export default function PeopleRow({ cityId, onHiNow, onPlan, onArrivals, onNearby }) {
  const { t, i18n } = useTranslation('chat')
  const [counts, setCounts] = useState(null)

  useEffect(() => {
    let alive = true
    const load = () => fetchPeopleCounts(cityId).then(c => { if (alive) setCounts(c) }).catch(() => {})
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => { alive = false; clearInterval(id) }
  }, [cityId])

  if (!counts) return null
  const chips = []
  if (counts.hiNow !== null) {
    chips.push(
      <button key="hinow" type="button" className="people-chip people-chip--accent" onClick={onHiNow}
              aria-label={t('people.hiNowA11y', { count: counts.hiNow })}>
        <Icon name="hand-left-outline" size={15} /> {t('people.hiNow')}
      </button>,
    )
  }
  for (const p of counts.tonight ?? []) {
    const time = new Date(p.startsAt * 1000).toLocaleTimeString(i18n.language, { hour: 'numeric', minute: '2-digit' })
    chips.push(
      <button key={p.id} type="button" className="people-chip" onClick={() => onPlan(p.id)}>
        {/* Who's going: up to 3 small faces before the title (absent from an older server). */}
        {!!p.avatars?.length && (
          <span className="people-faces" aria-hidden="true">
            {p.avatars.slice(0, 3).map(uri => <img key={uri} className="people-face" src={uri} alt="" loading="lazy" />)}
          </span>
        )}
        <strong className="people-chip-title">{p.title}, {time}</strong>
        {p.going !== null && <span className="people-chip-muted">{t('people.going', { count: p.going })}</span>}
      </button>,
    )
  }
  if (counts.arrivalsWeek !== null) {
    chips.push(<button key="arrivals" type="button" className="people-chip" onClick={onArrivals}>{t('people.arrivals', { count: counts.arrivalsWeek })}</button>)
  }
  if (counts.nearby !== null) {
    chips.push(
      <button key="nearby" type="button" className="people-chip" onClick={onNearby}>
        <span className="people-chip-dot" aria-hidden="true" />{t('people.nearby', { count: counts.nearby })}
      </button>,
    )
  }
  if (chips.length === 0) return null
  return <div className="people-row">{chips}</div>
}
