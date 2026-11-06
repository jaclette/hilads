import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchNotificationPreferences, updateNotificationPreferences } from '../../api'
import { registerPush } from '../../push'
import BackButton from '../BackButton'
import { CATEGORY_EMOJI, categoryColor } from './categories'

// A toggle: its label keys (notifications:pref.<label>Label / Sub) and the preferences it sets together.
const GROUPS = [
  { category: 'social', toggles: [
    { label: 'comment', keys: ['comment_push'] }, { label: 'mention', keys: ['mention_push'] }, { label: 'like', keys: ['like_push'] },
    { label: 'friend', keys: ['friend_request_push'] }, { label: 'vibe', keys: ['vibe_received_push'] }, { label: 'profileView', keys: ['profile_view_push'] },
  ] },
  { category: 'game', toggles: [
    { label: 'results', keys: ['results_push'] }, { label: 'rank', keys: ['rank_push'] }, { label: 'stamp', keys: ['stamp_push'] }, { label: 'reminder', keys: ['reminder_push'] },
  ] },
  { category: 'plans', toggles: [
    { label: 'planJoin', keys: ['event_join_push', 'join_request_push'] }, { label: 'newPlans', keys: ['new_event_push', 'new_topic_push'] },
    { label: 'topicReply', keys: ['topic_reply_push'] },
  ] },
  { category: 'city', toggles: [{ label: 'cityJoin', keys: ['city_join_push'] }, { label: 'friendArrival', keys: ['friend_arrival_push'] }] },
  { category: 'hilads', toggles: [{ label: 'daily', keys: ['daily_challenge_push'] }, { label: 'announce', keys: ['admin_announcement_push'] }] },
]
const DEFAULT_QUIET = { start: 23 * 60, end: 8 * 60 }
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const tint = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})` }

function Toggle({ checked, onChange, color, label }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`notif-toggle${checked ? ' on' : ''}`}
                 style={checked && color ? { background: color } : undefined} onClick={() => onChange(!checked)} />
}

/**
 * Notification settings (V6, from the ⚙️ of Notifications), as in the app:
 * push status, one group per category with a master toggle and its toggles
 * (each with a one-line description), quiet hours; saved at once, with a ✓.
 */
export default function NotificationSettings({ onBack }) {
  const { t } = useTranslation('notifications')
  const [prefs, setPrefs] = useState(null)
  const [saved, setSaved] = useState(0)
  const supported = 'Notification' in window && 'serviceWorker' in navigator
  const [perm, setPerm] = useState(supported ? Notification.permission : 'unsupported')
  const queue = useRef(Promise.resolve())
  useEffect(() => { fetchNotificationPreferences().then(d => setPrefs(d.preferences)).catch(() => {}) }, [])

  const save = (patch) => {
    setPrefs(p => (p ? { ...p, ...patch } : p))
    queue.current = queue.current
      .then(() => updateNotificationPreferences(patch))
      .then(d => { setPrefs(p => ({ ...p, ...d.preferences })); setSaved(s => s + 1) })
      .catch(() => fetchNotificationPreferences().then(d => setPrefs(d.preferences)).catch(() => {}))
  }
  const on = (keys) => !!prefs && keys.some(k => prefs[k] !== false && prefs[k] !== undefined)
  const setAll = (keys, v) => save(Object.fromEntries(keys.map(k => [k, v])))
  const quietOn = prefs?.quiet_start != null && prefs?.quiet_end != null
  const qs = prefs?.quiet_start ?? DEFAULT_QUIET.start
  const qe = prefs?.quiet_end ?? DEFAULT_QUIET.end
  // "Vibes" are called notes on the web.
  const label = (x) => (x === 'vibe' ? t('prefs.notesName') : t(`pref.${x}Label`))
  const sub = (x) => (x === 'vibe' ? t('prefs.notesDesc') : t(`pref.${x}Sub`))

  return (
    <div className="full-page notif-page n6-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{t('settings.title')}</span>
        {saved > 0 && <span key={saved} className="n6-saved">✓ {t('settings.saved')}</span>}
      </div>
      <div className="page-body n6-settings">
        {supported && (
          <div className={`n6-card n6-pushcard${perm !== 'granted' ? ' n6-pushcard--off' : ''}`}>
            <span className="n6-pushcard-text">
              <strong>{perm === 'granted' ? t('settings.pushOn') : t('settings.pushOff')}</strong>
              {perm !== 'granted' && <span className="n6-sub">{t('settings.pushOffSub')}</span>}
            </span>
            {perm === 'default' && (
              <button type="button" className="n6-push-on" onClick={() => registerPush().finally(() => setPerm(Notification.permission))}>{t('settings.turnOn')}</button>
            )}
          </div>
        )}
        {prefs && GROUPS.map(g => {
          const c = categoryColor(g.category)
          const keys = g.toggles.flatMap(x => x.keys)
          return (
            <div key={g.category} className="n6-card">
              <div className="n6-group-head">
                <span className="n6-group-emoji" style={{ background: tint(c.fill, 0.25) }}>{CATEGORY_EMOJI[g.category]}</span>
                <span className="n6-group-title">{t(`inbox.cat.${g.category}`)}</span>
                <Toggle checked={on(keys)} onChange={v => setAll(keys, v)} color={c.fill} label={t(`inbox.cat.${g.category}`)} />
              </div>
              {g.toggles.map(x => (
                <div key={x.label} className="n6-pref">
                  <span className="n6-pref-text"><span className="n6-pref-label">{label(x.label)}</span><span className="n6-sub">{sub(x.label)}</span></span>
                  <Toggle checked={on(x.keys)} onChange={v => setAll(x.keys, v)} color={c.fill} label={label(x.label)} />
                </div>
              ))}
            </div>
          )
        })}
        {prefs && (
          <div className="n6-card">
            <div className="n6-group-head">
              <span className="n6-group-emoji" style={{ background: 'var(--primary-tint)' }}>🌙</span>
              <span className="n6-group-title">
                {t('settings.quiet')}
                <span className="n6-sub">{t('settings.quietSub', { from: hhmm(qs), to: hhmm(qe) })}</span>
              </span>
              <Toggle checked={quietOn} label={t('settings.quiet')}
                      onChange={v => save(v ? { quiet_start: qs, quiet_end: qe } : { quiet_start: null, quiet_end: null })} />
            </div>
            {quietOn && (
              <div className="n6-quiet">
                <button type="button" className="n6-time-chip" onClick={() => save({ quiet_start: (qs + 60) % 1440 })}>{hhmm(qs)}</button>
                <span className="n6-sub">→</span>
                <button type="button" className="n6-time-chip" onClick={() => save({ quiet_end: (qe + 60) % 1440 })}>{hhmm(qe)}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
