import { thumbUrl } from '../lib/imageThumb'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import IconPlus from './IconPlus'
import EmojiPicker from './EmojiPicker'
import SendButton from './SendButton'

/**
 * Shared chat-message composer - used by DM, City channel, Event chat, Topic.
 *
 * Sizing is unified at the DM dimensions (compact 44px attach button, 36px
 * emoji, single-line input, 54px send). All surface-specific differences
 * (placeholder, autofocus, whether the emoji button renders) come through as
 * props - never style overrides.
 *
 * The reply-preview banner (when the user is replying to a message) is owned
 * by the host screen and rendered ABOVE the composer, since DM/event/city
 * each have slightly different banner markup tied to their own data shape.
 */
export default function MessageComposer({
  inputRef,
  fileInputRef,
  value,
  onChange,
  onSubmit,
  onFileSelect,
  onShareClick,
  showEmojiButton = true,
  showEmoji = false,
  onEmojiToggle,
  onEmojiSelect,
  onEmojiClose,
  placeholder = '',
  uploading = false,
  sending = false,
  spotLoading = false,
  autoFocus = false,
  maxLength = 1000,
  mentionSuggestions = [],
  onMentionSelect,
  // Forwarded to the underlying input. Used by parents that want to collapse
  // a header block when the composer is focused (keyboard opening).
  onFocus,
  // Mirror of onFocus - fires on blur. Parents wire it to restore a
  // collapsed header when the composer loses focus.
  onBlur,
  // When true, the input blurs after a successful submit. Used by the
  // challenge thread chat so the header re-expands once the message is sent.
  dismissOnSend = false,
}) {
  const { t } = useTranslation('common')
  const attachDisabled = uploading || sending || spotLoading
  const sendDisabled   = sending || uploading || spotLoading || !value.trim()

  // Wrap the parent's onSubmit so we can drop focus after sending. The input's
  // onBlur then fires and the parent restores its collapsed header. Opt-in via
  // dismissOnSend so chats that want the keyboard up (city / event) are
  // unaffected.
  const localInputRef = useRef(null)
  const innerInputRef = inputRef ?? localInputRef
  const handleSubmit = (e) => {
    onSubmit?.(e)
    if (dismissOnSend) {
      // Defer to next tick so the parent's send handler runs first and we
      // don't fight any pending re-renders that might re-focus the input.
      setTimeout(() => innerInputRef.current?.blur(), 0)
    }
  }

  return (
    <form className="dm-composer" onSubmit={handleSubmit}>
      {/* @mention autocomplete - floats above the composer while typing "@" */}
      {mentionSuggestions.length > 0 && (
        <div className="mention-dropdown">
          {mentionSuggestions.map(s => (
            <button
              key={s.userId ?? s.guestId ?? s.username}
              type="button"
              className="mention-option"
              onMouseDown={e => { e.preventDefault(); onMentionSelect?.(s) }}
            >
              {s.isHere
                ? <span className="mention-option-avatar mention-option-avatar--initial">📢</span>
                : s.avatarUrl
                  ? <img className="mention-option-avatar" src={thumbUrl(s.thumbAvatarUrl ?? s.avatarUrl)} alt="" />
                  : <span className="mention-option-avatar mention-option-avatar--initial">{s.isGuest ? '👻' : (s.displayName ?? '?')[0].toUpperCase()}</span>}
              <span className="mention-option-handle">@{s.username}</span>
              <span className="mention-option-name">{s.isHere ? s.displayName : s.isGuest ? '👻 Guest · online' : s.displayName}</span>
            </button>
          ))}
        </div>
      )}
      {/* Hidden file picker - triggered by share sheet */}
      {fileInputRef && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={onFileSelect}
        />
      )}

      <button
        type="button"
        className="dm-vibe-btn"
        aria-label={t('composer.attach')}
        title={t('composer.attach')}
        disabled={attachDisabled}
        onClick={onShareClick}
      >
        {uploading || spotLoading
          ? <span className="upload-spinner" style={{ width: 16, height: 16 }} />
          : <IconPlus size={18} />}
      </button>

      {showEmojiButton && (
        <div className="emoji-picker-wrap">
          <button
            type="button"
            className={`emoji-trigger${showEmoji ? ' emoji-trigger--active' : ''}`}
            title={t('composer.emoji')}
            onClick={onEmojiToggle}
          >
            😊
          </button>
          {showEmoji && (
            <EmojiPicker onSelect={onEmojiSelect} onClose={onEmojiClose} />
          )}
        </div>
      )}

      <input
        ref={innerInputRef}
        className="dm-input"
        type="text"
        value={value}
        onChange={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        maxLength={maxLength}
        autoFocus={autoFocus}
      />

      <SendButton disabled={sendDisabled} />
    </form>
  )
}
