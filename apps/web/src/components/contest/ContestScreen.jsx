import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BackButton from '../BackButton'
import AvatarWithFlag from '../AvatarWithFlag'
import Icon from '../Icon'
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

function shortDate(date, locale) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

/**
 * Launch Season (phase 1, mechanics first), a Passport sub-screen: the prize counter, my
 * score (likes / invites / head start), the friends who count, the contest's own season and
 * final-week rankings, how it works, the rules link; joining (18+, country, rules) inline.
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
    fetchContest().then(d => {
      setData(d)
      if (!d.season) return
      const phase = ['final', 'over'].includes(d.season.phase) ? 'final' : 'season'
      setTab(phase)
      loadRanking(phase)
    }).catch(() => setFailed(true))
  }, [loadRanking])
  useEffect(() => { load(); track('contest_viewed', {}) }, [load])

  const s = data?.season
  const me = data?.me
  const header = (title) => (
    <div className="page-header"><BackButton onClick={joining ? () => setJoining(false) : onBack} /><span className="page-title">{title}</span></div>
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

  const counter = data.counter
  const pct = counter ? Math.min(100, (counter.players / Math.max(1, counter.threshold)) * 100) : 0
  const r = s.rules
  const joined = me?.joined ? me : null
  const pts = joined?.points
  const rank = tab === 'final' ? joined?.finalRank : joined?.seasonRank
  const phaseLine = t(`contest.phase.${s.phase}`, { date: shortDate(s.phase === 'upcoming' ? s.startDate : s.endDate, i18n.language) })

  return (
    <div className="full-page dc-page">
      {header(s.name)}
      <div className="page-body dc-body ls-body">
        <p className="dc-muted">{phaseLine}{s.isTest && <span className="ls-test">{t('contest.test')}</span>}</p>

        {counter && (
          <div className="pp-v2-card">
            <strong className="ls-counter">{t('contest.counter', { count: counter.players, max: counter.threshold })}</strong>
            <div className="pp-v2-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
            <p className="dc-muted">{t('contest.counterHint', { photos: counter.photos, max: counter.threshold })}</p>
          </div>
        )}

        {joined?.disqualified && <div className="pp-v2-card"><p>{t('contest.dq')}</p></div>}
        {joined?.excluded && <div className="pp-v2-card"><p>{t('contest.excluded')}</p></div>}
        {pts && !joined.disqualified && (
          <div className="pp-v2-card">
            <div className="pp-v2-head"><strong>{t('contest.myScore')}</strong><span className="pp-v2-count">{rank ? `#${rank}` : t('contest.notRanked')}</span></div>
            <div className="ls-split">
              <Part label={t('contest.votes')} value={tab === 'final' ? pts.finalVotes : pts.votes} />
              <Part label={t('contest.referral')} value={pts.referral} />
              {tab === 'final' && <Part label={t('contest.headstart')} value={pts.headstart} />}
              <Part label={t('contest.total')} value={tab === 'final' ? pts.final : pts.season} strong />
            </div>
            <p className="dc-muted">{t('contest.photosDays', { photos: joined.photos ?? 0, days: joined.days ?? 0 })}</p>
            {joined.referrals && (
              <div className="ls-referrals">
                <strong>{t('contest.referrals', { active: Math.min(joined.referrals.active, joined.referrals.cap), cap: joined.referrals.cap })}</strong>
                {joined.referrals.friends.map((f, i) => (
                  <div key={(f.username ?? '') + i} className="ls-friend">
                    <span>@{f.username}</span>
                    <span className={`dc-muted${f.status === 'active' ? ' ls-ok' : ''}`}>{t(`contest.friend.${f.status}`, { photos: f.photos, min: joined.referrals.minPhotos })}</span>
                  </div>
                ))}
                <p className="dc-muted">{t('contest.referralsHint', { count: joined.referrals.minPhotos })}</p>
                <button type="button" className="btn-secondary" onClick={onOpenInvite}><Icon name="person-add-outline" size={16} /> {t('contest.inviteCta')}</button>
              </div>
            )}
          </div>
        )}
        {me && me.joined === false && (
          <div className="pp-v2-card">
            <p>{t('contest.joinText')}</p>
            {me.canJoin
              ? <button type="button" className="today-cta dc-full btn-primary" onClick={() => setJoining(true)}><Icon name="rocket-outline" size={18} />{t('contest.join')}</button>
              : <p className="dc-muted">{me.reason === 'closed' ? t('contest.closed') : t('contest.cantJoin')}</p>}
          </div>
        )}
        {!account && (
          <div className="pp-v2-card">
            <p>{t('contest.joinText')}</p>
            <button type="button" className="today-cta dc-full btn-primary" onClick={onSignUp}><Icon name="rocket-outline" size={18} />{t('contest.join')}</button>
          </div>
        )}

        <div className="leaderboard-seg leaderboard-seg--primary" role="tablist">
          {['season', 'final'].map(k => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={`leaderboard-seg-item${tab === k ? ' is-active' : ''}`}
              onClick={() => { setTab(k); loadRanking(k) }}>{t(k === 'season' ? 'contest.tabSeason' : 'contest.tabFinal')}</button>
          ))}
        </div>
        {tab === 'final' && ranking && !ranking.frozen && (
          <p className="dc-muted">{t('contest.finalNotYet', { date: shortDate(s.finalWeekStart, i18n.language), count: r.headstartTopN })}</p>
        )}
        <div className="pp-list">
          {!ranking && <div className="dc-center"><span className="wm-spinner" aria-hidden="true" /></div>}
          {ranking && ranking.rows.length === 0 && <p className="dc-muted pp-pad">{t('contest.empty')}</p>}
          {ranking?.rows.map(row => <RankRow key={row.userId} row={row} me={row.userId === account?.id} t={t} onOpenProfile={onOpenProfile} />)}
          {ranking?.me && !ranking.rows.some(x => x.userId === ranking.me.userId) && <RankRow row={ranking.me} me t={t} onOpenProfile={onOpenProfile} />}
        </div>

        <div className="pp-v2-card">
          <strong>{t('contest.howTitle')}</strong>
          <ul className="ls-how">
            <li>{t('contest.how1')}</li>
            <li>{t('contest.how2', { count: r.voteCap })}</li>
            <li>{t('contest.how3', { points: r.referralPoints, min: r.referralMinPhotos, max: r.referralCap })}</li>
            <li>{t('contest.how4', { count: r.headstartTopN })}</li>
          </ul>
          <a className="ls-link" href={s.rulesUrl.replace('https://hilads.live', '')} target="_blank" rel="noopener">{t('contest.rules')} <Icon name="open-outline" size={14} /></a>
        </div>
      </div>
    </div>
  )
}

function Part({ label, value, strong }) {
  return (
    <span className={`ls-part${strong ? ' strong' : ''}`} aria-label={`${label}: ${value}`}>
      <b>{value}</b><small>{label}</small>
    </span>
  )
}

function RankRow({ row, me, t, onOpenProfile }) {
  const name = row.username ? '@' + row.username : row.displayName ?? ''
  const detail = [row.votes > 0 ? `${t('contest.votes')} ${row.votes}` : null, row.referral > 0 ? `${t('contest.referral')} ${row.referral}` : null,
                  row.headstart > 0 ? `${t('contest.headstart')} ${row.headstart}` : null].filter(Boolean).join(' · ')
  return (
    <button type="button" className={`leaderboard-row leaderboard-row--tappable${me ? ' is-me' : ''}`} onClick={() => onOpenProfile(row.userId, row.displayName ?? row.username)}>
      <span className="leaderboard-rank">{row.rank}</span>
      <AvatarWithFlag userId={row.userId} displayName={row.displayName ?? row.username} photoUrl={row.photoUrl} size={36} />
      <span className="ls-row-body">
        <span className="leaderboard-name">{name}{me ? ` · ${t('contest.youLabel')}` : ''}</span>
        {detail && <span className="dc-muted">{detail}</span>}
      </span>
      <span className="leaderboard-points">{t('contest.pts', { count: row.points })}</span>
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
        <div className="ls-hero" aria-hidden="true">🚀</div>
        <h2 className="ls-title">{season.name}</h2>
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
