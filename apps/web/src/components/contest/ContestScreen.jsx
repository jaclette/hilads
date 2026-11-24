import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BackButton from '../BackButton'
import AvatarWithFlag from '../AvatarWithFlag'
import Icon from '../Icon'
import HalongArt from './HalongArt'
import { fetchContest, fetchContestRanking, joinContest } from '../../api'
import { track } from '../../lib/analytics'

const useT = () => useTranslation('profile', { keyPrefix: 'pp' })

// ISO 3166-1 alpha-2, for the join form's country list (names from Intl in the visitor's language).
const COUNTRIES = ('AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ ' +
  'DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ ' +
  'OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ ' +
  'UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW').split(' ')

function countryName(code, locale) {
  try { return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code } catch { return code }
}

const shortDate = (date, locale) => new Date(`${date}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
const daysLeft = (endDate) => Math.max(0, Math.ceil((new Date(`${endDate}T23:59:59Z`).getTime() - Date.now()) / 86400000))
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Launch Season (the app's /contest), a Passport sub-screen: a boarding pass to the prize
 * (Admin › Launch Season), the players' unlock as a flight path, my score as a departure board,
 * invites as a passport stamp, the season / final-week ranking as a podium, how it works and
 * the rules; joining (18+, country, rules) inline. Visual only: numbers from GET /contest.
 */
export default function ContestScreen({ account, onBack, onOpenProfile, onOpenInvite, onSignUp }) {
  const { t, i18n } = useT()
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState('season')
  const [ranking, setRanking] = useState(null)
  const [joining, setJoining] = useState(false)

  const loadRanking = useCallback((phase) => {
    setRanking(null)
    fetchContestRanking(phase).then(setRanking).catch(() => setFailed(true))
  }, [])
  const load = useCallback(() => {
    setFailed(false)
    fetchContest(i18n.language).then(d => {
      setData(d)
      if (!d.season) return
      const phase = ['final', 'over'].includes(d.season.phase) ? 'final' : 'season'
      setTab(phase)
      loadRanking(phase)
    }).catch(() => setFailed(true))
  }, [loadRanking, i18n.language])
  useEffect(() => { load(); track('contest_viewed', {}) }, [load])

  const s = data?.season
  const me = data?.me
  const header = (title, sub) => (
    <div className="page-header">
      <BackButton onClick={joining ? () => setJoining(false) : onBack} />
      <span className="ls-head"><span className="page-title">{title}</span>{sub && <small>{sub}</small>}</span>
    </div>
  )

  if (failed || !s) {
    return (
      <div className="full-page dc-page">
        {header(t('contest.title'))}
        <div className="page-body dc-body dc-center">
          {failed ? <><p className="dc-muted">{t('contest.error')}</p><button type="button" className="btn-secondary" onClick={load}>{t('contest.retry')}</button></>
            : data ? <p className="dc-muted">{t('contest.closed')}</p> : <span className="wm-spinner" aria-hidden="true" />}
        </div>
      </div>
    )
  }

  if (joining) {
    return <JoinForm season={s} suggested={me?.suggestedCountry} header={header} onDone={() => { setJoining(false); load() }} />
  }

  const r = s.rules
  const prize = { title: s.prize?.title || s.name, subtitle: s.prize?.subtitle ?? '' }
  const final = ['final', 'over'].includes(s.phase)
  const joined = me?.joined ? me : null
  const pts = joined?.points
  const rank = tab === 'final' ? joined?.finalRank : joined?.seasonRank
  const phaseLine = t(`contest.phase.${s.phase}`, { date: shortDate(s.phase === 'upcoming' ? s.startDate : s.endDate, i18n.language) })
  const mine = ranking?.me ?? null
  const above = mine && mine.rank > 1 ? ranking?.rows.find(x => x.rank === mine.rank - 1) : null
  const behind = mine && above ? above.points - mine.points : null

  return (
    <div className="full-page dc-page">
      {header(s.name, phaseLine)}
      <div className="page-body dc-body ls-body">
        {/* The prize: a boarding pass. */}
        <section className="ls-pass" aria-label={`${prize.title}. ${prize.subtitle}`}>
          <div className="ls-pass-art"><HalongArt />{s.isTest && <span className="ls-test ls-test--art">{t('contest.test')}</span>}</div>
          <div className="ls-tear" aria-hidden="true" />
          <div className="ls-pass-body">
            <h1 className="ls-prize">{prize.title}</h1>
            {prize.subtitle && <p className="ls-prize-sub">{prize.subtitle}</p>}
            <div className="ls-meta">
              <span><small>{t('contest.passFinal')}</small><b>{final ? t('contest.passNow') : shortDate(s.finalWeekStart, i18n.language)}</b></span>
              <span><small>{t('contest.passEnds')}</small><b>{shortDate(s.endDate, i18n.language)}</b></span>
              <span><small>{t('contest.passDaysLeft')}</small><b>{daysLeft(s.endDate)}</b></span>
            </div>
            <p className="dc-muted ls-gift">{t('contest.launchGift')}</p>
          </div>
        </section>

        {me && me.joined === false && (
          <div className="pp-v2-card ls-card">
            <p>{t('contest.joinText')}</p>
            {me.canJoin
              ? <button type="button" className="today-cta dc-full btn-primary" onClick={() => setJoining(true)}><Icon name="rocket-outline" size={18} />{t('contest.join')}</button>
              : <p className="dc-muted">{me.reason === 'closed' ? t('contest.closed') : t('contest.cantJoin')}</p>}
          </div>
        )}
        {!account && (
          <div className="pp-v2-card ls-card">
            <p>{t('contest.joinText')}</p>
            <button type="button" className="today-cta dc-full btn-primary" onClick={onSignUp}><Icon name="rocket-outline" size={18} />{t('contest.join')}</button>
          </div>
        )}

        {data.counter && <Unlock {...data.counter} t={t} />}

        {joined?.disqualified && <div className="pp-v2-card ls-card"><p>{t('contest.dq')}</p></div>}
        {joined?.excluded && <div className="pp-v2-card ls-card"><p>{t('contest.excluded')}</p></div>}

        {/* My score: a departure board. */}
        {pts && !joined.disqualified && (
          <section className="ls-board">
            <div className="ls-board-head">
              <strong>{t(tab === 'final' ? 'contest.myFinalScore' : 'contest.myScore')}</strong>
              {rank ? <span className="ls-tag"><i />#{rank}</span> : <small>{t('contest.notRanked')}</small>}
            </div>
            <div className="ls-tiles">
              <Tile label={t('contest.votes')} value={tab === 'final' ? pts.finalVotes : pts.votes} />
              <Tile label={t('contest.referral')} value={pts.referral} />
              {tab === 'final' && <Tile label={t('contest.headstart')} value={pts.headstart} />}
              <Tile label={t('contest.total')} value={tab === 'final' ? pts.final : pts.season} total />
            </div>
            <small>
              {t('contest.photosDays', { photos: joined.photos ?? 0, days: joined.days ?? 0 })}
              {behind !== null && above ? ` · ${t('contest.behind', { count: behind, rank: above.rank })}` : ''}
            </small>
          </section>
        )}

        {/* Invites: a passport stamp. */}
        {joined?.referrals && !joined.disqualified && (
          <div className="pp-v2-card ls-card">
            <div className="ls-invite">
              <span className="ls-stamp" aria-hidden="true"><b>+{r.referralPoints}</b><small>{t('contest.inviteStamp')}</small></span>
              <span><strong>{t('contest.inviteTitle')}</strong><span className="dc-muted">{t('contest.inviteText', { points: r.referralPoints, count: r.referralMinPhotos })}</span></span>
            </div>
            <div className="ls-segments" aria-hidden="true">
              {Array.from({ length: Math.min(joined.referrals.cap, 20) }).map((_, i) => <i key={i} className={i < joined.referrals.active ? 'on' : ''} />)}
            </div>
            <p className="dc-muted">{t('contest.inviteProgress', { active: Math.min(joined.referrals.active, joined.referrals.cap), cap: joined.referrals.cap })}</p>
            {joined.referrals.friends.map((f, i) => (
              <div key={(f.username ?? '') + i} className="ls-friend">
                <span>@{f.username}</span>
                <span className={`dc-muted${f.status === 'active' ? ' ls-ok' : ''}`}>{t(`contest.friend.${f.status}`, { photos: f.photos, min: joined.referrals.minPhotos })}</span>
              </div>
            ))}
            <button type="button" className="today-cta dc-full btn-primary" onClick={onOpenInvite}><Icon name="person-add-outline" size={18} />{t('contest.inviteCta')}</button>
          </div>
        )}

        {/* The contest's own ranking: a podium, then the list. */}
        <div className="leaderboard-seg leaderboard-seg--primary" role="tablist">
          {['season', 'final'].map(k => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={`leaderboard-seg-item${tab === k ? ' is-active' : ''}`}
              onClick={() => { setTab(k); loadRanking(k) }}>{t(k === 'season' ? 'contest.tabSeason' : 'contest.tabFinal')}</button>
          ))}
        </div>
        {tab === 'final' && ranking && !ranking.frozen && (
          <p className="dc-muted">{t('contest.finalNotYet', { date: shortDate(s.finalWeekStart, i18n.language), count: r.headstartTopN })}</p>
        )}
        <div className="pp-v2-card ls-card">
          {!ranking && <div className="dc-center"><span className="wm-spinner" aria-hidden="true" /></div>}
          {ranking && ranking.rows.length === 0 && <p className="dc-muted">{t('contest.empty')}</p>}
          {ranking && ranking.rows.length > 0 && <Podium rows={ranking.rows.slice(0, 3)} meId={account?.id} t={t} onOpenProfile={onOpenProfile} />}
          {ranking?.rows.slice(3).map(row => <RankRow key={row.userId} row={row} me={row.userId === account?.id} t={t} onOpenProfile={onOpenProfile} />)}
          {ranking?.me && !ranking.rows.some(x => x.userId === ranking.me.userId) && <RankRow row={ranking.me} me t={t} onOpenProfile={onOpenProfile} />}
        </div>

        <div className="pp-v2-card ls-card">
          <strong>{t('contest.howTitle')}</strong>
          <ul className="ls-how">
            <li><Icon name="camera-outline" size={20} /><span>{t('contest.how1')}</span></li>
            <li><Icon name="heart-outline" size={20} /><span>{t('contest.how2', { count: r.voteCap })}</span></li>
            <li><Icon name="people-outline" size={20} /><span>{t('contest.how3', { points: r.referralPoints, min: r.referralMinPhotos, max: r.referralCap })}</span></li>
            <li><Icon name="flag-outline" size={20} /><span>{t('contest.how4', { count: r.headstartTopN })}</span></li>
          </ul>
          <a className="ls-link" href={s.rulesUrl.replace('https://hilads.live', '')} target="_blank" rel="noopener">{t('contest.rules')} <Icon name="open-outline" size={14} /></a>
        </div>
      </div>
    </div>
  )
}

/** "212 / 500 players" and the plane flying along the route to the prize (once). */
function Unlock({ players, threshold, photos, t }) {
  const pct = Math.min(1, players / Math.max(1, threshold))
  const [w, setW] = useState(reduced() ? pct : 0)
  useEffect(() => { const id = setTimeout(() => setW(pct), reduced() ? 0 : 60); return () => clearTimeout(id) }, [pct])
  return (
    <div className="pp-v2-card ls-card">
      <p className="ls-unlock"><b>{players} / {threshold}</b> <span>{t('contest.unlockPlayers')}</span></p>
      <div className="ls-flight" aria-hidden="true">
        <span>🏙️</span>
        <span className="ls-flight-track"><i className="ls-flight-done" style={{ width: `${w * 100}%` }} /><span className="ls-plane" style={{ left: `${w * 100}%` }}><Icon name="airplane-outline" size={22} /></span></span>
        <span>🎁</span>
      </div>
      <p className="dc-muted">{players >= threshold ? t('contest.unlocked') : t('contest.unlockHint', { max: threshold, photos })}</p>
    </div>
  )
}

function Tile({ label, value, total }) {
  return <span className={`ls-tile${total ? ' total' : ''}`}><b>{value}</b><small>{label}</small></span>
}

function Podium({ rows, meId, t, onOpenProfile }) {
  const order = [rows[1], rows[0], rows[2]]
  const cls = ['gold', 'silver', 'bronze']
  return (
    <div className="ls-podium">
      {order.map((row, i) => {
        if (!row) return <span key={i} />
        const place = row.rank - 1
        const name = row.username ? '@' + row.username : row.displayName ?? ''
        return (
          <button key={row.userId} type="button" className={`ls-step ${cls[place] ?? ''}${place === 0 ? ' first' : ''}`} onClick={() => onOpenProfile(row.userId, row.displayName ?? row.username)}
            aria-label={`#${row.rank} ${name}, ${t('contest.pts', { count: row.points })}`}>
            {place === 0 && <svg className="ls-crown" width="26" height="21" viewBox="0 0 30 24" aria-hidden="true"><path d="M3 8.5 L8.5 14 L15 4.5 L21.5 14 L27 8.5 L25 21 L5 21 Z" fill="var(--medal-gold)" stroke="var(--on-medal)" strokeWidth="1.8" strokeLinejoin="round" /><circle cx="3" cy="7.5" r="2.2" fill="var(--medal-gold)" stroke="var(--on-medal)" strokeWidth="1.5" /><circle cx="15" cy="3.5" r="2.2" fill="var(--medal-gold)" stroke="var(--on-medal)" strokeWidth="1.5" /><circle cx="27" cy="7.5" r="2.2" fill="var(--medal-gold)" stroke="var(--on-medal)" strokeWidth="1.5" /></svg>}
            <span className="ls-ring"><AvatarWithFlag userId={row.userId} displayName={row.displayName ?? row.username} photoUrl={row.photoUrl} size={place === 0 ? 58 : 48} /></span>
            <span className="ls-step-name">{name}</span>
            <span className="dc-muted">{t('contest.pts', { count: row.points })}</span>
            {row.userId === meId && <span className="ls-you">{t('contest.youLabel')}</span>}
            <span className="ls-block">{row.rank}</span>
          </button>
        )
      })}
    </div>
  )
}

function RankRow({ row, me, t, onOpenProfile }) {
  const name = row.username ? '@' + row.username : row.displayName ?? ''
  const detail = [row.votes > 0 ? `${t('contest.votes')} ${row.votes}` : null, row.referral > 0 ? `${t('contest.referral')} ${row.referral}` : null,
                  row.headstart > 0 ? `${t('contest.headstart')} ${row.headstart}` : null].filter(Boolean).join(' · ')
  return (
    <button type="button" className={`ls-row${me ? ' is-me' : ''}`} onClick={() => onOpenProfile(row.userId, row.displayName ?? row.username)}>
      <span className="ls-row-n">{row.rank}</span>
      <AvatarWithFlag userId={row.userId} displayName={row.displayName ?? row.username} photoUrl={row.photoUrl} size={38} />
      <span className="ls-row-body">
        <span className="ls-row-name">{name}{me && <span className="ls-you">{t('contest.youLabel')}</span>}</span>
        {detail && <span className="dc-muted">{detail}</span>}
      </span>
      <b className="ls-row-pts">{row.points}</b>
    </button>
  )
}

function JoinForm({ season, suggested, header, onDone }) {
  const { t, i18n } = useT()
  const [age, setAge] = useState(false)
  const [rules, setRules] = useState(false)
  const [country, setCountry] = useState(suggested && COUNTRIES.includes(suggested) ? suggested : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const options = useMemo(() => COUNTRIES.map(c => ({ code: c, label: countryName(c, i18n.language) }))
    .sort((a, b) => a.label.localeCompare(b.label, i18n.language)), [i18n.language])
  const ready = age && rules && country && !busy

  const submit = async () => {
    if (!ready) return
    setBusy(true); setError(null)
    try {
      await joinContest(season.id, country)
      track('contest_joined', { test: season.isTest })
      onDone()
    } catch (e) {
      setError(e.message === 'closed' ? t('contest.closed') : t('contest.cantJoin'))
    } finally { setBusy(false) }
  }

  return (
    <div className="full-page dc-page">
      {header(t('contest.join'))}
      <div className="page-body dc-body ls-body">
        <section className="ls-pass">
          <div className="ls-pass-art ls-pass-art--short"><HalongArt />{season.isTest && <span className="ls-test ls-test--art">{t('contest.test')}</span>}</div>
          <div className="ls-pass-body"><h1 className="ls-prize">{season.prize?.title || season.name}</h1>{season.prize?.subtitle && <p className="ls-prize-sub">{season.prize.subtitle}</p>}</div>
        </section>
        <p>{t('contest.joinText')}</p>
        <div className="pp-v2-card ls-form">
          <label className="ls-check"><input type="checkbox" checked={age} onChange={e => setAge(e.target.checked)} /> {t('contest.age')}</label>
          <label className="ls-field">{t('contest.country')}
            <select value={country} onChange={e => setCountry(e.target.value)}>
              <option value="">{t('contest.countryPick')}</option>
              {options.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>
          </label>
          <label className="ls-check"><input type="checkbox" checked={rules} onChange={e => setRules(e.target.checked)} /> {t('contest.accept')}</label>
          <a className="ls-link" href={season.rulesUrl.replace('https://hilads.live', '')} target="_blank" rel="noopener">{t('contest.rules')} <Icon name="open-outline" size={14} /></a>
        </div>
        {error && <p className="ls-error">{error}</p>}
      </div>
      <div className="inv-footer">
        <button type="button" className="today-cta dc-full btn-primary" disabled={!ready} onClick={submit}><Icon name="rocket-outline" size={18} />{t('contest.join')}</button>
      </div>
    </div>
  )
}
