import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchGroupSubmissions, pickWinner } from '../api'
import { avatarColors } from '../lib/avatarColors'

/**
 * GroupSubmissionsGallery (web) - a single CTA that opens a modal listing every
 * photo submitted to a GROUP photo-proof contest (with who submitted each). The
 * challenger picks the winner from the modal; the winning tile is crowned for
 * everyone. Click a photo for a fullscreen preview.
 *
 * One CTA + modal (not an inline grid) so the chat page stays compact and the
 * submitter names never get clipped by the surrounding layout.
 */
export default function GroupSubmissionsGallery({ challengeId, isChallenger, isValidated, refreshKey, onChanged }) {
  const { t } = useTranslation('challenge')
  const [subs, setSubs]       = useState([])
  const [winnerId, setWinner] = useState(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen]       = useState(false)
  const [picking, setPicking] = useState(null)
  const [preview, setPreview] = useState(null)

  const load = useCallback(async () => {
    try {
      const r = await fetchGroupSubmissions(challengeId)
      setSubs(r.submissions || [])
      setWinner(r.winnerUserId || null)
    } catch {
      /* soft-fail */
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
    <>
      {/* Single CTA - opens the gallery modal. */}
      <button type="button" className="gsg-cta" onClick={() => setOpen(true)}>
        <span className="gsg-cta-thumbs">
          {subs.slice(0, 3).map((s) => (
            <img key={s.id} src={s.media_url} alt="" className="gsg-cta-thumb" loading="lazy" />
          ))}
        </span>
        <span className="gsg-cta-label">
          📸 {t('group.submissionsHeader', { count: subs.length, defaultValue: '{{count}} photos' })}
          {winnerId ? '' : canPick ? `  ·  ${t('group.tapToPick', { defaultValue: 'pick the best one' })}` : ''}
        </span>
        <span className="gsg-cta-chev" aria-hidden>›</span>
      </button>

      {open && (
        <div className="gsg-modal-backdrop" onClick={() => setOpen(false)}>
          <div className="gsg-modal" onClick={(e) => e.stopPropagation()}>
            <div className="gsg-modal-head">
              <span className="gsg-modal-title">
                📸 {t('group.submissionsHeader', { count: subs.length, defaultValue: '{{count}} photos' })}
              </span>
              <button type="button" className="gsg-modal-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>
            {canPick && <p className="gsg-modal-hint">{t('group.winnerSub', { defaultValue: 'Choose the best photo. The winner earns the big reward.' })}</p>}

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
          </div>
        </div>
      )}

      {preview && (
        <div className="gsg-preview-backdrop" onClick={() => setPreview(null)}>
          <img className="gsg-preview-img" src={preview.media_url} alt="" onClick={(e) => e.stopPropagation()} />
          <div className="gsg-preview-name">{preview.display_name}</div>
          {canPick && (
            <button type="button" className="gsg-preview-pick" onClick={(e) => { e.stopPropagation(); handlePick(preview) }}>
              👑 {t('group.pickThis', { defaultValue: 'Pick winner' })}
            </button>
          )}
        </div>
      )}
    </>
  )
}
