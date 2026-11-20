import { useEffect, useState } from 'react'
import i18n from '../i18n'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import Icon from './Icon'
import { reportChatPhoto } from '../api'

const REPORT_REASONS = ['inappropriate', 'person_without_consent', 'dangerous', 'spam', 'other']

/**
 * Shared chat message-interaction UI, used by EVERY web chat surface (city
 * channel, challenge channel, Hi-now topic) so the react / reply / copy / edit /
 * delete affordances never drift apart again. Each surface keeps its own data +
 * WS logic and just renders these presentational pieces, wiring its own handlers.
 *
 * Exports:
 *   <ReactionPills reactions isMine onToggle />       - pills under a message
 *   <ReplyPreview replyingTo onCancel />              - strip above the composer
 *   <MessageActionBubble bubble onClose onReact onReply onEdit onDelete />
 *                                                      - tap-a-bubble action menu
 */

export const REACTION_EMOJIS = ['❤️', '👍', '😂', '😮', '🔥']

// Open Google Translate with the message text, target = the app's current
// language (zh/pt/fil need special-casing; others map 1:1).
function gtTarget(lang) {
  const map = { 'zh-hans': 'zh-CN', 'zh-hant': 'zh-TW', fil: 'tl', 'pt-br': 'pt', 'pt-pt': 'pt' }
  return map[lang] || (lang || 'en').split('-')[0] || 'en'
}
function openGoogleTranslate(text, lang) {
  const url = `https://translate.google.com/?sl=auto&tl=${gtTarget(lang)}&text=${encodeURIComponent(text)}&op=translate`
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function ReactionPills({ reactions, isMine, onToggle }) {
  if (!reactions || reactions.length === 0) return null
  return (
    <div className={`reaction-pills${isMine ? ' mine' : ''}`}>
      {reactions.map(r => (
        <button
          key={r.emoji}
          className={`reaction-pill${r.self ? ' self' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggle(r.emoji) }}
        >
          {r.emoji}{r.count > 1 && <span className="reaction-count">{r.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function ReplyPreview({ replyingTo, onCancel }) {
  const { t } = useTranslation('chat')
  if (!replyingTo) return null
  return (
    <div className="reply-preview">
      <div className="reply-preview-body">
        <span className="reply-preview-name">{replyingTo.nickname}</span>
        <span className="reply-preview-text">
          {replyingTo.type === 'image' ? t('reply.photo', { defaultValue: 'Photo' }) : (replyingTo.content || '-')}
        </span>
      </div>
      <button type="button" className="reply-preview-close" onClick={onCancel} aria-label={i18n.t('a11y.cancelReply', { ns: 'common' })}><Icon name="close" size={16} /></button>
    </div>
  )
}

/**
 * `bubble` = { msg, x, y, isMine } | null. Handlers are optional: a button only
 * renders when its handler is provided (Reply/Edit/Delete). Copy is built in
 * (shown when the message has text). onReact(emoji) is required.
 */
export function MessageActionBubble({ bubble, onClose, onReact, onReply, onEdit, onDelete }) {
  const { t, i18n } = useTranslation('chat')
  // Report a photo: the reasons sheet outlives the bubble (it closes first).
  const [reporting, setReporting] = useState(null)
  const [notice, setNotice] = useState(null)
  if (!bubble) return <ReportPhotoSheet msg={reporting} onClose={() => setReporting(null)} notice={notice} onNotice={setNotice} />
  const msg = bubble.msg
  // Someone else's photo, still there, in a real chat (onReact: not a title menu).
  const reportable = !!onReact && !bubble.isMine && msg.type === 'image' && !!msg.imageUrl && !msg.deletedAt && !!msg.id
  return (
    <div className="action-bubble-overlay" onClick={onClose}>
      <div
        className="action-bubble"
        style={{ top: Math.max(8, bubble.y - 64), left: bubble.isMine ? 'auto' : bubble.x, right: bubble.isMine ? 16 : 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        {onReact && (
        <div className="action-bubble-emojis">
          {REACTION_EMOJIS.map(emoji => {
            const selfReacted = (msg.reactions ?? []).some(r => r.emoji === emoji && r.self)
            return (
              <button
                key={emoji}
                className={`action-bubble-emoji${selfReacted ? ' active' : ''}`}
                onClick={() => { onReact(emoji); onClose() }}
              >{emoji}</button>
            )
          })}
        </div>
        )}
        {onReply && (
          <button className="action-bubble-btn" onClick={() => { onClose(); onReply() }}>
            {t('actionReply', { defaultValue: 'Reply' })}
          </button>
        )}
        {msg.content && (
          <button
            className="action-bubble-btn"
            onClick={() => { navigator.clipboard?.writeText(msg.content).catch(() => {}); onClose() }}
          >
            {t('actionCopy', { defaultValue: 'Copy' })}
          </button>
        )}
        {msg.content && (
          <button
            className="action-bubble-btn"
            onClick={() => { openGoogleTranslate(msg.content, i18n.language); onClose() }}
          >
            {t('actionTranslate', { defaultValue: 'Translate' })}
          </button>
        )}
        {onEdit && (
          <button className="action-bubble-btn" onClick={() => { onClose(); onEdit() }}>
            {t('actionEdit', { defaultValue: 'Edit' })}
          </button>
        )}
        {onDelete && (
          <button className="action-bubble-btn action-bubble-btn--danger" onClick={() => { onClose(); onDelete() }}>
            {t('actionDelete', { defaultValue: 'Delete' })}
          </button>
        )}
        {reportable && (
          <button className="action-bubble-btn action-bubble-btn--danger" onClick={() => { setReporting(msg); onClose() }}>
            {t('actionReport', { defaultValue: 'Report photo' })}
          </button>
        )}
      </div>
    </div>
  )
}

/** The reasons for reporting a chat photo (the Daily photo sheet's look and words), then a short notice. */
function ReportPhotoSheet({ msg, onClose, notice, onNotice }) {
  const { t } = useTranslation('challenge', { keyPrefix: 'dc' })
  useEffect(() => {
    if (!notice) return undefined
    const id = setTimeout(() => onNotice(null), 3000)
    return () => clearTimeout(id)
  }, [notice, onNotice])
  if (!msg && !notice) return null
  if (!msg) return createPortal(<p className="dc-viewer-notice dc-photos-notice" role="status">{notice}</p>, document.body)
  const report = async (reason) => {
    onClose()
    try {
      await reportChatPhoto(msg.id, reason)
      onNotice(t('report.thanks'))
    } catch (err) {
      onNotice(err.status === 409 ? t('report.already') : t('vote.errors.generic'))
    }
  }
  return createPortal(
    <div className="v3-sheet-wrap" role="dialog" aria-modal="true" aria-label={t('report.title')}>
      <button type="button" className="v3-sheet-scrim" onClick={onClose} aria-label={t('cancel')} />
      <div className="v3-sheet">
        <span className="v3-sheet-grabber" aria-hidden="true" />
        <p className="v3-sheet-title">{t('report.title')}</p>
        <p className="dc-muted">{t('report.body')}</p>
        {REPORT_REASONS.map(r => (
          <button key={r} type="button" className="v3-scope-row" onClick={() => report(r)}>
            <span className="v3-scope-row-body"><span className="v3-scope-row-title">{t(`report.reasons.${r}`)}</span></span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  )
}

/**
 * A title / label that opens a Copy + Translate menu on click. Reuses
 * MessageActionBubble without onReact (so no emoji strip / reply / edit / delete)
 * - only Copy + Translate render. Used for the Hi now / Hi plan / Challenge
 * detail titles so they can be copied or sent to Google Translate.
 */
export function CopyTranslateText({ value, className, as: Tag = 'span' }) {
  const [bubble, setBubble] = useState(null)
  if (!value) return null
  return (
    <>
      <Tag
        className={className}
        style={{ cursor: 'pointer' }}
        role="button"
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setBubble({ msg: { content: value }, x: e.clientX, y: e.clientY, isMine: false }) }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setBubble({ msg: { content: value }, x: 24, y: 96, isMine: false }) } }}
      >
        {value}
      </Tag>
      <MessageActionBubble bubble={bubble} onClose={() => setBubble(null)} />
    </>
  )
}
