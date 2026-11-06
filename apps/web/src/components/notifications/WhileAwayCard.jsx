import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchInbox, markNotificationsSeen } from '../../api'
import AvatarWithFlag from '../AvatarWithFlag'
import Icon from '../Icon'
import { patchNotifCounts, useNotifCounts } from '../../lib/notifCounts'
import { awayLine } from './inboxText'

/**
 * "While you were away" (V6), at the top of Today: unseen Social or Game
 * notifications as stacked avatars and one line. A click opens the
 * notifications; ✕ dismisses it (seen, not read), so the same items never
 * show twice. No swipe on the web (the app's is native only): a drag ended
 * in a click that opened the notifications.
 */
export default function WhileAwayCard({ account, onOpen }) {
  const { t } = useTranslation('notifications')
  const { unseen } = useNotifCounts()
  const pending = (unseen.social ?? 0) + (unseen.game ?? 0)
  const [items, setItems] = useState(null)

  useEffect(() => {
    if (!account || pending === 0) { setItems(null); return undefined }
    let alive = true
    fetchInbox({ categories: ['social', 'game'], unseen: true, limit: 8 }).then(r => { if (alive) setItems(r.items) }).catch(() => {})
    return () => { alive = false }
  }, [account, pending])

  const ids = useMemo(() => (items ?? []).flatMap(i => i.ids), [items])
  const seen = () => {
    markNotificationsSeen({ ids })
    patchNotifCounts(c => ({ ...c, unseen: { ...c.unseen, social: 0, game: 0 } }))
    setItems(null)
  }
  if (!items?.length) return null
  const actors = []
  for (const i of items) for (const a of i.actors ?? []) {
    if (actors.length < 3 && !actors.some(x => (x.id ?? x.name) === (a.id ?? a.name))) actors.push(a)
  }
  const line = awayLine(items, t)

  return (
    <div className="n6-away">
      <button type="button" className="n6-away-body" onClick={() => { seen(); onOpen() }} aria-label={`${t('away.title')}. ${line}`}>
        {actors.length > 0 && (
          <span className="n6-away-stack" style={{ width: 30 + (actors.length - 1) * 18 }}>
            {actors.map((a, i) => (
              <span key={a.id ?? a.name} className="n6-away-avatar" style={{ left: i * 18, zIndex: 3 - i }}>
                <AvatarWithFlag userId={a.id} displayName={a.name} photoUrl={a.photoUrl} size={30} />
              </span>
            ))}
          </span>
        )}
        <span className="n6-away-text">
          <span className="n6-away-title">{t('away.title')}</span>
          <span className="n6-away-line">{line}</span>
        </span>
      </button>
      <button type="button" className="n6-away-close" onClick={seen} aria-label={t('away.dismiss')}><Icon name="close" size={18} /></button>
    </div>
  )
}
