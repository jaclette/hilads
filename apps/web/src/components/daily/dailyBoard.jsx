import { useEffect, useState } from 'react'
import { fetchDailyLeaderboard } from '../../api'
import { shortCityName } from '../../i18n/cityName'
import { CityFlag, CityName } from '../CityName'
import Icon from '../Icon'
import { thumbFallback } from '../../lib/thumbFallback'
import { useDc, formatCountdown, personName, RankMedal, RoleLabel, LocalPassBadge, SheetSkeleton } from './dailyShared'

const ROW = { display: 'inline-flex', alignItems: 'center', gap: 6 }
const LINE = { display: 'flex', alignItems: 'center', gap: 6 }

const POLL_MS = 30_000

/** Provisional leaderboard of the active challenge, polled every 30 s while shown. */
export function useLeaderboard(active) {
  const [board, setBoard] = useState(null)
  useEffect(() => {
    if (!active) return
    let alive = true
    const load = () => fetchDailyLeaderboard().then(d => { if (alive) setBoard(d) }).catch(() => {})
    load()
    const id = setInterval(() => { if (document.visibilityState === 'visible') load() }, POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [active])
  return board
}

/** Top 10: the live leaderboard while active, the official podium once closed. */
export function LeaderboardPanel({ sheet, secondsLeft, onOpenProof }) {
  const { t } = useDc()
  const active = !!sheet.challenge?.isActive
  const lb = useLeaderboard(active)
  const board = lb && lb.date === sheet.challenge?.date ? lb : null

  if (!active) {
    const r = sheet.results
    return (
      <div className="dc-board">
        <p className="dc-section" style={LINE}><Icon name="trophy-outline" size={16} />{t('leaderboard.official')}</p>
        {!r || (r.world.length === 0 && r.cities.length === 0) ? <p className="dc-muted">{t('results.none')}</p> : (
          <>
            {r.world.map((p, i) => <ResultRow key={p.id} proof={p} label={<RankMedal rank={i + 1} />} onOpen={() => onOpenProof(p.id)} />)}
            {r.cities.length > 0 && <p className="dc-section">{t('results.bestInCities')}</p>}
            {r.cities.map(p => <ResultRow key={`c${p.id}`} proof={p} label={<Icon name="location-outline" size={18} />} onOpen={() => onOpenProof(p.id)} />)}
          </>
        )}
      </div>
    )
  }

  const myProof = sheet.myProof
  return (
    <div className="dc-board">
      <p className="dc-section" style={LINE}><Icon name="trophy-outline" size={16} />{t('leaderboard.tab')}</p>
      <p className="dc-muted">
        {t('leaderboard.provisional')}
        {secondsLeft !== null ? ` · ${t('leaderboard.finalIn', { time: formatCountdown(secondsLeft) })}` : ''}
      </p>
      {board?.me ? (
        <div className="dc-me">
          <span>{t('leaderboard.me', { rank: board.me.rank, votes: board.me.voteCount })}</span>
          {board.me.cityRank !== null && myProof?.city && (
            <span className="dc-muted">{t('leaderboard.meCity', { rank: board.me.cityRank, city: shortCityName(myProof.city.name) })}</span>
          )}
        </div>
      ) : (
        <p className="dc-muted">{myProof?.status === 'pending' ? t('leaderboard.pending') : !myProof ? t('leaderboard.noProof') : ''}</p>
      )}
      {!board ? <SheetSkeleton rows />
      : !board.ranked ? <p className="dc-empty-title" style={LINE}><Icon name="flame-outline" size={18} />{t('leaderboard.minProofs', { min: board.minProofs, n: board.approvedCount })}</p>
      : board.world.length === 0 ? <p className="dc-empty-title" style={LINE}><Icon name="heart-outline" size={18} />{t('leaderboard.noVotes')}</p>
      : (
        <>
          {board.world.map(e => <EntryRow key={e.proofId} entry={e} mine={e.proofId === board.me?.proofId} onOpen={() => onOpenProof(e.proofId)} />)}
          {board.cities.map(c => (
            <div key={c.city.id}>
              <p className="dc-section" style={LINE}>{c.city.country ? <CityFlag country={c.city.country} /> : <Icon name="location-outline" size={16} />}{t('leaderboard.cityTop', { city: shortCityName(c.city.name) })}</p>
              {c.entries.map(e => <EntryRow key={`${c.city.id}:${e.proofId}`} entry={e} mine={e.proofId === board.me?.proofId} hideCity onOpen={() => onOpenProof(e.proofId)} />)}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function EntryRow({ entry, mine, hideCity = false, onOpen }) {
  return (
    <button type="button" className={`dc-row${mine ? ' dc-row--mine' : ''}`} onClick={onOpen}>
      <span className="dc-rank">{entry.rank <= 3 ? <RankMedal rank={entry.rank} /> : `#${entry.rank}`}</span>
      {entry.thumbUrl ? <img className="dc-row-thumb" src={entry.thumbUrl} alt="" /> : <span className="dc-row-thumb" />}
      <span className="dc-row-body">
        <span className="dc-row-name">{personName(entry.user)} {entry.user.localPass && <LocalPassBadge />}</span>
        <span className="dc-muted">
          <RoleLabel isLocal={entry.isLocal} />
          {!hideCity && entry.city && <> · <CityName name={entry.city.name} country={entry.city.country} short /></>}
        </span>
      </span>
      <span className="dc-row-votes" style={ROW}><Icon name="heart" size={14} />{entry.voteCount}</span>
    </button>
  )
}

function ResultRow({ proof, label, onOpen }) {
  return (
    <button type="button" className="dc-row" onClick={onOpen}>
      <span className="dc-rank">{label}</span>
      <img className="dc-row-thumb" src={proof.thumbUrl || proof.photoUrl} onError={thumbFallback(proof.photoUrl)} alt="" />
      <span className="dc-row-body">
        <span className="dc-row-name">{personName(proof.user)} {proof.user.localPass && <LocalPassBadge />}</span>
        <span className="dc-muted">
          <RoleLabel isLocal={proof.isLocal} suggestion={proof.suggestion} />
          {proof.city && <> · <CityName name={proof.city.name} country={proof.city.country} short /></>}
        </span>
      </span>
      <span className="dc-row-votes" style={ROW}><Icon name="heart" size={14} />{proof.voteCount}</span>
    </button>
  )
}
