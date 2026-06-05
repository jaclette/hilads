import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  fetchChallengeComments,
  postChallengeComment,
  deleteMyChallengeComment,
  hideChallengeComment,
} from '../api'

/**
 * Spectator-lane comments. Lives on PUBLIC challenges only; on friends/
 * private rows the server returns disabled=true and we surface a tiny
 * "comments off" note instead of the input.
 *
 * Distinct from the 1:1 private thread (creator + acceptor) that already
 * runs in the existing chat block. This is the public commentary surface.
 */
export default function ChallengeCommentsLane({
  challengeId,
  visibility,        // 'public' | 'friends' | 'private'
  currentUserId,     // null = anon (read-only, prompts sign-in to post)
  isOwner,           // true → can soft-hide comments
  onNeedAuth,        // ()  → opens the auth gate
}) {
  const { t } = useTranslation('challenge')

  const [comments, setComments]     = useState([])
  const [disabled, setDisabled]     = useState(false)
  const [draft,    setDraft]        = useState('')
  const [sending,  setSending]      = useState(false)
  const [error,    setError]        = useState(null)

  const load = useCallback(async () => {
    if (!challengeId) return
    const data = await fetchChallengeComments(challengeId, { limit: 50 })
    setComments(data?.comments ?? [])
    setDisabled(!!data?.disabled)
  }, [challengeId])

  useEffect(() => { load() }, [load])

  // Server-side gating drives the truth, but the visibility prop lets us
  // render the "off" surface immediately on a freshly-flipped row without
  // waiting for the next load() to complete.
  const isOff = disabled || (visibility !== 'public')

  async function handleSubmit(e) {
    e.preventDefault()
    if (sending) return
    if (!currentUserId) { onNeedAuth?.('comment_challenge'); return }
    const text = draft.trim()
    if (!text) return
    setSending(true)
    setError(null)
    try {
      const created = await postChallengeComment(challengeId, text)
      // Optimistic prepend — server returns newest first, so the just-
      // created row sits at the head; matches the order load() returns.
      setComments(prev => [created, ...prev])
      setDraft('')
    } catch (err) {
      if (err?.code === 'moderation_blocked') {
        setError(t('visibility.moderationBlocked'))
      } else if (err?.code === 'comments_disabled') {
        setDisabled(true)
        setError(null)
      } else {
        setError(err?.message || t('errStart'))
      }
    } finally {
      setSending(false)
    }
  }

  async function handleDelete(commentId) {
    try {
      await deleteMyChallengeComment(challengeId, commentId)
      setComments(prev => prev.filter(c => c.id !== commentId))
    } catch (err) {
      setError(err?.message || t('errSave'))
    }
  }

  async function handleHide(commentId) {
    try {
      await hideChallengeComment(challengeId, commentId)
      setComments(prev => prev.map(c => c.id === commentId ? { ...c, is_hidden: true } : c))
    } catch (err) {
      setError(err?.message || t('errSave'))
    }
  }

  return (
    <section className="challenge-comments">
      <h3 className="challenge-comments-title">{t('comments.title')}</h3>
      <p className="challenge-comments-subtitle">{t('comments.subtitle')}</p>

      {/* OFF state — the surface still renders so spectators know the
          discussion exists; the input + list are replaced by a single
          inline note explaining why. */}
      {isOff ? (
        <p className="challenge-comments-off">
          {visibility === 'private'
            ? t('comments.disabledPrivate')
            : t('comments.disabledFriends')}
        </p>
      ) : (
        <>
          <form className="challenge-comments-form" onSubmit={handleSubmit}>
            <input
              type="text"
              className="challenge-comments-input"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder={t('comments.placeholder')}
              maxLength={500}
              disabled={sending}
            />
            <button
              type="submit"
              className="challenge-comments-send"
              disabled={sending || !draft.trim()}
            >
              {sending ? '…' : t('comments.sendCta')}
            </button>
          </form>
          {!currentUserId && (
            <p className="challenge-comments-signin">{t('comments.loginToComment')}</p>
          )}
          {error && <p className="challenge-comments-error" role="alert">{error}</p>}

          {comments.length === 0 ? (
            <p className="challenge-comments-empty">{t('comments.empty')}</p>
          ) : (
            <ul className="challenge-comments-list">
              {comments.map(c => (
                <li key={c.id} className={`challenge-comment ${c.is_hidden ? 'challenge-comment--hidden' : ''}`}>
                  {c.user?.thumbAvatarUrl ? (
                    <img
                      src={c.user.thumbAvatarUrl}
                      alt=""
                      className="challenge-comment-avatar"
                      width={32}
                      height={32}
                    />
                  ) : (
                    <div className="challenge-comment-avatar challenge-comment-avatar--blank" aria-hidden="true" />
                  )}
                  <div className="challenge-comment-body">
                    <p className="challenge-comment-author">{c.user?.displayName ?? '—'}</p>
                    <p className="challenge-comment-text">
                      {c.is_hidden ? <em>{t('comments.hidden')}</em> : c.body}
                    </p>
                  </div>
                  <div className="challenge-comment-actions">
                    {currentUserId && currentUserId === c.user_id && !c.is_hidden && (
                      <button
                        type="button"
                        className="challenge-comment-btn"
                        onClick={() => handleDelete(c.id)}
                      >
                        {t('comments.deleteCta')}
                      </button>
                    )}
                    {isOwner && !c.is_hidden && c.user_id !== currentUserId && (
                      <button
                        type="button"
                        className="challenge-comment-btn"
                        onClick={() => handleHide(c.id)}
                      >
                        {t('comments.hideCta')}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
