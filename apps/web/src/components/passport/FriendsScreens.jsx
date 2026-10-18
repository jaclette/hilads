import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BackButton from '../BackButton'
import { fetchIncomingFriendRequestCount, fetchMySpots, fetchUserFriends, fetchUserVibes } from '../../api'
import { CityName } from '../CityName'
import { thumbUrl } from '../../lib/imageThumb'
import { themeName } from '../map/spotsShared'
import Icon from '../Icon'

/** Star rating as star icons: `on` filled (gold), the rest up to `of` outlined. */
function Stars({ on, of = 0, size }) {
  const n = Math.max(0, Math.round(on ?? 0))
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1, verticalAlign: 'middle' }}>
      {Array.from({ length: n }, (_, i) => <Icon key={`on${i}`} name="star" size={size} />)}
      {Array.from({ length: Math.max(0, of - n) }, (_, i) => <Icon key={`off${i}`} name="star-outline" size={size} style={{ color: 'var(--line)' }} />)}
    </span>
  )
}

const usePp = () => useTranslation('profile', { keyPrefix: 'pp' })

function Avatar({ name, photo }) {
  return photo
    ? <img className="pp-mini-avatar" src={thumbUrl(photo)} alt="" />
    : <span className="pp-mini-avatar pp-avatar--empty">{(name || '?')[0].toUpperCase()}</span>
}

/**
 * Friends (W4, from Passport, the app's /friends): the friend requests inbox,
 * my friends and the vibes I received (the former profile Friends and Vibes tabs).
 */
export function FriendsScreen({ account, onBack, onOpenRequests, onOpenProfile }) {
  const { t } = usePp()
  const [friends, setFriends] = useState(null)
  const [requests, setRequests] = useState(0)
  const [vibes, setVibes] = useState(null)

  useEffect(() => {
    fetchUserFriends(account.id, { page: 1, limit: 100 }).then(d => setFriends(d.friends ?? [])).catch(() => setFriends([]))
    fetchIncomingFriendRequestCount().then(setRequests).catch(() => {})
    fetchUserVibes(account.id).then(d => setVibes({ items: d.vibes ?? [], score: d.score, count: d.count ?? 0 }))
      .catch(() => setVibes({ items: [], score: null, count: 0 }))
  }, [account.id])

  return (
    <div className="full-page dc-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{t('tabFriends')}</span>
      </div>
      <div className="page-body dc-body">
        <button type="button" className="pp-row pp-row--card" onClick={onOpenRequests}>
          <Icon name="person-add-outline" size={20} />
          <span className="pp-row-label">{t('friendRequests')}</span>
          {requests > 0 && <span className="chat-scope-badge">{requests > 9 ? '9+' : requests}</span>}
          <Icon name="chevron-forward" size={18} style={{ color: 'var(--muted2)' }} />
        </button>

        <p className="dc-section">{t('myFriends')}</p>
        <div className="pp-list">
          {friends === null ? <div className="dc-center"><span className="wm-spinner" aria-hidden="true" /></div>
          : friends.length === 0 ? <p className="dc-muted pp-pad">{t('noFriends')}</p>
          : friends.map(f => (
            <button key={f.id} type="button" className="pp-person" onClick={() => onOpenProfile(f.id, f.displayName)}>
              <Avatar name={f.displayName} photo={f.thumbAvatarUrl ?? f.avatarUrl} />
              <span className="pp-person-name">{f.displayName}</span>
              <Icon name="chevron-forward" size={18} style={{ color: 'var(--muted2)' }} />
            </button>
          ))}
        </div>

        <p className="dc-section">{t('vibesReceived')}</p>
        <div className="pp-list">
          {vibes === null ? <div className="dc-center"><span className="wm-spinner" aria-hidden="true" /></div> : (
            <>
              {vibes.count > 0 && (
                <div className="pp-vibe-score">
                  <span className="pp-stars"><Stars on={vibes.score} of={5} size={22} /></span>
                  <span className="dc-muted">{t('vibeScore', { score: vibes.score?.toFixed(1) })} · {t('vibeBasis', { count: vibes.count })}</span>
                </div>
              )}
              {vibes.items.length === 0 ? <p className="dc-muted pp-pad">{t('noVibes')}<br />{t('noVibesSub')}</p>
              : vibes.items.map(v => (
                <div key={v.id} className="pp-person">
                  <Avatar name={v.authorName} photo={v.authorPhoto} />
                  <span className="pp-vibe-body">
                    <span className="pp-person-name">{v.authorName} <span className="pp-stars pp-stars--small"><Stars on={v.rating} size={12} /></span></span>
                    {v.message && <span className="dc-line">{v.message}</span>}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** My spots (W4, from Passport): the spots where I have an approved proof. */
export function MySpotsScreen({ onBack, onOpenSpot }) {
  const { t } = usePp()
  const [spots, setSpots] = useState(null)
  useEffect(() => { fetchMySpots().then(setSpots).catch(() => setSpots([])) }, [])
  return (
    <div className="full-page dc-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{t('passport.mySpots')}</span>
      </div>
      <div className="page-body dc-body">
        {spots === null ? <div className="dc-center"><span className="wm-spinner" aria-hidden="true" /></div>
        : spots.length === 0 ? <div className="dc-center"><span className="dc-big-emoji" style={{ color: 'var(--muted2)' }}><Icon name="location-outline" size={32} /></span><p className="dc-muted">{t('passport.noSpots')}</p></div>
        : spots.map(s => (
          <button key={s.id} type="button" className="pp-spot" onClick={() => onOpenSpot(s.id)}>
            {s.cover?.thumbUrl ? <img src={s.cover.thumbUrl} alt="" /> : <span className="pp-spot-img" />}
            <span className="pp-spot-body">
              <span className="pp-person-name">{s.name}</span>
              <span className="dc-muted">{s.city?.name && <><CityName name={s.city.name} country={s.city.country} short />{' · '}</>}{s.themes.map(k => themeName(k)).join(', ')}</span>
            </span>
            <Icon name="chevron-forward" size={18} style={{ color: 'var(--muted2)' }} />
          </button>
        ))}
      </div>
    </div>
  )
}
