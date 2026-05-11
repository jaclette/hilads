import IconPlus from './IconPlus'
import EmojiPicker from './EmojiPicker'
import SendButton from './SendButton'

/**
 * Shared chat-message composer — used by DM, City channel, Event chat, Topic.
 *
 * Sizing is unified at the DM dimensions (compact 44px attach button, 36px
 * emoji, single-line input, 54px send). All surface-specific differences
 * (placeholder, autofocus, whether the emoji button renders) come through as
 * props — never style overrides.
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
}) {
  const attachDisabled = uploading || sending || spotLoading
  const sendDisabled   = sending || uploading || spotLoading || !value.trim()

  return (
    <form className="dm-composer" onSubmit={onSubmit}>
      {/* Hidden file picker — triggered by share sheet */}
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
        aria-label="Add attachment"
        title="Add attachment"
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
            title="Emoji"
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
        ref={inputRef}
        className="dm-input"
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        maxLength={maxLength}
        autoFocus={autoFocus}
      />

      <SendButton disabled={sendDisabled} />
    </form>
  )
}
