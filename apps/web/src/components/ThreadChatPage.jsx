import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  fetchMyAcceptances, cancelAcceptance,
  fetchThreadMessages, sendThreadMessage,
} from '../api'
import BackButton from './BackButton'
import ThreadScheduleBlock from './ThreadScheduleBlock'

/**
 * PR2 — per-acceptance thread chat (channels.type='challenge_thread'). 1:1
 * between the challenge creator and an acceptor.
 *
 * Mounted by App.jsx with `threadChannelId` (the channels.id of the thread).
 * Pulls the thread metadata via /me/acceptances (cheap, capped at 100).
 * Cancel button only shown in phase='accepted'.
 */

const AVATAR_PALETTES = [
  ['#7c6aff', '#c084fc'], ['#ff6a9f', '#fb7185'], ['#22d3ee', '#38bdf8'],
  ['#4ade80', '#34d399'], ['#fb923c', '#fbbf24'], ['#f472b6', '#e879f9'],
  ['#818cf8', '#60a5fa'], ['#2dd4bf', '#a3e635'],
]
function avatarColors(name = '') {
  const hash = name.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0)
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length]
}

function toMs(ts) {
  if (!ts) return 0
  if (typeof ts === 'number') return ts < 1e10 ? ts * 1000 : ts
  return new Date(typeof ts === 'string' ? ts.replace(' ', 'T') : ts).getTime()
}

function formatTime(ts) {
  const ms = toMs(ts)
  if (!ms) return ''
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function ThreadChatPage({
  threadChannelId,
  guest,
  account,
  onBack,
  onCancelled,    // called after a successful cancel (host navigates back)
  socket,
  sessionId,
}) {
  const { t } = useTranslation('challenge')

  const [summary, setSummary]       = useState(null)
  const [loading, setLoading]       = useState(true)
  const [messages, setMessages]     = useState([])
  const [composer, setComposer]     = useState('')
  const [sending,  setSending]      = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  const feedRef  = useRef(null)
  const knownIds = useRef(new Set())

  // ── Load thread summary + messages ─────────────────────────────────────────

  const loadSummary = useCallback(async () => {
    if (!threadChannelId || !account?.id) { setSummary(null); setLoading(false); return }
    try {
      const threads = await fetchMyAcceptances()
      setSummary(threads.find(thr => thr.thread_channel_id === threadChannelId) ?? null)
    } catch { setSummary(null) }
    finally { setLoading(false) }
  }, [threadChannelId, account?.id])

  const loadMessages = useCallback(async () => {
    if (!threadChannelId) return
    try {
      const data = await fetchThreadMessages(threadChannelId, { limit: 50 })
      const msgs = (data.messages ?? []).sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt))
      knownIds.current = new Set(msgs.map(m => m.id ?? `${m.guestId}:${m.createdAt}`))
      setMessages(msgs)
    } catch {}
  }, [threadChannelId])

  useEffect(() => { loadSummary(); loadMessages() }, [loadSummary, loadMessages])

  // ── WS — join the thread room + listen for new messages + cancellations ──

  useEffect(() => {
    if (!socket || !sessionId || !threadChannelId) return
    socket.joinChallengeThread(threadChannelId, sessionId)
    const offMsg = socket.on('newMessage', (data) => {
      if (data.channelId !== threadChannelId) return
      const m = data.message; if (!m) return
      const key = m.id ?? `${m.guestId}:${m.createdAt}`
      if (knownIds.current.has(key)) return
      knownIds.current.add(key)
      setMessages(prev => {
        const optIdx = prev.findIndex(x =>
          typeof x.id === 'string' && x.id.startsWith('local-') &&
          x.guestId === m.guestId && (x.content ?? '') === (m.content ?? '')
        )
        if (optIdx >= 0) { const copy = [...prev]; copy[optIdx] = m; return copy }
        return [...prev, m].sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt))
      })
    })
    const offCancelled = socket.on('challenge_acceptance_cancelled', (data) => {
      const payload = data.payload ?? {}
      if (payload.threadChannelId === threadChannelId) {
        window.alert(`${t('thread.cancelledByOther.title')}\n\n${t('thread.cancelledByOther.body')}`)
        onBack?.()
      }
    })
    // PR3 — date concertation pushes (other party only; my own UI updates from
    // the HTTP response). Each one refreshes the summary so the schedule band
    // re-renders.
    const onDateChange = (data) => {
      const payload = data.payload ?? {}
      if (payload.threadChannelId === threadChannelId) loadSummary()
    }
    const offProposed  = socket.on('challenge_date_proposed',  onDateChange)
    const offWithdrawn = socket.on('challenge_date_withdrawn', onDateChange)
    const offApproved  = socket.on('challenge_date_approved',  onDateChange)
    return () => {
      offMsg(); offCancelled(); offProposed(); offWithdrawn(); offApproved()
      socket.leaveChallengeThread(threadChannelId, sessionId)
    }
  }, [threadChannelId, socket, sessionId, onBack, t, loadSummary])

  // Auto-scroll on new message.
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight
  }, [messages.length])

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault()
    const content = composer.trim()
    if (!content || sending) return
    setSending(true)
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const optimistic = {
      id: localId, channelId: threadChannelId,
      userId: account?.id, guestId: account?.id,
      nickname: account?.display_name ?? 'You',
      content, createdAt: Date.now() / 1000, status: 'sending',
    }
    setMessages(prev => [...prev, optimistic])
    setComposer('')
    try {
      const sent = await sendThreadMessage(threadChannelId, content)
      setMessages(prev => prev.map(m => m.id === localId ? sent : m))
      knownIds.current.add(sent.id)
    } catch {
      setMessages(prev => prev.map(m => m.id === localId ? { ...m, status: 'failed' } : m))
    } finally {
      setSending(false)
    }
  }, [threadChannelId, composer, sending, account])

  const handleCancel = useCallback(async () => {
    if (!summary || cancelBusy) return
    const title = summary.i_am_creator
      ? t('thread.cancel.creatorTitle')
      : t('thread.cancel.acceptorTitle')
    if (!window.confirm(`${title}\n\n${t('thread.cancel.body')}`)) return
    setCancelBusy(true)
    try {
      await cancelAcceptance(summary.id)
      onCancelled?.()
    } catch {
      window.alert(t('thread.cancel.failed'))
    } finally {
      setCancelBusy(false)
    }
  }, [summary, cancelBusy, t, onCancelled])

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="full-page topic-chat-page">
        <div className="page-header topic-chat-header"><BackButton onClick={onBack} /></div>
        <div className="topic-chat-empty">…</div>
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="full-page topic-chat-page">
        <div className="page-header topic-chat-header"><BackButton onClick={onBack} /></div>
        <div className="topic-chat-empty">{t('thread.notFound')}</div>
      </div>
    )
  }

  const cp = summary.counterparty
  const [c1, c2] = avatarColors(cp.displayName)
  const canCancel = summary.phase === 'accepted'

  return (
    <div className="full-page topic-chat-page">
      {/* Header: back | avatar + counterparty name + challenge title | cancel */}
      <div className="page-header topic-chat-header challenge-chat-header">
        <BackButton onClick={onBack} />
        <div className="topic-chat-header-center" style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span
            className="thread-header-avatar"
            style={{
              width: 32, height: 32, borderRadius: 16,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: `linear-gradient(135deg, ${c1}, ${c2})`,
              color: '#fff', fontWeight: 700, fontSize: 13,
              overflow: 'hidden', flexShrink: 0,
            }}
          >
            {cp.thumbAvatarUrl
              ? <img src={cp.thumbAvatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : (cp.displayName ?? '?')[0].toUpperCase()}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span className="topic-chat-header-title" style={{ fontSize: 15, lineHeight: 1.2 }}>{cp.displayName}</span>
            <span style={{ fontSize: 11, color: 'var(--muted, #b3b3b3)', fontWeight: 600 }}>{summary.challenge_title}</span>
          </div>
        </div>
        {canCancel && (
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelBusy}
            title={summary.i_am_creator ? t('thread.cancel.creatorTitle') : t('thread.cancel.acceptorTitle')}
            style={{
              width: 36, height: 36, borderRadius: 18,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)',
              color: 'var(--muted, #b3b3b3)', cursor: 'pointer', fontSize: 16,
            }}
          >
            {cancelBusy ? '…' : '✕'}
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="topic-chat-feed" ref={feedRef}>
        {messages.length === 0 && (
          <div className="topic-chat-empty">
            <span className="topic-chat-empty-icon">👋</span>
            <span>{t('thread.empty')}</span>
          </div>
        )}
        {messages.map((m, idx) => {
          // PR3 — event-card system message (server inserts on date approve).
          // Renders as a centred pill, not a user bubble. The schedule band
          // above the composer carries the actionable state; this just leaves
          // a marker in the chat history.
          if (m.type === 'event') {
            return (
              <div key={m.id ?? idx} style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 999,
                  background: 'rgba(34,197,94,0.10)',
                  border: '1px solid rgba(34,197,94,0.20)',
                  color: '#4ade80', fontWeight: 700, fontSize: 12, letterSpacing: 0.2,
                }}>
                  📅 {m.content || 'Meet-up scheduled'}
                </div>
              </div>
            )
          }

          const isMine    = (account?.id && m.userId === account.id) || (account?.id && m.guestId === account.id)
          const prev      = messages[idx - 1]
          const isGrouped = prev && prev.type !== 'event' && (prev.userId === m.userId || prev.guestId === m.guestId)
          const [ac1, ac2] = avatarColors(m.nickname ?? '')
          const opacity   = m.status === 'failed' ? 0.5 : m.status === 'sending' ? 0.7 : 1
          return (
            <div key={m.id ?? idx} className={['message', isMine ? 'mine' : '', isGrouped ? 'grouped' : ''].filter(Boolean).join(' ')}>
              {!isMine && !isGrouped && (
                <div className="msg-meta">
                  <span className="msg-avatar" style={{ background: `linear-gradient(135deg, ${ac1}, ${ac2})` }}>
                    {(m.nickname ?? '?')[0].toUpperCase()}
                  </span>
                  <span className="msg-author" style={{ color: ac1 }}>{m.nickname}</span>
                </div>
              )}
              <div className={`msg-bubble-wrap ${isMine ? 'mine' : ''}`} style={{ opacity }}>
                <div className="msg-content"><span className="msg-text">{m.content}</span></div>
              </div>
              <span className={`msg-time${isMine ? ' msg-time--mine' : ''}`}>{formatTime(m.createdAt)}</span>
            </div>
          )
        })}
      </div>

      {/* PR3 — schedule band sits between the chat feed and the composer.
          State-aware: propose / awaiting / approve / scheduled. */}
      {account?.id && (
        <ThreadScheduleBlock
          thread={summary}
          myUserId={account.id}
          onChange={loadSummary}
        />
      )}

      {/* Composer */}
      <form onSubmit={handleSubmit} className="topic-composer">
        <input
          type="text"
          value={composer}
          onChange={e => setComposer(e.target.value)}
          placeholder={t('thread.empty')}
          maxLength={1000}
        />
        <button type="submit" disabled={!composer.trim() || sending}>
          {sending ? '…' : '➤'}
        </button>
      </form>
    </div>
  )
}
