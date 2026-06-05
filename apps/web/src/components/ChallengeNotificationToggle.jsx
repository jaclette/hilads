import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  fetchMyChallengeParticipation,
  setChallengeNotificationPreference,
} from '../api'

/**
 * Compact "Notifications on/off" pill for the challenge channel. Visible
 * to any channel participant; persists per-(challenge, user) on the
 * backend. The route layer still accepts 'milestones' | 'all' | 'off';
 * the toggle here just maps the binary on/off to 'milestones' | 'off'
 * so the UI stays simple. 'all' (every message) is reachable from a
 * future advanced settings if we ever need it.
 */
export default function ChallengeNotificationToggle({ challengeId, currentUserId }) {
  const { t } = useTranslation('challenge')

  const [pref, setPref] = useState(null) // null = loading, then 'milestones'|'all'|'off'
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!challengeId || !currentUserId) return
    const res = await fetchMyChallengeParticipation(challengeId)
    setPref(res?.notificationPreference ?? 'milestones')
  }, [challengeId, currentUserId])

  useEffect(() => { load() }, [load])

  if (!currentUserId || pref === null) return null

  const isOn = pref !== 'off'

  async function handleToggle() {
    if (busy) return
    const next = isOn ? 'off' : 'milestones'
    setBusy(true)
    const previous = pref
    setPref(next) // optimistic
    try {
      await setChallengeNotificationPreference(challengeId, next)
    } catch {
      setPref(previous)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      className={`challenge-notif-toggle ${isOn ? 'challenge-notif-toggle--on' : ''}`}
      onClick={handleToggle}
      disabled={busy}
      aria-pressed={isOn}
    >
      <span className="challenge-notif-toggle-icon" aria-hidden="true">{isOn ? '🔔' : '🔕'}</span>
      <span className="challenge-notif-toggle-label">
        {t(isOn ? 'notif.on' : 'notif.off')}
      </span>
    </button>
  )
}
