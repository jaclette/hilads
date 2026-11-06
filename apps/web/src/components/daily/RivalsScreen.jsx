import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BackButton from '../BackButton'
import { fetchRivalFaceoff } from '../../api'
import { shortCityName } from '../../i18n/cityName'
import { track } from '../../lib/analytics'
import { shareLink } from '../../lib/shareLink'
import { thumbUrl } from '../../lib/imageThumb'
import AvatarWithFlag from '../AvatarWithFlag'
import { FlagSticker, themeColor } from '../joy/Joy'
import { themeName } from '../map/spotsShared'
import { CountUp, Confetti } from '../ranks/parts'
import { getLastToday, useDaily, useDc } from './dailyShared'

const tint = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})` }

/**
 * A face-off (V6, Passport › Your rivals, as in the app): "You vs Berlin".
 * Me and the city facing each other with a VS badge and the score (a duel is
 * won by the photo with more likes), confetti when I lead, a "send them a
 * challenge" card when that city hasn't played today, then every shared
 * challenge newest first: my photo vs their best, the winner crowned.
 */
export default function RivalsScreen({ city, user = null, onBack }) {
  const { t, i18n } = useDc()
  const { t: tc } = useTranslation('common')
  const { account, openDaily } = useDaily()
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
  const [party, setParty] = useState(false)
  const [copied, setCopied] = useState(false)
  const userId = user ?? account?.id ?? null
  const today = getLastToday()

  useEffect(() => {
    if (!userId || !city) return undefined
    let alive = true
    fetchRivalFaceoff(userId, city, i18n.language).then(d => {
      if (!alive) return
      setData(d)
      track('rivals_opened', { city: d.city.name, duels: d.duels.length, platform_surface: 'web' })
      if (d.score.me > d.score.them) setParty(true)
    }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [userId, city, i18n.language])

  const rival = data ? shortCityName(data.city.name) : ''
  const me = data?.score.me ?? 0
  const them = data?.score.them ?? 0
  const mood = me > them ? t('rivals.leading') : me < them ? t('rivals.behind', { city: rival }) : t('rivals.tied')
  const open = (duel, p) => openDaily('photos', { list: [duel.mine, duel.theirs], proofId: p.id, source: 'rivals' })
  const send = async () => {
    track('rival_challenge_shared', { city: data.city.name, platform_surface: 'web' })
    const res = await shareLink({ type: 'today', path: '/today', text: tc('shareLink.textToday', { challenge: today.challenge.text }), source: 'rivals' })
    if (res === 'copied') { setCopied(true); setTimeout(() => setCopied(false), 1800) }
  }

  return (
    <div className="full-page dc-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{data ? t('rivals.title', { city: rival }) : ''}</span>
      </div>
      <div className="page-body dc-body rv-body">
        {!data ? (
          <div className="rv-center">{failed ? <p className="rv-mood">{t('loadFailed')}</p> : <span className="r6-spinner" aria-hidden="true" />}</div>
        ) : (
          <>
            <div className="rv-versus">
              <Confetti run={party} />
              <div className="rv-side">
                {account
                  ? <AvatarWithFlag displayName={account.display_name ?? ''} photoUrl={account.thumbAvatarUrl ?? account.profile_photo_url ?? null} size={64} />
                  : <FlagSticker country={today?.city?.country} size={64} />}
                <span className="rv-name">{t('rivals.you')}</span>
                {me > them && <span className="rv-trophy">🏆</span>}
              </div>
              <div className="rv-mid">
                <span className="rv-vs">VS</span>
                <span className="rv-score"><CountUp value={me} /><span className="rv-dash">–</span><CountUp value={them} /></span>
              </div>
              <div className="rv-side">
                <FlagSticker country={data.city.country} size={64} />
                <span className="rv-name">{rival}</span>
                {them > me && <span className="rv-trophy">🏆</span>}
              </div>
            </div>
            <p className="rv-mood">{mood}</p>

            {!data.playedToday && today?.challenge?.isActive && (
              <div className="rv-nudge" style={{ background: tint(themeColor('get_around').fill, 0.18) }}>
                <span>{t('rivals.notToday', { city: rival })}</span>
                <button type="button" className="rv-send" onClick={send}>📣 {copied ? tc('shareLink.copied') : t('rivals.send')}</button>
              </div>
            )}
            {data.duels.length > 0 && <span className="rv-section">{t('rivals.duels', { count: data.duels.length })}</span>}
            {data.duels.length === 0 && <p className="rv-empty">{t('rivals.empty', { city: rival })}</p>}
            {data.duels.map(d => (
              <div key={d.date} className="rv-duel">
                <span className="rv-duel-text">{d.challenge.text}</span>
                {d.challenge.theme && (
                  <span className="rv-theme" style={{ background: tint(themeColor(d.challenge.theme).fill, 0.25) }}>{themeName(d.challenge.theme)}</span>
                )}
                <div className="rv-pair">
                  <DuelPhoto proof={d.mine} label={t('rivals.yours')} win={d.winner === 'me'} onClick={() => open(d, d.mine)} />
                  <DuelPhoto proof={d.theirs} label={t('rivals.theirBest', { city: rival })} win={d.winner === 'them'} onClick={() => open(d, d.theirs)} />
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function DuelPhoto({ proof, label, win, onClick }) {
  return (
    <button type="button" className={`rv-photo${win ? ' rv-photo--win' : ''}`} onClick={onClick}
            aria-label={`${label}, ${proof.voteCount} ❤️${win ? ', 👑' : ''}`}>
      <img src={thumbUrl(proof.thumbUrl ?? proof.photoUrl)} alt="" loading="lazy" />
      {win && <span className="rv-crown">👑</span>}
      <span className="rv-foot"><span className="rv-label">{label}</span><span className="rv-likes">{proof.voteCount} ❤️</span></span>
    </button>
  )
}
