import { useState, useEffect, useCallback, useRef } from 'react'
import {
  fetchIncomingFriendRequests, fetchOutgoingFriendRequests,
  acceptFriendRequest, declineFriendRequest, cancelFriendRequest,
} from '../api'
import BackButton from './BackButton'
import Icon from './Icon'
import { useTranslation } from 'react-i18next'

const AVATAR_BG = ['#7c6aff', '#ff6a9f', '#22d3ee', '#4ade80', '#fb923c', '#f472b6', '#818cf8', '#2dd4bf']
function avatarBg(name) {
  const hash = (name ?? '?').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return AVATAR_BG[hash % AVATAR_BG.length]
}

/**
 * Friend requests inbox - Incoming + Sent tabs.
 * Subscribes to per-user WS events via the wsClient prop so the lists update
 * live when the other party acts (mirrors the mobile useFriendRequests hook).
 */
export default function FriendRequestsScreen({ onBack, onViewProfile, wsClient }) {
  const { t } = useTranslation('profile')
  const [tab, setTab]           = useState('incoming')
  const [incoming, setIncoming] = useState([])
  const [outgoing, setOutgoing] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)

  const incomingRef = useRef(incoming)
  const outgoingRef = useRef(outgoing)
  incomingRef.current = incoming
  outgoingRef.current = outgoing

  const refresh = useCallback(async () => {
    try {
      const [inc, out] = await Promise.all([
        fetchIncomingFriendRequests(),
        fetchOutgoingFriendRequests(),
      ])
      setIncoming(inc)
      setOutgoing(out)
    } catch (e) {
      setError(t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Live updates from the per-user WS channel
  useEffect(() => {
    if (!wsClient?.on) return
    const offReceived  = wsClient.on('friendRequestReceived',  ({ request }) => {
      if (!request) return
      setIncoming(prev => prev.some(r => r.id === request.id) ? prev : [request, ...prev])
    })
    const offAccepted  = wsClient.on('friendRequestAccepted',  ({ requestId }) => {
      if (!requestId) return
      setOutgoing(prev => prev.filter(r => r.id !== requestId))
    })
    const offDeclined  = wsClient.on('friendRequestDeclined',  ({ requestId }) => {
      if (!requestId) return
      setOutgoing(prev => prev.filter(r => r.id !== requestId))
    })
    const offCancelled = wsClient.on('friendRequestCancelled', ({ requestId }) => {
      if (!requestId) return
      setIncoming(prev => prev.filter(r => r.id !== requestId))
    })
    return () => { offReceived(); offAccepted(); offDeclined(); offCancelled() }
  }, [wsClient])

  // Optimistic mutations
  async function handleAccept(id) {
    const prev = incomingRef.current
    setIncoming(prev.filter(r => r.id !== id))
    try { await acceptFriendRequest(id) }
    catch { setIncoming(prev); setError(t('errors.generic')) }
  }
  async function handleDecline(id) {
    const prev = incomingRef.current
    setIncoming(prev.filter(r => r.id !== id))
    try { await declineFriendRequest(id) }
    catch { setIncoming(prev); setError(t('errors.generic')) }
  }
  async function handleCancel(id) {
    const prev = outgoingRef.current
    setOutgoing(prev.filter(r => r.id !== id))
    try { await cancelFriendRequest(id) }
    catch { setOutgoing(prev); setError(t('errors.generic')) }
  }

  const list = tab === 'incoming' ? incoming : outgoing

  return (
    <div className="full-page friend-req-screen">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{t('friendReq.title')}</span>
      </div>

      <div className="friend-req-tabs">
        <button
          className={`friend-req-tab${tab === 'incoming' ? ' friend-req-tab--active' : ''}`}
          onClick={() => setTab('incoming')}
        >
          {t('friendReq.incoming')}{incoming.length > 0 ? ` · ${incoming.length}` : ''}
        </button>
        <button
          className={`friend-req-tab${tab === 'sent' ? ' friend-req-tab--active' : ''}`}
          onClick={() => setTab('sent')}
        >
          {t('friendReq.sent')}{outgoing.length > 0 ? ` · ${outgoing.length}` : ''}
        </button>
      </div>

      {error && <div className="friend-req-error" onClick={() => setError(null)}>{error}</div>}

      {loading ? (
        <div className="friend-req-empty">{t('loading', { ns: 'common' })}</div>
      ) : list.length === 0 ? (
        <div className="friend-req-empty">
          <div className="friend-req-empty-emoji" style={{ color: 'var(--muted2)' }}><Icon name={tab === 'incoming' ? 'person-add-outline' : 'paper-plane-outline'} size={32} /></div>
          <div className="friend-req-empty-title">
            {tab === 'incoming' ? t('friendReq.emptyIncomingTitle') : t('friendReq.emptySentTitle')}
          </div>
          <div className="friend-req-empty-sub">
            {tab === 'incoming' ? t('friendReq.emptyIncomingSub') : t('friendReq.emptySentSub')}
          </div>
        </div>
      ) : (
        <ul className="friend-req-list">
          {list.map(req => {
            const name    = req.other_display_name ?? '?'
            const initial = name[0]?.toUpperCase() ?? '?'
            const photo   = req.other_photo_url ?? null
            return (
              <li key={req.id} className="friend-req-row">
                <button
                  className="friend-req-row-main"
                  onClick={() => req.other_user_id && onViewProfile?.(req.other_user_id)}
                >
                  {photo
                    ? <img src={photo} alt="" className="friend-req-avatar" />
                    : <span className="friend-req-avatar friend-req-avatar--fallback" style={{ background: avatarBg(name) }}>{initial}</span>}
                  <div className="friend-req-row-text">
                    <div className="friend-req-row-name">{name}</div>
                    <div className="friend-req-row-sub">
                      {tab === 'incoming' ? t('friendReq.wantsToBeFriend') : t('friendReq.requestSent')}
                    </div>
                  </div>
                </button>
                {tab === 'incoming' ? (
                  <div className="friend-req-actions">
                    <button className="friend-req-decline" onClick={() => handleDecline(req.id)}>{t('friendReq.decline')}</button>
                    <button className="friend-req-accept"  onClick={() => handleAccept(req.id)}>{t('friendReq.accept')}</button>
                  </div>
                ) : (
                  <button className="friend-req-cancel" onClick={() => handleCancel(req.id)}>{t('friendReq.cancel')}</button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
