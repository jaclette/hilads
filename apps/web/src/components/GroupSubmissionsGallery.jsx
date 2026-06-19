import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchGroupSubmissions, pickWinner } from '../api'
import { avatarColors } from '../lib/avatarColors'

/**
 * GroupSubmissionsGallery (web) - the in-channel photo wall for a GROUP
 * photo-proof contest. Web mirror of the native GroupSubmissionsGallery:
 * everyone who can see the challenge sees every submitter's photo + who they
 * are; the challenger gets an inline "Pick winner" on each tile until a winner
 * is set, after which the winning tile is crowned for all viewers. Click any
 * photo for a fullscreen preview.
 *
 * Re-fetches when `refreshKey` changes (a new submission / winner landing over
 * WS bumps it from the parent ChallengeChatPage).
 */
export default function GroupSubmissionsGallery({ challengeId, isChallenger, isValidated, refreshKey, onChanged }) {
  const { t } = useTranslation('challenge')
  const [subs, setSubs]       = useState([])
  const [winnerId, setWinner] = useState(null)
  const [loading, setLoading] = useState(true)
  const [picking, setPicking] = useState(null)
  const [preview, setPreview] = useState(null)

  const load = useCallback(async () => {
    try {
      const r = await fetchGroupSubmissions(challengeId)
      setSubs(r.submissions || [])
      setWinner(r.winnerUserId || null)
    } catch {
      /* soft-fail - keep last-known */
    } finally {
      setLoading(false)
    }
  }, [challengeId])

  useEffect(() => { load() }, [load, refreshKey])

  const handlePick = useCallback(async (s) => {
    if (picking) return
    if (!window.confirm(t('group.winnerConfirmBody', { name: s.display_name, defaultValue: `${s.display_name} wins the big reward.` }))) return
    setPicking(s.user_id)
    try {
      await pickWinner(challengeId, s.user_id)
      setPreview(null)
      await load()
      onChanged?.()
    } catch (e) {
      const msg = e?.code === 'no_submission'
        ? t('group.winnerNoSubmission', { defaultValue: "That person hasn't submitted a photo." })
        : t('group.winnerFailed', { defaultValue: 'Could not pick the winner — try again.' })
      window.alert(msg)
    } finally {
      setPicking(null)
    }
  }, [challengeId, picking, load, onChanged, t])

  if (loading || subs.length === 0) return null

  const canPick = isChallenger && !winnerId && !isValidated

  return (
    <div className="gsg-wrap">
      <div className="gsg-header">
        📸 {t('group.submissionsHeader', { count: subs.length, defaultValue: '{{count}} photos' })}
        {canPick ? `  ·  ${t('group.tapToPick', { defaultValue: 'pick the best one' })}` : ''}
      </div>

      <div className="gsg-grid">
        {subs.map((s) => {
          const isWin = winnerId === s.user_id
          const [c1, c2] = avatarColors(s.user_id)
          return (
            <div key={s.id} className={`gsg-tile${isWin ? ' gsg-tile--win' : ''}`}>
              <button type="button" className="gsg-photo-btn" onClick={() => setPreview(s)}>
                <img className="gsg-photo" src={s.media_url} alt="" loading="lazy" />
                {isWin && <span className="gsg-win-badge">👑 {t('group.winnerTag', { defaultValue: 'Winner' })}</span>}
                {picking === s.user_id && <span className="gsg-picking">…</span>}
              </button>
              <div className="gsg-footer">
                <span className="gsg-avatar" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                  {s.avatar_url ? <img src={s.avatar_url} alt="" /> : (s.display_name?.[0] ?? '?').toUpperCase()}
                </span>
                <span className="gsg-name">{s.display_name}</span>
              </div>
              {canPick && (
                <button type="button" className="gsg-pick-btn" disabled={!!picking} onClick={() => handlePick(s)}>
                  👑 {t('group.pickThis', { defaultValue: 'Pick winner' })}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {preview && (
        <div className="gsg-preview-backdrop" onClick={() => setPreview(null)}>
          <img className="gsg-preview-img" src={preview.media_url} alt="" onClick={(e) => e.stopPropagation()} />
          <div className="gsg-preview-name">{preview.display_name}</div>
          {canPick && (
            <button
              type="button"
              className="gsg-preview-pick"
              onClick={(e) => { e.stopPropagation(); handlePick(preview) }}
            >
              👑 {t('group.pickThis', { defaultValue: 'Pick winner' })}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
