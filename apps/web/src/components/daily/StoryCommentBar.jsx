import { useEffect, useRef, useState } from 'react'
import { fetchPhotoMentionSuggestions } from '../../api'
import { track } from '../../lib/analytics'
import { thumbUrl } from '../../lib/imageThumb'
import Icon from '../Icon'
import { useDaily, useDc } from './dailyShared'
import { sendComment } from './comments'
import { COMMENT_MAX } from './PhotoCommentsSheet'

const QUICK = ['🔥', '😍', '😂']

/**
 * How far the on-screen keyboard covers the page's bottom (phones: the visual viewport shrinks
 * when it opens, ABC ↔ emoji included); 0 on a desktop or with it closed.
 */
function useKeyboardInset() {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return undefined
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)))
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update) }
  }, [])
  return inset
}

/**
 * The photo viewers' inline comment bar (as the app, like a Story's "Send message"): a
 * translucent pill "Add a comment…" and three quick reactions. Focused, the story pauses and
 * the photo dims (`onComposing`), the bar rides above the phone's keyboard, "@" suggests who to
 * mention (the photo's author and commenters first). Send posts to the photo's thread (the
 * comments sheet's API), "✓ Sent", the count goes up; a reaction posts that emoji at once,
 * floating up. Guests get the sign-up sheet.
 */
export default function StoryCommentBar({ proof, onComposing }) {
  const { t } = useDc()
  const { account, needAccount } = useDaily()
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [notice, setNotice] = useState(null)
  const [floats, setFloats] = useState([])
  const [mention, setMention] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const input = useRef(null)
  const seq = useRef(0)
  const timer = useRef(null)
  const keyboard = useKeyboardInset()

  useEffect(() => { onComposing?.(focused) }, [focused]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setText(''); setMention(null) }, [proof.id])
  useEffect(() => () => { clearTimeout(timer.current); onComposing?.(false) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!mention || !account) { setSuggestions([]); return undefined }
    let live = true
    const id = setTimeout(() => fetchPhotoMentionSuggestions(proof.id, mention.query).then(s => { if (live) setSuggestions(s) }), 250)
    return () => { live = false; clearTimeout(id) }
  }, [mention, proof.id, account])

  const say = (msg) => { clearTimeout(timer.current); setNotice(msg); timer.current = setTimeout(() => setNotice(null), 1800) }
  const gate = () => { if (account) return false; input.current?.blur(); needAccount('daily_comment'); return true }
  const post = async (body, source) => {
    if (!account) return
    const err = await sendComment(proof.id, body, account, null, !!proof.isMine)
    track('photo_comment_inline', { source, ok: err === null, platform_surface: 'web' })
    if (err === null) { if (source === 'bar') say(`✓ ${t('comments.sent')}`) }
    else if (err === 'moderation_blocked' || err === 'invalid_body' || err === 'rate_limited') { if (source === 'bar') setText(body); say(t(`comments.errors.${err}`)) }
    else if (err === 'signup_required') gate()
    else say(t('comments.failed'))
  }
  const send = (e) => {
    e?.preventDefault()
    const body = text.trim()
    if (!body || gate()) return
    setText(''); setMention(null)
    input.current?.blur()
    post(body, 'bar')
  }
  const react = (emoji, i) => {
    if (gate()) return
    navigator.vibrate?.(12)
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      const id = ++seq.current
      setFloats(f => [...f, { id, emoji, i }])
      setTimeout(() => setFloats(f => f.filter(x => x.id !== id)), 1100)
    }
    post(emoji, 'reaction')
  }
  const onChange = (e) => {
    const v = e.target.value.slice(0, COMMENT_MAX)
    setText(v)
    const before = v.slice(0, e.target.selectionStart ?? v.length)
    const m = before.match(/(?:^|\s)@([a-z0-9_]{0,20})$/i)
    setMention(m ? { query: m[1], at: before.length - m[1].length - 1 } : null)
  }
  const pick = (s) => {
    if (!mention) return
    const end = mention.at + 1 + mention.query.length
    setText(`${text.slice(0, mention.at)}@${s.username} ${text.slice(end)}`.slice(0, COMMENT_MAX))
    setMention(null)
    input.current?.focus()
  }

  return (
    <form className="scb" style={keyboard ? { bottom: keyboard } : undefined} onSubmit={send}>
      {notice && <div className="scb-toast" role="status">{notice}</div>}
      {focused && mention && suggestions.length > 0 && (
        <div className="mention-dropdown scb-mentions">
          {suggestions.map(s => (
            <button key={s.userId ?? s.username} type="button" className="mention-option" onMouseDown={(e) => { e.preventDefault(); pick(s) }}>
              {s.avatarUrl
                ? <img className="mention-option-avatar" src={thumbUrl(s.avatarUrl)} alt="" />
                : <span className="mention-option-avatar mention-option-avatar--initial">{(s.displayName ?? '?')[0].toUpperCase()}</span>}
              <span className="mention-option-handle">@{s.username}</span>
              <span className="mention-option-name">{s.displayName}</span>
            </button>
          ))}
        </div>
      )}
      <div className="scb-row">
        <label className="scb-pill">
          <input ref={input} value={text} onChange={onChange} maxLength={COMMENT_MAX} enterKeyHint="send"
                 placeholder={account ? t('comments.placeholder') : t('comments.placeholderGuest')} aria-label={t('comments.placeholder')}
                 onFocus={() => { if (!gate()) setFocused(true) }} onBlur={() => { setFocused(false); setMention(null) }} />
          {text.trim() && <button type="submit" className="scb-send" aria-label={t('comments.send')} onMouseDown={(e) => e.preventDefault()}><Icon name="paper-plane-outline" size={17} /></button>}
        </label>
        {!focused && QUICK.map((e, i) => (
          <button key={e} type="button" className="scb-quick" onClick={() => react(e, i)} aria-label={e}>
            {e}
            {floats.filter(f => f.i === i).map(f => <span key={f.id} className="scb-float" aria-hidden="true">{f.emoji}</span>)}
          </button>
        ))}
      </div>
    </form>
  )
}

/** The bar's height (the content above it leaves this much room). */
export const COMMENT_BAR_H = 60
