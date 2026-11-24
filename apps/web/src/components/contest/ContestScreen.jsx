import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BackButton from '../BackButton'
import AvatarWithFlag from '../AvatarWithFlag'
import Icon from '../Icon'
import HalongArt from './HalongArt'
import { fetchContest, fetchContestRanking, fetchCrew, joinContest } from '../../api'
import { shareLink } from '../../lib/shareLink'
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
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** The countdown of a season's phase: start (take-off), final week, end. */
export function countdownTarget(s) {
  const pick = s.phase === 'upcoming' ? { at: Date.parse(s.startsAt ?? ''), label: 'cdStarts' }
    : s.phase === 'season' ? { at: Date.parse(s.finalAt ?? ''), label: 'cdFinal' }
    : s.phase === 'final' ? { at: Date.parse(s.endsAt ?? ''), label: 'cdEnds' } : null
  return pick && Number.isFinite(pick.at) ? pick : null
}

export function useNow(ms) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(id) }, [ms])
  return now
}

export function shortLeft(msLeft, t) {
  const m = Math.max(0, Math.floor(msLeft / 60000))
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60
  if (d > 0) return t('contest.dur.dh', { d, h })
  if (h > 0) return t('contest.dur.hm', { h, m: mm })
  return t('contest.dur.m', { m: Math.max(1, mm) })
}

function CountdownBoard({ target }) {
  const { t } = useT()
  const now = useNow(1000)
  const left = Math.max(0, Math.floor((target.at - now) / 1000))
  const parts = [[Math.floor(left / 86400), t('contest.cdDays')], [Math.floor((left % 86400) / 3600), t('contest.cdHours')],
                 [Math.floor((left % 3600) / 60), t('contest.cdMin')], [left % 60, t('contest.cdSec')]]
  return (
    <div className="ls-countdown" role="timer" aria-label={`${t(`contest.${target.label}`)} ${shortLeft(target.at - now, t)}`}>
      <small>{t(`contest.${target.label}`)}</small>
      <div className="ls-tiles">{parts.map(([v, u], i) => <span key={i} className="ls-tile"><b>{String(v).padStart(2, '0')}</b><small>{u}</small></span>)}</div>
    </div>
  )
}

/** Share: my invite link (a friend who joins counts for me) and the line; the web shares the link. */
function useShare(data, account) {
  const { t } = useT()
  return async () => {
    const s = data?.season
    if (!s) return
    let path = '/today'
    if (account) { try { path = `/today?ref=${(await fetchCrew()).code}` } catch { /* plain link */ } }
    path += `${path.includes('?') ? '&' : '?'}utm_campaign=launch_season`
    const me = data.me?.joined ? data.me : null
    const final = ['final', 'over'].includes(s.phase)
    const rank = final ? me?.finalRank : me?.seasonRank
    const prize = s.prize?.title || s.name
    shareLink({ type: 'contest', path, source: 'launch_season',
      text: rank ? t('contest.shareRank', { rank, prize }) : t('contest.shareJoin', { prize }) })
  }
}

/** "How to win": the 3 steps of a season (a ranking, never a draw). */
function HowToWin({ s }) {
  const { t, i18n } = useT()
  const r = s.rules
  const steps = [
    ['camera-outline', t('contest.step1Title', { date: shortDate(s.finalWeekStart, i18n.language) }), t('contest.step1Text', { cap: r.voteCap, points: r.referralPoints, min: r.referralMinPhotos })],
    ['podium-outline', t('contest.step2Title', { count: r.headstartTopN }), t('contest.step2Text', { count: r.headstartTopN, date: shortDate(s.finalWeekStart, i18n.language) })],
    ['trophy-outline', t('contest.step3Title'), t('contest.step3Text', { date: shortDate(s.endDate, i18n.language) })],
  ]
  return (
    <ol className="ls-steps">
      {steps.map(([icon, title, text], i) => (
        <li key={i} className={i === 2 ? 'win' : ''}>
          <span className="ls-step-num">{i + 1}</span>
          <span className="ls-step-body"><strong><Icon name={icon} size={16} /> {title}</strong><span>{text}</span></span>
        </li>
      ))}
    </ol>
  )
}

/** "Your week in Vietnam": the sample itinerary as a timeline (Admin › Launch Season). */
function SampleItinerary({ days }) {
  const { t } = useT()
  if (!days?.length) return null
  return (
    <section className="ls-trip">
      <h2>{t('contest.itTitle')}</h2>
      <p className="dc-muted ls-trip-sample"><Icon name="information-circle-outline" size={16} /> {t('contest.itSample')}</p>
      <ol className="ls-timeline">
        {days.map(d => (
          <li key={d.day}>
            <span className="ls-tl-dot" aria-hidden="true" />
            <article className="ls-tl-card">
              {d.photo && <figure><img src={d.photo.url} alt="" loading="lazy" />{d.photo.credit && <figcaption>© {d.photo.credit}</figcaption>}</figure>}
              <div><small>{t('contest.itDay', { n: d.day })}</small><strong>{d.title}</strong>{d.text && <p>{d.text}</p>}</div>
            </article>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** "A word from the founder" (Admin › Launch Season). */
function FounderWord({ f }) {
  const { t } = useT()
  return (
    <section className="ls-founder">
      <h2>{t('contest.founderTitle')}</h2>
      <blockquote>“{f.message}”</blockquote>
      <div className="ls-founder-sign">
        <AvatarWithFlag userId={null} displayName={f.name} photoUrl={f.photo?.url ?? null} size={52} />
        <span><strong>{f.name}</strong><small>{f.role || t('contest.founderRole')}</small></span>
      </div>
    </section>
  )
}

/** The head start a ranking row brings into the final week (season: what its rank would earn; final: what it has). */
const bonusOf = (row, tab, topN) => tab === 'final' ? row.headstart : row.points > 0 && row.rank <= topN ? topN - row.rank + 1 : 0

/** The season's photos (Admin › Launch Season › Photos) with page dots, else the illustration. */
function PrizePhotos({ photos, children, short }) {
  const [page, setPage] = useState(0)
  const cur = photos?.[page]
  return (
    <div className={`ls-photos${short ? ' ls-photos--short' : ''}`}>
      {photos?.length ? (
        <div className="ls-photos-track" onScroll={e => setPage(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}>
          {photos.map((p, i) => <img key={p.url + i} src={p.url} alt={p.caption || ''} loading={i ? 'lazy' : 'eager'} />)}
        </div>
      ) : <HalongArt />}
      <div className="ls-photos-shade" aria-hidden="true" />
      <div className="ls-photos-bottom">
        {children}
        {photos?.length > 1 && <span className="ls-dots" aria-hidden="true">{photos.map((_, i) => <i key={i} className={i === page ? 'on' : ''} />)}</span>}
        {cur && (cur.caption || cur.credit) && <small className="ls-credit">{[cur.caption, cur.credit ? `© ${cur.credit}` : ''].filter(Boolean).join(' · ')}</small>}
      </div>
    </div>
  )
}

function useContest() {
  const { i18n } = useT()
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
  const load = useCallback(() => {
    setFailed(false)
    fetchContest(i18n.language).then(setData).catch(() => setFailed(true))
  }, [i18n.language])
  useEffect(() => { load() }, [load])
  return { data, failed, load }
}

function Header({ title, sub, onBack }) {
  return (
    <div className="page-header">
      <BackButton onClick={onBack} />
      <span className="ls-head"><span className="page-title">{title}</span>{sub && <small>{sub}</small>}</span>
    </div>
  )
}

function Empty({ data, failed, load, onBack }) {
  const { t } = useT()
  return (
    <div className="full-page dc-page">
      <Header title={t('contest.title')} onBack={onBack} />
      <div className="page-body dc-body dc-center">
        {failed ? <><p className="dc-muted">{t('contest.error')}</p><button type="button" className="btn-secondary" onClick={load}>{t('contest.retry')}</button></>
          : data ? <p className="dc-muted">{t('contest.closed')}</p> : <span className="wm-spinner" aria-hidden="true" />}
      </div>
    </div>
  )
}

/**
 * The Launch Season's prize (the app's /contest-prize): the real photos, the prize and its
 * description, the countdown, the dates, the launch-gift line, the rules, Share; a sticky Join
 * (or "You're in", to the home).
 */
export function ContestPrize({ account, onBack, onOpenHome, onSignUp }) {
  const { t, i18n } = useT()
  const { data, failed, load } = useContest()
  const [joining, setJoining] = useState(false)
  const share = useShare(data, account)
  useEffect(() => { track('contest_prize_viewed', {}) }, [])
  const s = data?.season
  if (!s) return <Empty data={data} failed={failed} load={load} onBack={onBack} />
  if (joining) return <JoinForm season={s} suggested={data.me?.suggestedCountry} onBack={() => setJoining(false)} onDone={() => { setJoining(false); onOpenHome() }} />
  const me = data.me
  const target = countdownTarget(s)
  const final = ['final', 'over'].includes(s.phase)
  const cta = !account ? { label: t('contest.join'), go: onSignUp }
    : me?.joined ? { label: t('contest.prizeYoureIn'), go: onOpenHome }
    : me?.canJoin ? { label: t('contest.join'), go: () => setJoining(true) } : null
  return (
    <div className="full-page dc-page ls-prize-page">
      <div className="page-body dc-body ls-body ls-body--flush">
        <div className="ls-prize-top">
          <BackButton onClick={onBack} />
          {s.isTest && <span className="ls-test">{t('contest.test')}</span>}
        </div>
        <PrizePhotos photos={s.photos}>
          <small className="ls-kicker">{s.name}</small>
          <h1 className="ls-photo-title">{s.prize?.title || s.name}</h1>
          <p className="ls-photo-win">🏆 {t('contest.winLine')}</p>
        </PrizePhotos>
        <div className="ls-prize-body">
          {s.prize?.subtitle && <p className="ls-prize-sub">{s.prize.subtitle}</p>}
          {s.prize?.description && <p className="ls-desc">{s.prize.description}</p>}
          {target && <CountdownBoard target={target} />}
          <div className="ls-meta-boxes">
            <span><small>{t('contest.passFinal')}</small><b>{final ? t('contest.passNow') : shortDate(s.finalWeekStart, i18n.language)}</b></span>
            <span><small>{t('contest.passEnds')}</small><b>{shortDate(s.endDate, i18n.language)}</b></span>
          </div>
          <section className="pp-v2-card ls-card ls-howwin"><strong className="ls-howwin-title">{t('contest.howWinTitle')}</strong><HowToWin s={s} /></section>
          <SampleItinerary days={s.itinerary} />
          {s.founder && <FounderWord f={s.founder} />}
          <p className="ls-giftline"><Icon name="gift-outline" size={18} /> {t('contest.launchGift')}</p>
          <div className="ls-links">
            <a className="ls-link" href={s.rulesUrl.replace('https://hilads.live', '')} target="_blank" rel="noopener">{t('contest.rules')} <Icon name="open-outline" size={14} /></a>
            <button type="button" className="ls-link ls-link-btn" onClick={share}><Icon name="share-outline" size={16} /> {t('contest.share')}</button>
          </div>
        </div>
      </div>
      {cta && <div className="inv-footer"><button type="button" className="today-cta dc-full btn-primary" onClick={cta.go}><Icon name={me?.joined ? 'trophy-outline' : 'rocket-outline'} size={18} />{cta.label}</button></div>}
    </div>
  )
}

/**
 * Launch Season home (the app's /contest), the essentials: the prize in one row, the countdown,
 * the unlock, my score + Share, the invites, the top 3 + "See full ranking", How it works / Rules.
 */
export default function ContestScreen({ account, onBack, onOpenProfile, onOpenInvite, onSignUp, onOpenPrize, onOpenRanking }) {
  const { t, i18n } = useT()
  const { data, failed, load } = useContest()
  const [ranking, setRanking] = useState(null)
  const [joining, setJoining] = useState(false)
  const [how, setHow] = useState(false)
  const share = useShare(data, account)
  const s = data?.season
  const final = s ? ['final', 'over'].includes(s.phase) : false
  useEffect(() => { track('contest_viewed', {}) }, [])
  useEffect(() => { if (s) fetchContestRanking(final ? 'final' : 'season').then(setRanking).catch(() => {}) }, [s, final])

  if (!s) return <Empty data={data} failed={failed} load={load} onBack={onBack} />
  if (joining) return <JoinForm season={s} suggested={data.me?.suggestedCountry} onBack={() => setJoining(false)} onDone={() => { setJoining(false); load() }} />

  const r = s.rules
  const me = data.me
  const joined = me?.joined ? me : null
  const pts = joined?.points
  const rank = final ? joined?.finalRank : joined?.seasonRank
  const target = countdownTarget(s)
  const phaseLine = t(`contest.phase.${s.phase}`, { date: shortDate(s.phase === 'upcoming' ? s.startDate : s.endDate, i18n.language) })
  const mine = ranking?.me ?? null
  const above = mine && mine.rank > 1 ? ranking?.rows.find(x => x.rank === mine.rank - 1) : null
  const behind = mine && above ? above.points - mine.points : null

  return (
    <div className="full-page dc-page">
      <Header title={s.name} sub={phaseLine} onBack={onBack} />
      <div className="page-body dc-body ls-body">
        <button type="button" className="ls-prize-row" onClick={onOpenPrize}>
          <span className="ls-prize-row-art">{s.photos?.[0] ? <img src={s.photos[0].url} alt="" /> : <HalongArt />}</span>
          <span className="ls-prize-row-body"><strong>{s.prize?.title || s.name}</strong><span className="ls-prize-row-win">{t('contest.winLine')}</span><small>{t('contest.seePrize')}</small></span>
          {s.isTest && <span className="ls-test">{t('contest.test')}</span>}
          <Icon name="chevron-forward" size={18} />
        </button>

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

        {target && <CountdownBoard target={target} />}
        {data.counter && <Unlock {...data.counter} t={t} />}

        {joined?.disqualified && <div className="pp-v2-card ls-card"><p>{t('contest.dq')}</p></div>}
        {joined?.excluded && <div className="pp-v2-card ls-card"><p>{t('contest.excluded')}</p></div>}

        {pts && !joined.disqualified && (
          <section className="ls-board">
            <div className="ls-board-head">
              <strong>{t(final ? 'contest.myFinalScore' : 'contest.myScore')}</strong>
              {rank ? <span className="ls-tag"><i />#{rank}</span> : <small>{t('contest.notRanked')}</small>}
            </div>
            <div className="ls-tiles">
              <Tile label={t('contest.votes')} value={final ? pts.finalVotes : pts.votes} />
              <Tile label={t('contest.referral')} value={pts.referral} />
              {final && <Tile label={t('contest.headstart')} value={pts.headstart} />}
              <Tile label={t('contest.total')} value={final ? pts.final : pts.season} total />
            </div>
            <div className="ls-board-foot">
              <small>{t('contest.photosDays', { photos: joined.photos ?? 0, days: joined.days ?? 0 })}{behind !== null && above ? ` · ${t('contest.behind', { count: behind, rank: above.rank })}` : ''}</small>
              <button type="button" className="ls-share-btn" onClick={share}><Icon name="share-outline" size={14} />{t('contest.share')}</button>
            </div>
          </section>
        )}

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
            {joined.referrals.friends.slice(0, 3).map((f, i) => (
              <div key={(f.username ?? '') + i} className="ls-friend">
                <span>@{f.username}</span>
                <span className={`dc-muted${f.status === 'active' ? ' ls-ok' : ''}`}>{t(`contest.friend.${f.status}`, { photos: f.photos, min: joined.referrals.minPhotos })}</span>
              </div>
            ))}
            <button type="button" className="today-cta dc-full btn-primary" onClick={onOpenInvite}><Icon name="person-add-outline" size={18} />{t('contest.inviteCta')}</button>
          </div>
        )}

        <div className="pp-v2-card ls-card">
          <strong>{t(final ? 'contest.tabFinal' : 'contest.tabSeason')}</strong>
          {!ranking ? <div className="dc-center"><span className="wm-spinner" aria-hidden="true" /></div>
            : ranking.rows.length === 0 ? <p className="dc-muted">{t('contest.empty')}</p> : (
              <>
                <Podium rows={ranking.rows.slice(0, 3)} meId={account?.id} t={t} onOpenProfile={onOpenProfile} bonusFor={row => bonusOf(row, final ? 'final' : 'season', r.headstartTopN)} />
                {mine && mine.rank > 3 && <RankRow row={mine} me t={t} onOpenProfile={onOpenProfile} bonus={bonusOf(mine, final ? 'final' : 'season', r.headstartTopN)} />}
              </>
            )}
          <button type="button" className="ls-see-all" onClick={() => onOpenRanking(final ? 'final' : 'season')}>{t('contest.seeRanking')} <Icon name="chevron-forward" size={16} /></button>
        </div>

        <div className="ls-links ls-links--center">
          <button type="button" className="ls-link ls-link-btn" onClick={() => setHow(v => !v)} aria-expanded={how}><Icon name="help-circle-outline" size={16} /> {t('contest.howWinTitle')}</button>
          <a className="ls-link" href={s.rulesUrl.replace('https://hilads.live', '')} target="_blank" rel="noopener">{t('contest.rulesShort')} <Icon name="open-outline" size={14} /></a>
        </div>
        {how && <div className="pp-v2-card ls-card"><HowToWin s={s} /></div>}
      </div>
    </div>
  )
}

/** The full ranking (the app's /contest-ranking): Season / Final week, podium, everyone, my row pinned. */
export function ContestRanking({ account, onBack, onOpenProfile, initialTab = 'season' }) {
  const { t, i18n } = useT()
  const { data } = useContest()
  const [tab, setTab] = useState(initialTab)
  const [ranking, setRanking] = useState(null)
  useEffect(() => { setRanking(null); fetchContestRanking(tab).then(setRanking).catch(() => setRanking({ rows: [], me: null, frozen: true })) }, [tab])
  useEffect(() => { track('contest_ranking_viewed', { tab }) }, [tab])
  const s = data?.season
  const topN = s?.rules.headstartTopN ?? 0
  return (
    <div className="full-page dc-page">
      <Header title={t('contest.rankingTitle')} sub={s?.name} onBack={onBack} />
      <div className="page-body dc-body ls-body">
        <div className="leaderboard-seg leaderboard-seg--primary" role="tablist">
          {['season', 'final'].map(k => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={`leaderboard-seg-item${tab === k ? ' is-active' : ''}`}
              onClick={() => setTab(k)}>{t(k === 'season' ? 'contest.tabSeason' : 'contest.tabFinal')}</button>
          ))}
        </div>
        {tab === 'final' && ranking && !ranking.frozen && s && (
          <p className="dc-muted">{t('contest.finalNotYet', { date: shortDate(s.finalWeekStart, i18n.language), count: s.rules.headstartTopN })}</p>
        )}
        {tab === 'season' && s && s.rules.headstartTopN > 0 && <p className="dc-muted">{t('contest.hsHint', { count: s.rules.headstartTopN })}</p>}
        <div className="pp-v2-card ls-card">
          {!ranking && <div className="dc-center"><span className="wm-spinner" aria-hidden="true" /></div>}
          {ranking && ranking.rows.length === 0 && <p className="dc-muted">{t('contest.empty')}</p>}
          {ranking && ranking.rows.length > 0 && <Podium rows={ranking.rows.slice(0, 3)} meId={account?.id} t={t} onOpenProfile={onOpenProfile} bonusFor={row => bonusOf(row, tab, topN)} />}
          {ranking?.rows.slice(3).map(row => <RankRow key={row.userId} row={row} me={row.userId === account?.id} t={t} onOpenProfile={onOpenProfile} bonus={bonusOf(row, tab, topN)} />)}
        </div>
      </div>
      {ranking?.me && <div className="ls-pinned"><RankRow row={ranking.me} me t={t} onOpenProfile={onOpenProfile} bonus={bonusOf(ranking.me, tab, topN)} /></div>}
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

function Podium({ rows, meId, t, onOpenProfile, bonusFor }) {
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
            {bonusFor && bonusFor(row) > 0 && <span className="ls-hs">{t('contest.hsBadge', { count: bonusFor(row) })}</span>}
            <span className="ls-block">{row.rank}</span>
          </button>
        )
      })}
    </div>
  )
}

function RankRow({ row, me, t, onOpenProfile, bonus = 0 }) {
  const name = row.username ? '@' + row.username : row.displayName ?? ''
  const detail = [row.votes > 0 ? `${t('contest.votes')} ${row.votes}` : null, row.referral > 0 ? `${t('contest.referral')} ${row.referral}` : null,
                  ].filter(Boolean).join(' · ')
  return (
    <button type="button" className={`ls-row${me ? ' is-me' : ''}`} onClick={() => onOpenProfile(row.userId, row.displayName ?? row.username)}>
      <span className="ls-row-n">{row.rank}</span>
      <AvatarWithFlag userId={row.userId} displayName={row.displayName ?? row.username} photoUrl={row.photoUrl} size={38} />
      <span className="ls-row-body">
        <span className="ls-row-name">{name}{me && <span className="ls-you">{t('contest.youLabel')}</span>}{bonus > 0 && <span className="ls-hs">{t('contest.hsBadge', { count: bonus })}</span>}</span>
        {detail && <span className="dc-muted">{detail}</span>}
      </span>
      <b className="ls-row-pts">{row.points}</b>
    </button>
  )
}

function JoinForm({ season, suggested, onBack, onDone }) {
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
      <Header title={t('contest.join')} onBack={onBack} />
      <div className="page-body dc-body ls-body">
        <PrizePhotos photos={season.photos} short>
          <h1 className="ls-photo-title">{season.prize?.title || season.name}</h1>
        </PrizePhotos>
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
