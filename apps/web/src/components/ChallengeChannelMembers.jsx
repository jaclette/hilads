import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchChannelParticipants, kickChallengeParticipant } from '../api'

/**
 * Publicly visible list of channel members — people who clicked "Join this
 * challenge". The creator + active taker are not in this list (they have
 * their own surfaces above on the page). Kick buttons render only for the
 * creator and the active taker.
 *
 * The list is intentionally not paginated client-side — the server caps
 * at 100. If that ever becomes a real bound we'll add a "See all" path.
 */
export default function ChallengeChannelMembers({
  challengeId,
  currentUserId,
  isCreator,       // true → can kick
  isActiveTaker,   // true → can kick
  onMembersChanged,// () → caller refreshes count etc.
}) {
  const { t } = useTranslation('challenge')

  const [members, setMembers] = useState([])
  const [count,   setCount]   = useState(0)
  const [busyId,  setBusyId]  = useState(null)
  const [error,   setError]   = useState(null)

  const canKick = isCreator || isActiveTaker

  const load = useCallback(async () => {
    if (!challengeId) return
    const res = await fetchChannelParticipants(challengeId)
    setMembers(res?.members ?? [])
    setCount(res?.count ?? 0)
  }, [challengeId])

  useEffect(() => { load() }, [load])

  async function handleKick(memberId) {
    if (busyId) return
    setBusyId(memberId)
    setError(null)
    try {
      await kickChallengeParticipant(challengeId, memberId)
      // Optimistic local removal, then refresh server-side count so
      // out-of-band changes (e.g. someone else leaving) reconcile.
      setMembers(prev => prev.filter(m => m.id !== memberId))
      setCount(c => Math.max(0, c - 1))
      onMembersChanged?.()
    } catch (err) {
      setError(err?.message || t('members.errKick'))
    } finally {
      setBusyId(null)
    }
  }

  if (count === 0) {
    return (
      <section className="challenge-members">
        <h3 className="challenge-members-title">{t('members.title')}</h3>
        <p className="challenge-members-empty">{t('members.empty')}</p>
      </section>
    )
  }

  return (
    <section className="challenge-members">
      <h3 className="challenge-members-title">
        {t('members.title')} · {count}
      </h3>
      <ul className="challenge-members-list">
        {members.map(m => {
          const showKick = canKick && m.id !== currentUserId
          return (
            <li key={m.id} className="challenge-member">
              {m.thumbAvatarUrl ? (
                <img
                  src={m.thumbAvatarUrl}
                  alt=""
                  className="challenge-member-avatar"
                  width={36}
                  height={36}
                />
              ) : (
                <div className="challenge-member-avatar challenge-member-avatar--blank" aria-hidden="true" />
              )}
              <span className="challenge-member-name">{m.displayName ?? m.username ?? '—'}</span>
              {showKick && (
                <button
                  type="button"
                  className="challenge-member-kick"
                  onClick={() => handleKick(m.id)}
                  disabled={busyId === m.id}
                  aria-label={t('members.kickAria', { name: m.displayName ?? '' })}
                >
                  {busyId === m.id ? '…' : t('members.kickCta')}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {error && <p className="challenge-members-error" role="alert">{error}</p>}
    </section>
  )
}
