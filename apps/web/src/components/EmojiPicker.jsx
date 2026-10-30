import { useEffect, useRef } from 'react'
import i18n from '../i18n'

// ~120 frequently-used emojis - no library required, plain Unicode
const EMOJIS = [
  // Smileys
  '😀','😂','🥹','😊','😍','🤩','😎','🥳','🤔','😅','😭','🥺','😤','🤣','😏','🙄',
  '😴','😬','🤯','🤗','😇','🙃','😋','😜','🫡',
  // Gestures
  '👍','👎','👋','🙏','💪','🤙','👌','✌️','🤞','🫶','👏','🤌','💅','🙌','🫠',
  // Hearts
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','❤️‍🔥','💕','💞',
  // Symbols
  '💯','✨','🎉','🔥','⚡','🌈','💫','⭐','🌟','🎊','🏆','🎯','🎲','💡','🚀',
  // Food & drink
  '🍺','🥂','🍹','🍻','☕','🍕','🍔','🍦','🎂','🥐','🌮','🍿',
  // Nature
  '🌍','🌙','🌸','🌺','🌴','🍀','🦋','🌅','🏖️','🌃',
  // Misc
  '👀','💀','🙈','🐱','🐶','🦊','🐼','🦁','🦄','🎭',
]

export default function EmojiPicker({ onSelect, onClose }) {
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    function handle(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [onClose])

  return (
    <div className="emoji-picker" ref={ref} role="dialog" aria-label={i18n.t('a11y.emojiPicker', { ns: 'common' })}>
      {EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="emoji-pick-btn"
          onClick={() => onSelect(emoji)}
          aria-label={emoji}
        >
          {emoji}
        </button>
      ))}
    </div>
  )
}
