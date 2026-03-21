import { useState, useEffect, useRef } from 'react'
import { createGuestSession, resolveLocation, fetchMessages, sendMessage } from './api'

export default function App() {
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState(null)
  const [city, setCity] = useState(null)
  const [channelId, setChannelId] = useState(null)
  const [guest, setGuest] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)
  const pollRef = useRef(null)

  useEffect(() => {
    init()
    return () => clearInterval(pollRef.current)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function init() {
    try {
      const session = await createGuestSession()
      setGuest(session)

      const position = await getPosition()
      const location = await resolveLocation(position.coords.latitude, position.coords.longitude)
      setCity(location.city)
      setChannelId(location.channelId)

      const data = await fetchMessages(location.channelId)
      setMessages(data.messages)
      setStatus('ready')

      pollRef.current = setInterval(async () => {
        const latest = await fetchMessages(location.channelId)
        setMessages(latest.messages)
      }, 3000)
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by your browser'))
        return
      }
      navigator.geolocation.getCurrentPosition(resolve, () =>
        reject(new Error('Location access denied'))
      )
    })
  }

  async function handleSend(e) {
    e.preventDefault()
    const content = input.trim()
    if (!content || sending) return
    setSending(true)
    try {
      const msg = await sendMessage(channelId, guest.guestId, content)
      setMessages((prev) => [...prev, msg])
      setInput('')
    } catch (err) {
      alert(err.message)
    } finally {
      setSending(false)
    }
  }

  if (status === 'loading') {
    return (
      <div className="screen center">
        <p className="loading-text">Locating you...</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="screen center">
        <p className="error-text">{error}</p>
        <button className="retry-btn" onClick={() => { setStatus('loading'); setError(null); init() }}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="screen chat">
      <header className="chat-header">
        <span className="city-name">{city}</span>
        <span className="nickname">{guest?.nickname}</span>
      </header>

      <div className="messages">
        {messages.length === 0 && (
          <p className="empty">No messages yet. Say hi!</p>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`message ${msg.guestId === guest?.guestId ? 'mine' : ''}`}
          >
            <span className="msg-author">{msg.nickname}</span>
            <span className="msg-content">{msg.content}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form className="input-bar" onSubmit={handleSend}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          maxLength={1000}
          autoFocus
        />
        <button type="submit" disabled={sending || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}
