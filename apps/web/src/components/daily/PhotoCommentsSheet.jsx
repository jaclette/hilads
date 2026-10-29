import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import i18n from '../../i18n'
import { fetchDailyProof, fetchPhotoMentionSuggestions } from '../../api'
import { countryToFlag } from '../../lib/countryFlag'
import { thumbUrl } from '../../lib/imageThumb'
import { useBackLayer } from '../../lib/backLayers'
import Icon from '../Icon'
import EmojiPicker from '../EmojiPicker'
import { themeColor } from '../joy/Joy'
import { themeName } from '../map/spotsShared'
import { useDaily, useDc } from './dailyShared'
import {
  discardFailed, loadOlder, removeComment, reportComment, sendComment, toggleCommentLike, useCommentSummary, useCommentThread,
} from './comments'

// The comments of a Daily photo (the app's PhotoCommentsSheet): one sheet for
// every place a photo shows. openPhotoComments(target) opens it; one host,
// mounted by App inside the Daily context, shows it above everything.

export const COMMENT_MAX = 300
const REASONS = ['inappropriate', 'harassment', 'spam', 'other']
const NEW_FOR_MS = 5 * 60_000

/** target: {proofId, thumbUrl?, author?, city?, theme?, isMine?, focusCommentId?, onLeave?} */
let current = null
const listeners = new Set()
let version = 0
const notify = () => { version++; listeners.forEach(l => l()) }
const subscribeOpen = (l) => { listeners.add(l); return () => listeners.delete(l) }

export function openPhotoComments(target) { current = target; notify() }
export function closePhotoComments() { current = null; notify() }

/** True while the comments are open (the stories pause). */
export function useCommentsOpen() {
  useSyncExternalStore(subscribeOpen, () => version)
  return current !== null
}

/** A target from a full proof. `onLeave`: the layer under it closes before a profile opens. */
export function commentsTargetOf(p, extra = {}) {
  return {
    proofId: p.id, thumbUrl: p.thumbUrl ?? p.photoUrl, selfieThumb: p.selfieThumbUrl ?? p.selfieUrl ?? null, author: p.user,
    city: p.city ? { name: p.city.name, country: p.city.country } : null,
    theme: p.context?.theme?.key ?? null, isMine: !!p.isMine, ...extra,
  }
}

export function PhotoCommentsHost() {
  useSyncExternalStore(subscribeOpen, () => version)
  return current ? <Sheet key={current.proofId} initial={current} onClose={closePhotoComments} /> : null
}

/** Quick reactions: the photo's theme picks which ones. */
function quickKeys(theme) {
  if (theme === 'taste' || theme === 'sip') return ['wantThis', 'soLocal', 'whatsItCalled', 'whereIsIt']
  if (theme === 'hidden_gem' || theme === 'only_here') return ['soLocal', 'whereIsIt', 'neverSeen', 'wantThis']
  return ['soLocal', 'neverSeen', 'whereIsIt', 'whatsItCalled']
}

function Sheet({ initial, onClose }) {
  const { t } = useDc()
  const { account, openProfile, needAccount } = useDaily()
  useBackLayer(true, onClose)   // browser back closes it
  const [target, setTarget] = useState(initial)
  useEffect(() => {
    if (initial.author) return
    let live = true
    fetchDailyProof(initial.proofId).then(p => { if (live) setTarget(commentsTargetOf(p, { focusCommentId: initial.focusCommentId, onLeave: initial.onLeave })) }).catch(() => {})
    return () => { live = false }
  }, [initial])

  const thread = useCommentThread(target.proofId)
  const items = useMemo(() => thread.items.map(c => (
    account && c.user.id === account.id ? { ...c, isMine: true, canDelete: true } : target.isMine ? { ...c, canDelete: true } : c
  )), [thread.items, account, target.isMine])
  const count = items.filter(c => c.pending !== 'failed').length

  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [menu, setMenu] = useState(null)          // {comment, reporting}
  const [emoji, setEmoji] = useState(false)
  const [mention, setMention] = useState(null)    // {query, at}
  const [suggestions, setSuggestions] = useState([])
  const [notice, setNotice] = useState(null)
  const [flash, setFlash] = useState(initial.focusCommentId ?? null)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  useBackLayer(!!menu, () => setMenu(null))

  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 3200)
    return () => clearTimeout(id)
  }, [notice])

  // Scroll: to the end when comments arrive, or to the comment a notification is about.
  useEffect(() => {
    const list = listRef.current
    if (!list || !thread.loaded) return
    const el = flash ? list.querySelector(`[data-comment="${flash}"]`) : null
    if (el) el.scrollIntoView({ block: 'center' })
    else list.scrollTop = list.scrollHeight
  }, [thread.loaded, items.length, flash])
  useEffect(() => {
    if (!flash) return
    const id = setTimeout(() => setFlash(null), 2400)
    return () => clearTimeout(id)
  }, [flash])

  useEffect(() => {
    if (!mention || !account) { setSuggestions([]); return }
    let live = true
    const id = setTimeout(() => fetchPhotoMentionSuggestions(target.proofId, mention.query).then(s => { if (live) setSuggestions(s) }), 250)
    return () => { live = false; clearTimeout(id) }
  }, [mention, target.proofId, account])

  const gate = () => {
    if (account) return false
    onClose(); target.onLeave?.()
    needAccount('daily_comment')
    return true
  }
  const goProfile = (user) => {
    onClose(); target.onLeave?.()
    if (!account) { needAccount('view_profile'); return }
    openProfile(user.id, user.username ?? user.displayName ?? '')
  }

  const change = (v) => {
    setText(v)
    const before = v.slice(0, inputRef.current?.selectionEnd ?? v.length)
    const m = before.match(/(?:^|\s)@([a-z0-9_]{0,20})$/i)
    setMention(m ? { query: m[1], at: before.length - m[1].length - 1 } : null)
  }
  const pickMention = (s) => {
    if (!mention) return
    const end = mention.at + 1 + mention.query.length
    setText(`${text.slice(0, mention.at)}@${s.username} ${text.slice(end)}`.slice(0, COMMENT_MAX))
    setMention(null)
    inputRef.current?.focus()
  }

  const send = async (body, retry) => {
    const clean = body.trim()
    if (!clean || gate()) return
    const first = count === 0
    const quoting = retry ? (retry.replyTo ? items.find(c => c.id === retry.replyTo.id) ?? null : null) : replyTo
    if (!retry) { setText(''); setReplyTo(null); setEmoji(false) }
    navigator.vibrate?.(10)
    const err = await sendComment(target.proofId, clean, account, quoting, !!target.isMine, retry?.tempId)
    if (err === null && first) navigator.vibrate?.([10, 40, 10])
    if (err === 'moderation_blocked' || err === 'invalid_body' || err === 'rate_limited') {
      if (!retry) setText(clean)
      setNotice(t(`comments.errors.${err}`))
    } else if (err === 'signup_required') gate()
  }

  const reply = (c) => {
    setMenu(null)
    if (gate()) return
    setReplyTo(c)
    const handle = c.user.username ? `@${c.user.username} ` : ''
    if (handle && !text.startsWith(handle)) setText((handle + text).slice(0, COMMENT_MAX))
    inputRef.current?.focus()
  }
  const report = async (c, reason) => {
    setMenu(null)
    const r = await reportComment(c.id, reason)
    setNotice(r === 'already' ? t('comments.report.already') : r === 'ok' ? t('comments.report.thanks') : t('comments.errors.generic'))
  }
  const remove = async (c) => {
    setMenu(null)
    if (!(await removeComment(target.proofId, c.id))) setNotice(t('comments.errors.generic'))
  }

  const accent = themeColor(target.theme)
  const flag = countryToFlag(target.city?.country)
  const byline = [target.author?.username ? `@${target.author.username}` : target.author?.displayName,
    target.city?.name ? `${flag ? flag + ' ' : ''}${target.city.name}` : null].filter(Boolean).join(' · ')
  const firstId = !thread.hasMore ? items.find(c => !c.pending)?.id ?? null : null

  return createPortal(
    <div className="pc-wrap" role="dialog" aria-modal="true" aria-label={t('comments.title')}>
      <button type="button" className="v3-sheet-scrim" onClick={onClose} aria-label={t('comments.close')} />
      <div className="pc-sheet">
        <span className="v3-sheet-grabber" aria-hidden="true" />
        <div className="pc-head">
          {target.thumbUrl && (
            <span className="pc-thumb-wrap">
              <img className="pc-thumb" src={thumbUrl(target.thumbUrl)} alt="" />
              {target.selfieThumb && <img className="pc-thumb-selfie" src={target.selfieThumb} alt="" />}
            </span>
          )}
          <div className="pc-head-body">
            <p className="pc-title">{t('comments.title')}{count > 0 ? ` · ${count}` : ''}</p>
            <p className="pc-byline">{byline}</p>
          </div>
          {target.theme && (
            <span className="pc-theme" style={{ background: accent.fill, color: accent.onFill }}>{themeName(target.theme)}</span>
          )}
          <button type="button" className="pc-close" onClick={onClose} aria-label={t('comments.close')}><Icon name="close" size={20} /></button>
        </div>

        <div className="pc-list" ref={listRef}>
          {thread.loading && !thread.loaded ? <p className="pc-center dc-muted">…</p>
            : thread.error && !thread.loaded ? <p className="pc-center dc-muted">{t('loadFailed')}</p>
            : items.length === 0 ? (
              <div className="pc-empty">
                <span className="pc-empty-bubble" style={{ background: accent.fill, color: accent.onFill }}><Icon name="chatbubbles-outline" size={30} /></span>
                <p className="pc-empty-title">{t('comments.empty')}</p>
                <p className="dc-muted">{t('comments.emptySub')}</p>
              </div>
            ) : (
              <>
                {thread.hasMore && (
                  <button type="button" className="pc-older" onClick={() => loadOlder(target.proofId)}>{t('comments.older')}</button>
                )}
                {items.map(c => (
                  <Row key={c.tempId ?? c.id} c={c} first={c.id === firstId} flash={c.id === flash}
                       onProfile={goProfile} onMenu={() => setMenu({ comment: c, reporting: false })}
                       onLike={() => { if (!gate()) toggleCommentLike(target.proofId, c.id) }}
                       onRetry={() => send(c.body, c)} onDiscard={() => discardFailed(target.proofId, c.tempId)} />
                ))}
              </>
            )}
        </div>

        {notice && <p className="pc-notice" role="status">{notice}</p>}

        {text.length === 0 && !replyTo && (
          <div className="pc-chips">
            {quickKeys(target.theme).map(k => (
              <button key={k} type="button" className="pc-chip" style={{ borderColor: accent.fill }} onClick={() => send(t(`comments.quick.${k}`))}
                      onContextMenu={(e) => { e.preventDefault(); if (!gate()) { setText(t(`comments.quick.${k}`)); inputRef.current?.focus() } }}
                      title={t('comments.quickHint')}>
                {t(`comments.quick.${k}`)}
              </button>
            ))}
          </div>
        )}

        {replyTo && (
          <div className="pc-reply">
            <div className="pc-reply-body">
              <strong>{t('comments.replyingTo', { name: replyTo.user.username ?? replyTo.user.displayName ?? '' })}</strong>
              <span>{replyTo.body}</span>
            </div>
            <button type="button" className="pc-icon" onClick={() => setReplyTo(null)} aria-label={t('comments.cancelReply')}><Icon name="close" size={18} /></button>
          </div>
        )}

        <div className="pc-composer">
          {mention && suggestions.length > 0 && (
            <div className="mention-dropdown">
              {suggestions.map(s => (
                <button key={s.userId} type="button" className="mention-option" onMouseDown={(e) => { e.preventDefault(); pickMention(s) }}>
                  {s.avatarUrl
                    ? <img className="mention-option-avatar" src={thumbUrl(s.avatarUrl)} alt="" />
                    : <span className="mention-option-avatar mention-option-avatar--initial">{(s.displayName ?? '?')[0].toUpperCase()}</span>}
                  <span className="mention-option-handle">@{s.username}</span>
                  <span className="mention-option-name">{s.displayName}</span>
                </button>
              ))}
            </div>
          )}
          {emoji && <EmojiPicker onSelect={(e) => setText(v => (v + e).slice(0, COMMENT_MAX))} onClose={() => setEmoji(false)} />}
          <button type="button" className={`pc-icon${emoji ? ' pc-icon--on' : ''}`} onClick={() => { if (!gate()) setEmoji(v => !v) }}
                  aria-label={i18n.t('composer.emoji', { ns: 'common' })} aria-pressed={emoji}>
            <Icon name="happy-outline" size={22} />
          </button>
          <div className="pc-input-wrap">
            <textarea ref={inputRef} className="pc-input" rows={1} value={text} maxLength={COMMENT_MAX}
                      placeholder={account ? t('comments.placeholder') : t('comments.placeholderGuest')}
                      aria-label={t('comments.placeholder')}
                      onFocus={() => { setEmoji(false); gate() }}
                      onChange={(e) => change(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !mention) { e.preventDefault(); send(text) } }} />
            {text.length > COMMENT_MAX - 50 && (
              <span className={`pc-counter${text.length >= COMMENT_MAX ? ' pc-counter--full' : ''}`}>{COMMENT_MAX - text.length}</span>
            )}
          </div>
          <button type="button" className="pc-send" disabled={!text.trim()} onClick={() => send(text)} aria-label={t('comments.comment')}>
            <Icon name="paper-plane-outline" size={18} />
          </button>
        </div>

        {menu && (
          <div className="pc-menu-wrap">
            <button type="button" className="v3-sheet-scrim" onClick={() => setMenu(null)} aria-label={t('comments.close')} />
            <div className="pc-menu">
              <p className="pc-menu-quote">{menu.comment.body}</p>
              {menu.reporting
                ? REASONS.map(r => (
                  <button key={r} type="button" className="pc-menu-row" onClick={() => report(menu.comment, r)}>
                    <Icon name="flag-outline" size={18} />{t(`comments.report.reasons.${r}`)}
                  </button>
                ))
                : (
                  <>
                    {!menu.comment.pending && <button type="button" className="pc-menu-row" onClick={() => reply(menu.comment)}><Icon name="arrow-undo-outline" size={18} />{t('comments.reply')}</button>}
                    <button type="button" className="pc-menu-row" onClick={() => { navigator.clipboard?.writeText(menu.comment.body); setMenu(null) }}><Icon name="copy-outline" size={18} />{t('comments.copy')}</button>
                    {!menu.comment.isMine && !menu.comment.pending && (
                      <button type="button" className="pc-menu-row" onClick={() => setMenu({ ...menu, reporting: true })}><Icon name="flag-outline" size={18} />{t('comments.report.action')}</button>
                    )}
                    {menu.comment.canDelete && !menu.comment.pending && (
                      <button type="button" className="pc-menu-row pc-menu-row--danger" onClick={() => remove(menu.comment)}><Icon name="trash-outline" size={18} />{t('comments.delete')}</button>
                    )}
                  </>
                )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.getElementById('root') ?? document.body,
  )
}

/** "5 min ago", "yesterday"… in the page's language. */
function ago(createdAt, lng) {
  const s = Math.max(0, Date.now() / 1000 - createdAt)
  try {
    const f = new Intl.RelativeTimeFormat(lng, { numeric: 'auto', style: 'narrow' })
    if (s < 60) return f.format(0, 'second')
    if (s < 3600) return f.format(-Math.floor(s / 60), 'minute')
    if (s < 86400) return f.format(-Math.floor(s / 3600), 'hour')
    return f.format(-Math.floor(s / 86400), 'day')
  } catch { return '' }
}

/** The body around its resolved @mentions (links to their profile). */
function segments(c) {
  if (!c.mentions?.length) return [{ text: c.body }]
  const byName = new Map(c.mentions.map(m => [m.username.toLowerCase(), m]))
  const out = []
  let last = 0
  for (const m of c.body.matchAll(/@([A-Za-z0-9_]{1,30})/g)) {
    const who = byName.get(m[1].toLowerCase())
    if (!who) continue
    if (m.index > last) out.push({ text: c.body.slice(last, m.index) })
    out.push({ text: m[0], user: { id: who.userId, username: who.username } })
    last = m.index + m[0].length
  }
  if (last < c.body.length) out.push({ text: c.body.slice(last) })
  return out
}

function Row({ c, first, flash, onProfile, onMenu, onLike, onRetry, onDiscard }) {
  const { t, i18n } = useDc()
  const name = c.user.username ? `@${c.user.username}` : c.user.displayName ?? ''
  const flag = countryToFlag(c.user.city?.country)
  const [pop, setPop] = useState(false)
  const like = (e) => {
    e.stopPropagation()
    if (!c.myLike) { setPop(true); setTimeout(() => setPop(false), 300); navigator.vibrate?.(8) }
    onLike()
  }
  return (
    <div className={`pc-row${c.pending ? ' pc-row--pending' : ''}${flash || c.liveAt ? ' pc-row--flash' : ''}`} data-comment={c.id}
         onContextMenu={(e) => { e.preventDefault(); onMenu() }}>
      <button type="button" className="pc-avatar" onClick={() => onProfile(c.user)} aria-label={name}>
        {c.user.photoUrl ? <img src={thumbUrl(c.user.photoUrl)} alt="" /> : <span>{(c.user.displayName || name || '?').replace('@', '')[0]?.toUpperCase()}</span>}
      </button>
      <div className="pc-row-body">
        <div className="pc-meta">
          <button type="button" className="pc-handle" onClick={() => onProfile(c.user)}>{name}</button>
          {flag && <span title={c.user.city?.name}>{flag}</span>}
          {c.isAuthor && <span className="pc-pill">{t('comments.author')}</span>}
          {first && <span className="pc-pill pc-pill--first">{t('comments.first')}</span>}
          <span className="pc-time">{c.pending === 'sending' ? t('comments.sending') : ago(c.createdAt, i18n.language)}</span>
          {!c.pending && (
            <button type="button" className="pc-more" onClick={onMenu} aria-label={t('comments.actionsHint')}><Icon name="ellipsis-horizontal" size={16} /></button>
          )}
        </div>
        {c.replyTo && (
          <div className="pc-quote"><strong>@{c.replyTo.username}</strong><span>{c.replyTo.body}</span></div>
        )}
        <p className="pc-body">
          {segments(c).map((s, i) => (s.user
            ? <button key={i} type="button" className="pc-mention" onClick={() => onProfile(s.user)}>{s.text}</button>
            : <span key={i}>{s.text}</span>))}
        </p>
        {c.pending === 'failed' && (
          <p className="pc-failed">
            <button type="button" onClick={onRetry}>{t('comments.failed')}</button>
            <button type="button" className="pc-discard" onClick={onDiscard}>{t('comments.discard')}</button>
          </p>
        )}
      </div>
      {!c.pending && (
        <button type="button" className={`pc-heart${c.myLike ? ' pc-heart--on' : ''}${pop ? ' pc-heart--pop' : ''}`} onClick={like}
                aria-label={t('comments.like')} aria-pressed={c.myLike}>
          <Icon name={c.myLike ? 'heart' : 'heart-outline'} size={16} />
          {c.likeCount > 0 && <span>{c.likeCount}</span>}
        </button>
      )}
    </div>
  )
}

/**
 * The 💬 of a photo, live: `pill` (on a photo, labelled), `side` (a story's
 * right rail), `inline` (an action row), `count` (display only, hidden at 0).
 */
export function CommentButton({ target, variant }) {
  const { t } = useDc()
  const { count } = useCommentSummary(target.proofId)
  const label = t('comments.count', { count })
  if (variant === 'count') {
    if (count === 0) return null
    return <span className="pc-count" aria-label={label}><Icon name="chatbubble-outline" size={13} />{count}</span>
  }
  const open = (e) => { e.stopPropagation(); openPhotoComments(target) }
  return (
    <button type="button" className={`pc-btn pc-btn--${variant}`} onClick={open} aria-label={label}>
      <Icon name={variant === 'inline' ? 'chatbubble-outline' : 'chatbubble-ellipses-outline'} size={variant === 'side' ? 28 : 18} />
      {variant === 'pill' ? <span>{count > 0 ? label : t('comments.comment')}</span>
        : count > 0 ? <span>{count}</span> : variant === 'side' ? <span>{t('comments.comment')}</span> : null}
    </button>
  )
}

/** Under a photo's chat post: its 2 latest comments and "See all N comments". */
export function CommentPreview({ target }) {
  const { t } = useDc()
  const { count, latest, bumpedAt } = useCommentSummary(target.proofId)
  if (count === 0 || latest.length === 0) return null
  const fresh = bumpedAt !== null && Date.now() - bumpedAt < NEW_FOR_MS
  return (
    <button type="button" key={bumpedAt ?? 0} className={`pc-preview${bumpedAt ? ' pc-preview--flash' : ''}`}
            onClick={(e) => { e.stopPropagation(); openPhotoComments(target) }} aria-label={t('comments.seeAll', { count })}>
      {fresh && <span className="pc-pill">{t('comments.newComments')}</span>}
      {latest.map(c => (
        <span key={c.id} className="pc-preview-row">
          {c.user.photoUrl ? <img src={thumbUrl(c.user.photoUrl)} alt="" /> : <i>{(c.user.displayName || c.user.username || '?')[0].toUpperCase()}</i>}
          <span className="pc-preview-line"><strong>{c.user.username ? `@${c.user.username}` : c.user.displayName}</strong> {c.body.replace(/\s+/g, ' ')}</span>
        </span>
      ))}
      {count > latest.length && <span className="pc-preview-all">{t('comments.seeAll', { count })}</span>}
    </button>
  )
}
