import { useState, useEffect, useRef } from 'react'
import { fetchConversationMessages, sendConversationMessage, markConversationRead } from '../api'
import BackButton from './BackButton'
import SendButton from './SendButton'

const AVATAR_PALETTES = [
  ['#7c6aff', '#c084fc'], ['#ff6a9f', '#fb7185'], ['#22d3ee', '#38bdf8'],
  ['#4ade80', '#34d399'], ['#fb923c', '#fbbf24'], ['#f472b6', '#e879f9'],
  ['#818cf8', '#60a5fa'], ['#2dd4bf', '#a3e635'],
]

function avatarColors(name) {
  const hash = (name || '?').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length]
}

export default function DirectMessageScreen({ conversation, otherUser, account, socket, onBack }) {
  const [messages, setMessages]   = useState([])
  const [input, setInput]         = useState('')
  const [sending, setSending]     = useState(false)
  const [error, setError]         = useState(null)
  const bottomRef                 = useRef(null)
  const knownIds                  = useRef(new Set())

  const otherName = otherUser?.display_name ?? '?'
  const [c1, c2] = avatarColors(otherName)

  // Load message history and mark as read immediately on open
  useEffect(() => {
    markConversationRead(conversation.id) // fire-and-forget; UI already cleared optimistically
    fetchConversationMessages(conversation.id)
      .then(data => {
        knownIds.current = new Set(data.messages.map(m => m.id))
        setMessages(data.messages)
      })
      .catch(() => setError('Could not load messages.'))
  }, [conversation.id])

  // Join WS DM room and listen for new messages
  useEffect(() => {
    if (!socket || !account?.id) return
    socket.joinConversation(conversation.id, account.id)

    socket.on('newConversationMessage', ({ conversationId, message }) => {
      if (conversationId !== conversation.id) return
      if (knownIds.current.has(message.id)) return
      knownIds.current.add(message.id)
      setMessages(prev => [...prev, message])
    })

    return () => {
      socket.leaveConversation(conversation.id, account.id)
    }
  }, [conversation.id, account?.id, socket])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend(e) {
    e.preventDefault()
    const content = input.trim()
    if (!content || sending) return
    setSending(true)
    setError(null)
    try {
      const { message } = await sendConversationMessage(conversation.id, content)
      knownIds.current.add(message.id)
      setMessages(prev => [...prev, message])
      setInput('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="full-page dm-screen">
      {/* Header */}
      <div className="page-header">
        <BackButton onClick={onBack} />
        <div className="dm-header-identity">
          {otherUser?.profile_photo_url
            ? <img className="online-avatar dm-header-avatar" src={otherUser.profile_photo_url} alt={otherName} />
            : <span className="online-avatar dm-header-avatar" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                {otherName[0].toUpperCase()}
              </span>
          }
          <span className="dm-header-name">{otherName}</span>
        </div>
      </div>

      {/* Messages */}
      <div className="dm-messages">
        {error && <p className="profile-error" style={{ margin: '12px 16px' }}>{error}</p>}

        {messages.map(msg => {
          const isMe = msg.sender_id === account?.id
          return (
            <div key={msg.id} className={`dm-bubble-wrap${isMe ? ' dm-bubble-wrap--me' : ''}`}>
              <div className={`dm-bubble${isMe ? ' dm-bubble--me' : ''}`}>
                {msg.content}
              </div>
            </div>
          )
        })}

        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <form className="dm-composer" onSubmit={handleSend}>
        <input
          className="dm-input"
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Message…"
          maxLength={1000}
          autoFocus
        />
        <SendButton disabled={sending || !input.trim()} />
      </form>
    </div>
  )
}
