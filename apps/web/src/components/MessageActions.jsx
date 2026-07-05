import { useState } from 'react'
import { useTranslation } from 'react-i18next'

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
          {replyingTo.type === 'image' ? t('reply.photo', { defaultValue: '📷 Photo' }) : (replyingTo.content || '-')}
        </span>
      </div>
      <button type="button" className="reply-preview-close" onClick={onCancel} aria-label="Cancel reply">✕</button>
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
  if (!bubble) return null
  const msg = bubble.msg
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
            {t('actionReply', { defaultValue: '↩ Reply' })}
          </button>
        )}
        {msg.content && (
          <button
            className="action-bubble-btn"
            onClick={() => { navigator.clipboard?.writeText(msg.content).catch(() => {}); onClose() }}
          >
            {t('actionCopy', { defaultValue: '📋 Copy' })}
          </button>
        )}
        {msg.content && (
          <button
            className="action-bubble-btn"
            onClick={() => { openGoogleTranslate(msg.content, i18n.language); onClose() }}
          >
            {t('actionTranslate', { defaultValue: '🌐 Translate' })}
          </button>
        )}
        {onEdit && (
          <button className="action-bubble-btn" onClick={() => { onClose(); onEdit() }}>
            {t('actionEdit', { defaultValue: '✏️ Edit' })}
          </button>
        )}
        {onDelete && (
          <button className="action-bubble-btn action-bubble-btn--danger" onClick={() => { onClose(); onDelete() }}>
            {t('actionDelete', { defaultValue: '🗑 Delete' })}
          </button>
        )}
      </div>
    </div>
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
