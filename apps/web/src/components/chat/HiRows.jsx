import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import { fetchChannelPlans, toggleEventParticipation } from '../../api'
import Icon from '../Icon'

/**
 * The Hi chat's own rows on the web (as the app's features/chat/HiRows): the question of the
 * day, the "🎉 maxime created a plan" line, the unread marker, scroll-to-latest, the next plan.
 */
export function QuestionCard({ item, world, onAnswer }) {
  const { t } = useTranslation('chat')
  const answers = Number(item.payload?.answers ?? 0)
  return (
    <div className="hi-question" role="group" aria-label={t('hi.question')}>
      <p className="hi-question-kicker">{world ? '🌍' : '☕'} {t('hi.question')}</p>
      <p className="hi-question-text">{item.content}</p>
      <div className="hi-question-row">
        <span>💬 {answers > 0 ? t('hi.answers', { count: answers }) : t('hi.firstAnswer')}</span>
        <button type="button" className="hi-answer" onClick={onAnswer}>{t('hi.answer')}</button>
      </div>
    </div>
  )
}

export function PlanLine({ item, onOpen }) {
  const { t } = useTranslation('chat')
  const p = item.payload ?? {}
  const when = p.startsAt ? new Date(p.startsAt * 1000).toLocaleString(i18n.language, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : ''
  return (
    <button type="button" className="hi-plan-line" disabled={!p.eventId} onClick={() => p.eventId && onOpen?.(p.eventId)}>
      🎉 {t('hi.planCreated', { name: item.nickname, title: p.title ?? item.content ?? '', when })}
    </button>
  )
}

export function UnreadMarker({ count }) {
  const { t } = useTranslation('chat')
  return <div className="hi-unread" role="separator"><span>{t('hi.unread', { count })}</span></div>
}

export function ScrollToLatest({ count, onClick }) {
  const { t } = useTranslation('chat')
  return (
    <button type="button" className="hi-latest" onClick={onClick} aria-label={count > 0 ? t('hi.newBelow', { count }) : t('hi.latest')}>
      <Icon name="arrow-down" size={20} />{count > 0 && <b>{count > 9 ? '9+' : count}</b>}
    </button>
  )
}

export function NextPlanRow({ channelId, guestId, sessionId, onOpen, onAll }) {
  const { t } = useTranslation('chat')
  const [plans, setPlans] = useState(null)
  const [going, setGoing] = useState(null)
  useEffect(() => {
    let alive = true
    fetchChannelPlans(channelId, guestId).then(evs => {
      if (!alive) return
      const now = Date.now() / 1000
      const next = (evs ?? []).filter(e => (e.ends_at ?? e.starts_at + 3 * 3600) > now).sort((a, b) => a.starts_at - b.starts_at)
      setPlans(next)
      if (next[0]) setGoing({ count: next[0].participant_count ?? 0, isIn: !!next[0].is_participating })
    }).catch(() => setPlans([]))
    return () => { alive = false }
  }, [channelId, guestId])
  const first = plans?.[0]
  if (!first) return null
  const more = plans.length - 1
  const when = new Date(first.starts_at * 1000).toLocaleString(i18n.language, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  const join = async () => { try { setGoing(await toggleEventParticipation(first.id, sessionId)) } catch { /* unchanged */ } }
  return (
    <div className="hi-plan">
      <button type="button" className="hi-plan-main" onClick={() => onOpen?.(first.id)}>
        <Icon name="calendar-outline" size={20} />
        <span className="hi-plan-body"><b>{first.title}</b>
          <small>{when}{going?.count > 0 ? ` · ${t('hi.going', { count: going.count })}` : ''}{more > 0 ? ` · ${t('hi.morePlans', { count: more })}` : ''}</small></span>
      </button>
      {more > 0 && <button type="button" className="hi-plan-more" onClick={onAll}>+{more}</button>}
      <button type="button" className={`hi-join${going?.isIn ? ' on' : ''}`} onClick={join} aria-pressed={!!going?.isIn}>{going?.isIn ? '✓' : t('hi.join')}</button>
    </div>
  )
}
