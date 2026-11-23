import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BackButton from '../BackButton'
import AvatarWithFlag from '../AvatarWithFlag'
import Icon from '../Icon'
import { fetchCrew } from '../../api'
import { shareLink } from '../../lib/shareLink'
import { track } from '../../lib/analytics'
import i18n, { SUPPORTED, DEFAULT_LOCALE } from '../../i18n'

const usePp = () => useTranslation('profile', { keyPrefix: 'pp' })

/** The invite link in the visitor's language, with its utm_source. */
function linkFor(code, channel) {
  const lang = i18n.language
  const lp = lang && lang !== DEFAULT_LOCALE && SUPPORTED.includes(lang) ? `/${lang}` : ''
  return `${window.location.origin}${lp}/today?ref=${code}&utm_source=${channel}&utm_medium=share`
}

const isPhone = () => /Android|iPhone|iPad/i.test(navigator.userAgent)

/**
 * "Bring your crew" (the app's /invite): the share card, this season's progress, the three
 * steps, the friends I invited with their status, the rules; a big share button and
 * WhatsApp / Messenger (phones) / Copy link at the bottom. Values from GET /me/invite.
 * The web has no image share: the link's preview (/today?ref=) is the card.
 */
export default function InviteScreen({ account, onBack, onOpenProfile }) {
  const { t } = usePp()
  const [crew, setCrew] = useState(null)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    fetchCrew().then(setCrew).catch(() => setFailed(true))
  }, [])
  useEffect(() => { load(); track('invite_viewed', { signed_in: true }) }, [load])

  const name = account?.username ? '@' + account.username : account?.display_name ?? ''
  const max = crew?.max ?? 5
  const count = crew?.count ?? 0
  const steps = [
    { emoji: '🔗', title: t('invite.step1Title'), text: t('invite.step1Text') },
    { emoji: '📲', title: t('invite.step2Title'), text: t('invite.step2Text') },
    { emoji: '📸', title: t('invite.step3Title'), text: t('invite.step3Text'), points: crew?.points.friend ?? 10 },
  ]

  const shareMain = () => crew && shareLink({ type: 'invite', path: `/today?ref=${crew.code}`, text: t('invite.shareLine'), source: 'invite_screen' })
  const open = (channel) => {
    if (!crew) return
    const link = linkFor(crew.code, channel)
    track('share_started', { content_type: 'invite', source: 'invite_screen', channel })
    if (channel === 'copy_link') {
      navigator.clipboard?.writeText(link).then(() => {
        setCopied(true); setTimeout(() => setCopied(false), 2000)
        track('share_completed', { content_type: 'invite', channel })
      }).catch(() => {})
      return
    }
    const url = channel === 'whatsapp'
      ? `https://wa.me/?text=${encodeURIComponent(`${t('invite.shareLine')}\n${link}`)}`
      : `fb-messenger://share?link=${encodeURIComponent(link)}`
    window.open(url, '_blank', 'noopener')
    track('share_completed', { content_type: 'invite', channel })
  }
  const shortcuts = isPhone() ? ['whatsapp', 'messenger', 'copy_link'] : ['whatsapp', 'copy_link']

  return (
    <div className="full-page dc-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{t('invite.title')}</span>
      </div>
      <div className="page-body dc-body inv-body">
        {/* What a friend receives. */}
        <div className="inv-card" aria-label={t('invite.cardA11y', { name })}>
          <span className="inv-card-brand">Hilads</span>
          <AvatarWithFlag userId={account?.id} displayName={account?.display_name ?? account?.username} photoUrl={account?.profile_photo_url} size={72} />
          <strong className="inv-card-title">{t('invite.cardTitle', { name })}</strong>
          <span className="inv-card-text">{t('invite.cardText')}</span>
          <span className="inv-card-link">hilads.live</span>
        </div>

        <div className="pp-v2-card">
          <div className="pp-v2-head">
            <strong>{t('invite.progressTitle')}</strong>
            <span className="pp-v2-count" aria-label={t('crew.a11y', { count, max })}>{t('invite.progress', { count, max })}</span>
          </div>
          <div className="pp-v2-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (count / Math.max(1, max)) * 100)}%` }} className={crew?.bonus ? 'gold' : ''} /></div>
          <p className="dc-muted">{crew?.bonus ? t('crew.done', { points: crew.points.crew }) : t('invite.crewLine', { count: max, points: crew?.points.crew ?? 50 })}</p>
        </div>

        <div className="pp-v2-card inv-steps">
          {steps.map((s, i) => (
            <div key={s.title} className="inv-step">
              <span className="inv-rail"><span className="inv-dot" aria-hidden="true">{s.emoji}</span>{i < steps.length - 1 && <i />}</span>
              <span className="inv-step-body">
                <span className="inv-step-head"><strong>{s.title}</strong>{!!s.points && <span className="inv-pill">+{s.points}</span>}</span>
                <span className="dc-muted">{s.text}</span>
              </span>
            </div>
          ))}
          <p className="inv-bonus">🎉 {t('invite.bonus', { count: max, points: crew?.points.crew ?? 50 })}</p>
        </div>

        <p className="dc-section">{t('invite.friendsTitle')}</p>
        <div className="pp-list">
          {!crew && !failed && <div className="dc-center"><span className="wm-spinner" aria-hidden="true" /></div>}
          {failed && (
            <div className="dc-center inv-error">
              <p className="dc-muted">{t('invite.error')}</p>
              <button type="button" className="btn-secondary" onClick={load}>{t('invite.retry')}</button>
            </div>
          )}
          {crew && crew.clicks > 0 && (
            <div className="pp-person inv-clicks"><Icon name="eye-outline" size={20} /><span className="pp-person-name">{t('invite.clicks', { count: crew.clicks })}</span></div>
          )}
          {crew && (crew.friends.length === 0
            ? <p className="dc-muted pp-pad">{t('invite.noFriends')}</p>
            : crew.friends.map(f => {
              const status = f.status ?? (f.credited ? 'credited' : 'joined')
              const label = status === 'credited' ? t('invite.status.credited', { points: crew.points.friend })
                : status === 'played' ? t('invite.status.played') : t('invite.status.joined')
              return (
                <button key={f.id} type="button" className="pp-person" onClick={() => onOpenProfile(f.id, f.displayName ?? f.username)}>
                  <AvatarWithFlag userId={f.id} displayName={f.displayName ?? f.username} photoUrl={f.photoUrl} size={40} />
                  <span className="inv-friend">
                    <span className="pp-person-name">{f.username ? '@' + f.username : f.displayName}</span>
                    <span className={`inv-status${status === 'credited' ? ' on' : ''}`}>{label}</span>
                  </span>
                  {status === 'credited' && <span aria-hidden="true">✅</span>}
                  <Icon name="chevron-forward" size={18} style={{ color: 'var(--muted2)' }} />
                </button>
              )
            }))}
        </div>

        <p className="dc-muted inv-small">{t('invite.rules', { count: crew?.perSeason ?? max })}</p>
      </div>

      {/* Always in reach: the shortcuts and the big share button. */}
      <div className="inv-footer">
        <div className="inv-shortcuts">
          {shortcuts.map(c => (
            <button key={c} type="button" className={`inv-shortcut inv-shortcut--${c}`} onClick={() => open(c)} disabled={!crew}>
              <span className="inv-shortcut-icon"><Icon name={c === 'whatsapp' ? 'chatbubble-ellipses-outline' : c === 'messenger' ? 'chatbubbles-outline' : copied ? 'checkmark' : 'link-outline'} size={22} /></span>
              <span>{c === 'copy_link' && copied ? t('invite.copied') : t(`invite.channel.${c}`)}</span>
            </button>
          ))}
        </div>
        <button type="button" className="today-cta dc-full btn-primary" onClick={shareMain} disabled={!crew}>
          <Icon name="share-outline" size={18} />{t('invite.share')}
        </button>
      </div>
    </div>
  )
}
