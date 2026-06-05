import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchChannelParticipants, kickChallengeParticipant } from '../api'
import AttendeeAvatars from './AttendeeAvatars'

/**
 * Compact "who's in" bar + full-list modal, matching the topic/event member
 * strip pattern. Renders inline above the chat surface; tap opens a modal
 * with role labels (Challenger / Taker / Participant) and kick buttons.
 *
 * Public per spec — the list itself is visible to anyone with channel
 * access. Kick buttons surface only for the creator and the active taker.
 *
 * Props:
 *   challenge      — full challenge row (for created_by + creator display)
 *   activeTaker    — the single active-taker user row, or null. Drives the
 *                    Taker badge in the modal + tells us whose kick auth
 *                    matches the caller.
 *   currentUserId  — caller's user id (null = anon, which means no kicks)
 *   onMembersChanged — () after a kick so the parent refreshes counts
 */
export default function ChallengeChannelMembers({
  challenge,
  activeTaker,
  currentUserId,
  onMembersChanged,
}) {
  const { t } = useTranslation('challenge')

  const [members, setMembers] = useState([])
  const [count,   setCount]   = useState(0)
  const [open,    setOpen]    = useState(false)
  const [busyId,  setBusyId]  = useState(null)
  const [error,   setError]   = useState(null)

  const creatorUserId = challenge?.created_by ?? null
  const takerUserId   = activeTaker?.id ?? null
  const isCreator     = currentUserId !== null && currentUserId === creatorUserId
  const isActiveTaker = currentUserId !== null && currentUserId === takerUserId
  const canKick       = isCreator || isActiveTaker

  const load = useCallback(async () => {
    if (!challenge?.id) return
    const res = await fetchChannelParticipants(challenge.id)
    setMembers(res?.members ?? [])
    setCount(res?.count ?? 0)
  }, [challenge?.id])

  useEffect(() => { load() }, [load])

  async function handleKick(memberId) {
    if (busyId) return
    setBusyId(memberId)
    setError(null)
    try {
      await kickChallengeParticipant(challenge.id, memberId)
      setMembers(prev => prev.filter(m => m.id !== memberId))
      setCount(c => Math.max(0, c - 1))
      onMembersChanged?.()
    } catch (err) {
      setError(err?.message || t('members.errKick'))
    } finally {
      setBusyId(null)
    }
  }

  // Compose the modal's full list with role-aware labels. Challenger and
  // Taker rows are derived from the challenge + acceptance — they're NOT
  // in the channel-participants list (they have their own surfaces above),
  // so we synthesize them at the head.
  const rows = []
  if (creatorUserId) {
    const fromMembers = members.find(m => m.id === creatorUserId)
    rows.push({
      id:             creatorUserId,
      displayName:    fromMembers?.displayName ?? challenge?.creator_display_name ?? '—',
      thumbAvatarUrl: fromMembers?.thumbAvatarUrl ?? challenge?.creator_thumb_avatar_url ?? null,
      role:           'challenger',
    })
  }
  if (takerUserId && takerUserId !== creatorUserId) {
    const fromMembers = members.find(m => m.id === takerUserId)
    rows.push({
      id:             takerUserId,
      displayName:    fromMembers?.displayName ?? activeTaker?.displayName ?? '—',
      thumbAvatarUrl: fromMembers?.thumbAvatarUrl ?? activeTaker?.thumbAvatarUrl ?? activeTaker?.avatarUrl ?? null,
      role:           'taker',
    })
  }
  for (const m of members) {
    if (m.id === creatorUserId || m.id === takerUserId) continue
    rows.push({ ...m, role: 'participant' })
  }

  // Bar preview avatars — first 5 in role order (challenger, taker, then
  // joined order). Matches the topic-members-strip shape.
  const previewAvatars = rows.slice(0, 5).map(r => ({
    id:             r.id,
    displayName:    r.displayName,
    thumbAvatarUrl: r.thumbAvatarUrl,
  }))

  return (
    <>
      <button
        type="button"
        className="topic-members-strip challenge-members-strip"
        onClick={() => setOpen(true)}
      >
        <AttendeeAvatars preview={previewAvatars} total={rows.length} />
        <span className="topic-members-label">
          {t('members.countIn', { count: rows.length })}
        </span>
        <span className="topic-members-see">{t('members.seeAll')}</span>
      </button>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal-panel going-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">👥 {t('members.countIn', { count: rows.length })}</span>
              <button className="going-modal-close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="going-modal-body">
              {rows.map(r => {
                const showKick = canKick && r.role !== 'challenger' && r.id !== currentUserId
                return (
                  <div key={r.id} className="people-drawer-row">
                    {r.thumbAvatarUrl ? (
                      <img src={r.thumbAvatarUrl} className="online-avatar" alt="" />
                    ) : (
                      <span className="online-avatar online-avatar--blank" aria-hidden="true">
                        {(r.displayName ?? '?')[0].toUpperCase()}
                      </span>
                    )}
                    <div className="people-drawer-content">
                      <span className="people-drawer-name">{r.displayName}</span>
                      {r.role !== 'participant' && (
                        <span className={`challenge-role-badge challenge-role-badge--${r.role === 'challenger' ? 'challenger' : 'taker'}`}>
                          {t(`badge.${r.role === 'challenger' ? 'challenger' : 'taker'}`)}
                        </span>
                      )}
                    </div>
                    {showKick && (
                      <button
                        type="button"
                        className="challenge-member-kick"
                        onClick={() => handleKick(r.id)}
                        disabled={busyId === r.id}
                        aria-label={t('members.kickAria', { name: r.displayName })}
                      >
                        {busyId === r.id ? '…' : t('members.kickCta')}
                      </button>
                    )}
                  </div>
                )
              })}
              {rows.length === 0 && (
                <p className="going-modal-empty">{t('members.empty')}</p>
              )}
              {error && <p className="challenge-members-error" role="alert">{error}</p>}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
