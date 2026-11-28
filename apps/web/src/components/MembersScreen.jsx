import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchMembers, fetchMembersSummary, sendWave } from '../api'
import { track } from '../lib/analytics'
import { thumbUrl } from '../lib/imageThumb'
import { countryToFlag } from '../lib/countryFlag'
import { avatarColors } from '../lib/avatarColors'
import { shortCityName } from '../i18n/cityName'
import { CityFlag } from './CityName'
import BackButton from './BackButton'
import Icon from './Icon'

/**
 * Members (web parity of apps/mobile/app/members): a city's crew or the World, from the Hi
 * header's members line. Here now, the week's spotlight, everyone (chips, search, paged),
 * a Wave on each row; the World adds the cities strip and a searchable list of every city.
 */

// ── Wave 👋: one state per person for the page (rows, Here now badges, the inbox) ──────────────────
const waveStates = new Map()
const waveListeners = new Set()
const emitWaves = () => waveListeners.forEach(l => l())
export function setWaveStates(map) {
  let changed = false
  for (const [id, st] of Object.entries(map || {})) if (waveStates.get(id) !== st) { waveStates.set(id, st); changed = true }
  if (changed) emitWaves()
}
function useWaveState(id, initial) {
  return useSyncExternalStore(l => { waveListeners.add(l); return () => waveListeners.delete(l) }, () => waveStates.get(id) ?? initial)
}
const WAVE_LABEL = { none: 'wave.wave', sent: 'wave.waved', received: 'wave.waveBack', mutual: 'wave.wavedBack' }

/** The shared Wave button: `pill` in a row, `badge` on a Here now face. */
export function WaveButton({ user, initial = 'none', source, variant = 'pill', account, onNeedAccount, onOpenChat }) {
  const { t } = useTranslation('members')
  const state = useWaveState(user.id, initial)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)

  const press = async (e) => {
    e.stopPropagation()
    if (!account) { onNeedAccount?.(); return }
    if (state === 'mutual') { onOpenChat?.(user); return }
    if (state === 'sent' || busy) return
    const before = state
    waveStates.set(user.id, before === 'received' ? 'mutual' : 'sent'); emitWaves()
    setBusy(true)
    try {
      const r = await sendWave(user.id, source)
      waveStates.set(user.id, r.state); emitWaves()
      track('wave_sent', { source, back: r.back })
      if (r.back) { track('wave_returned', { source }); setNote(t('wave.mutualTitle', { name: user.displayName })) }
    } catch (err) {
      if (err.code === 'already') return
      waveStates.set(user.id, before); emitWaves()
      setNote(t(err.code === 'limit' ? 'wave.errLimit' : err.code === 'waves_off' ? 'wave.errOff' : 'wave.errGeneric', { name: user.displayName }))
    } finally { setBusy(false) }
  }

  const done = state === 'sent' || state === 'mutual'
  const a11y = t(`wave.a11y.${state}`, { name: user.displayName })
  if (variant === 'badge') {
    return (
      <button type="button" className={`mb-wave-badge${done ? ' is-done' : ''}`} onClick={press} disabled={state === 'sent'} aria-label={a11y}>
        {state === 'mutual' ? '🎉' : done ? '✓' : '👋'}
      </button>
    )
  }
  return (
    <span className="mb-wave-wrap">
      <button type="button" className={`mb-wave mb-wave--${state}`} onClick={press} disabled={state === 'sent' || busy} aria-label={a11y} aria-busy={busy}>
        {t(WAVE_LABEL[state])}
      </button>
      {note && <span className="mb-wave-note" role="status" onClick={(e) => { e.stopPropagation(); setNote(null) }}>{note}</span>}
    </span>
  )
}

export function MemberAvatar({ photo, name, size = 44 }) {
  const [a, b] = avatarColors(name)
  return photo
    ? <img className="mb-avatar" src={thumbUrl(photo) ?? photo} alt="" width={size} height={size} style={{ width: size, height: size }} loading="lazy" />
    : <span className="mb-avatar mb-avatar--initial" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: `linear-gradient(135deg, ${a}, ${b})` }}>
        {(name || '?').replace('@', '').charAt(0).toUpperCase()}
      </span>
}

/** The one contextual line (same rule as the app's memberLine). */
function memberLine(m, t, world) {
  const parts = []
  if (world && m.city) parts.push(m.city.name)
  if (m.joinedDays !== null && m.joinedDays <= 7) {
    parts.push(m.joinedDays === 0 ? t('line.joinedToday') : m.joinedDays === 1 ? t('line.joinedYesterday') : t('line.joinedDays', { count: m.joinedDays }))
  } else if (m.streak >= 2) parts.push(t('line.streak', { count: m.streak }))
  if (m.duels > 0) parts.push(t('line.duels', { count: m.duels }))
  else if (m.friend) parts.push(t('line.friend'))
  else if (m.photos > 0 && parts.length < (world ? 3 : 2)) parts.push(t('line.photos', { count: m.photos }))
  return parts.join(' · ')
}

export function MemberRow({ member, world, account, onOpen, onNeedAccount, onOpenChat, source = 'members' }) {
  const { t } = useTranslation('members')
  const tagLabel = member.mode === 'local' ? t('daily.local', { ns: 'city' }) : member.mode === 'traveler' ? t('daily.traveler', { ns: 'city' }) : null
  const line = memberLine(member, t, world)
  return (
    <div className="mb-row" role="button" tabIndex={0} onClick={() => onOpen(member)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(member) }}
         aria-label={[member.displayName, member.here ? t('hereNow') : null, tagLabel, line].filter(Boolean).join(', ')}>
      <span className="mb-row-face"><MemberAvatar photo={member.photo} name={member.displayName} />{member.here && <i className="mb-online" />}</span>
      <span className="mb-row-body">
        <span className="mb-row-name">
          {world && member.city?.country ? <CityFlag country={member.city.country} size={14} /> : null}
          <b>{member.displayName}</b>
          {tagLabel && <span className={`mb-tag mb-tag--${member.mode}`}>{tagLabel}</span>}
        </span>
        {line && <small>{line}</small>}
      </span>
      {member.canWave !== false && (
        <WaveButton user={member} initial={member.wave} source={source} account={account} onNeedAccount={onNeedAccount} onOpenChat={onOpenChat} />
      )}
    </div>
  )
}

const FILTERS = ['all', 'here', 'locals', 'travelers', 'friends', 'new']
const CARD = { top_local: ['sip', '👑'], top_player: ['sip', '👑'], streak: ['taste', '🔥'], newest: ['gem', '🆕'], new_city: ['gem', '🆕'], city_week: ['around', '🏙️'] }
const HELLO = { ES: 'hola', MX: 'hola', AR: 'hola', CO: 'hola', CL: 'hola', PE: 'hola', FR: 'bonjour', BE: 'bonjour', VN: 'xin chào', DE: 'hallo', AT: 'servus',
  NL: 'hoi', IT: 'ciao', PT: 'olá', BR: 'oi', JP: 'こんにちは', KR: '안녕하세요', TH: 'สวัสดี', ID: 'halo', PH: 'kumusta', IN: 'namaste', RU: 'привет', CN: '你好', TW: '你好', TR: 'merhaba', GR: 'yassou' }

export default function MembersScreen({ scope: initialScope, account, onBack, onOpenProfile, onNeedAccount, onOpenChat }) {
  const { t } = useTranslation('members')
  const world = initialScope.scope === 'world'
  const cityId = world ? null : String(initialScope.cityId ?? '')
  const cityName = shortCityName(initialScope.name ?? '')
  const [worldCity, setWorldCity] = useState(null)
  const [allCities, setAllCities] = useState(false)
  const [cityQuery, setCityQuery] = useState('')
  const scope = useMemo(() => (world ? { scope: 'world', cityId: worldCity } : { scope: 'city', cityId }), [world, worldCity, cityId])
  const [summary, setSummary] = useState(null)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState(null)
  const [next, setNext] = useState(null)
  const [failed, setFailed] = useState(false)
  const req = useRef(0)
  const sentinel = useRef(null)

  useEffect(() => { track('members_viewed', { scope: world ? 'world' : 'city', platform: 'web' }) }, [world])
  const loadSummary = useCallback(() => fetchMembersSummary(world ? { scope: 'world' } : { scope: 'city', cityId })
    .then(s => { setSummary(s); setWaveStates(Object.fromEntries((s.hereNow || []).map(m => [m.id, m.wave]))) }).catch(() => {}), [world, cityId])
  useEffect(() => { loadSummary() }, [loadSummary])
  useEffect(() => { const id = setTimeout(() => setQ(query.trim()), 250); return () => clearTimeout(id) }, [query])
  useEffect(() => { if (q) track('members_search', { scope: world ? 'world' : 'city', length: q.length }) }, [q, world])

  const load = useCallback(async (offset = 0) => {
    const n = ++req.current
    if (!offset) setFailed(false)
    try {
      const r = await fetchMembers(scope, { filter, q, offset })
      if (n !== req.current) return
      setWaveStates(Object.fromEntries(r.members.map(m => [m.id, m.wave])))
      setRows(prev => (offset && prev ? [...prev, ...r.members.filter(m => !prev.some(p => p.id === m.id))] : r.members))
      setNext(r.nextOffset)
    } catch { if (n === req.current && !offset) { setFailed(true); setRows(r => r ?? []) } }
  }, [scope, filter, q])
  useEffect(() => { setRows(null); setNext(null); load(0) }, [load])

  // Paged: the next page loads as the end of the list comes into view.
  useEffect(() => {
    const el = sentinel.current
    if (!el || next === null) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) load(next) }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [next, load])

  const pickFilter = (f) => { setFilter(f); track('members_filter', { filter: f, scope: world ? 'world' : 'city' }) }
  const pickCity = (id) => { setWorldCity(id); setAllCities(false); if (id !== null) track('members_city_filter', { cityId: id }) }
  const open = (u) => onOpenProfile(u.id, u.displayName)

  const counts = summary?.counts
  const live = counts ? [counts.here > 0 ? t('hereCount', { count: counts.here }) : null, t('memberCount', { count: counts.members }),
    world && counts.cities ? t('cityCount', { count: counts.cities }) : null].filter(Boolean).join(' · ') : ''
  const title = world ? t('titleWorld') : t('titleCity', { city: cityName, flag: countryToFlag(initialScope.country) }).trim()
  const searching = q.length > 0
  const cityMatches = world && searching && summary?.cities ? summary.cities.filter(c => c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : []
  const selectedCity = worldCity !== null ? summary?.cities?.find(c => c.id === worldCity) : null
  const filters = FILTERS.filter(f => f !== 'friends' || !!account)

  if (allCities) {
    const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    const shown = (summary?.cities ?? []).filter(c => !cityQuery.trim() || fold(c.name).includes(fold(cityQuery.trim())))
    return (
      <div className="full-page mb-screen">
        <div className="page-header"><BackButton onClick={() => setAllCities(false)} /><span className="page-title">{t('allCitiesTitle')}</span></div>
        <div className="mb-body">
          <label className="mb-search"><Icon name="search-outline" size={18} />
            <input value={cityQuery} onChange={e => setCityQuery(e.target.value)} placeholder={t('searchCityList')} aria-label={t('searchCityList')} autoFocus />
          </label>
          <div className="mb-list">
            {shown.map(c => (
              <button type="button" key={c.id} className="mb-city-row" onClick={() => pickCity(c.id)} aria-label={t('cityA11y', { city: c.name, count: c.members })}>
                <CityFlag country={c.country} size={20} /><b>{c.name}</b><small>{t('memberCount', { count: c.members })}</small><Icon name="chevron-forward" size={16} />
              </button>
            ))}
            {!shown.length && <p className="mb-empty">{t('noCityResults', { q: cityQuery.trim() })}</p>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="full-page mb-screen">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="mb-head"><span className="page-title">{title}</span>
          {live && <span className="mb-live">{counts.here > 0 && <i className="mb-live-dot" />}{live}</span>}</span>
      </div>
      <div className="mb-body">
        <label className="mb-search"><Icon name="search-outline" size={18} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={world ? t('searchWorld') : t('searchCity')} aria-label={world ? t('searchWorld') : t('searchCity')} />
          {query && <button type="button" className="mb-clear" onClick={() => setQuery('')} aria-label={t('clearSearch')}><Icon name="close-circle" size={18} /></button>}
        </label>

        {!searching && world && !!summary?.cities?.length && (<>
          <div className="mb-sec"><span>{t('cities')}</span><button type="button" onClick={() => setAllCities(true)}>{t('seeAll', { count: summary.cities.length })}</button></div>
          <div className="mb-strip">
            <button type="button" className={`mb-city${worldCity === null ? ' is-on' : ''}`} onClick={() => pickCity(null)} aria-pressed={worldCity === null}>
              <span className="mb-globe">🌍</span><b>{t('allCities')}</b><small>{summary.counts.members}</small></button>
            {summary.cities.slice(0, 20).map(c => (
              <button type="button" key={c.id} className={`mb-city${worldCity === c.id ? ' is-on' : ''}`} onClick={() => pickCity(c.id)} aria-pressed={worldCity === c.id}
                      aria-label={t('cityA11y', { city: c.name, count: c.members })}>
                <CityFlag country={c.country} size={18} /><b>{c.name}</b><small>{c.members}</small></button>
            ))}
          </div>
        </>)}

        {!searching && !world && !!summary?.hereNow?.length && (<>
          <div className="mb-sec"><span>{t('hereNow')}</span></div>
          <div className="mb-strip">
            {summary.hereNow.map(p => {
              const me = p.id === account?.id
              return (
                <div key={p.id} className="mb-here">
                  <button type="button" className={`mb-ring${me ? ' is-me' : ''}`} onClick={() => open(p)} aria-label={me ? t('you') : t('hereA11y', { name: p.displayName })}>
                    <MemberAvatar photo={p.photo} name={p.displayName} size={48} />
                  </button>
                  {!me && p.canWave && <WaveButton variant="badge" user={p} initial={p.wave} source="here_now" account={account} onNeedAccount={onNeedAccount} onOpenChat={onOpenChat} />}
                  <span>{me ? t('you') : p.displayName}</span>
                </div>
              )
            })}
          </div>
        </>)}

        {!searching && worldCity === null && !!summary?.spotlight?.length && (<>
          <div className="mb-sec"><span>{t('spotlight')}</span><em>{t('thisWeek')}</em></div>
          <div className="mb-spot">
            {summary.spotlight.map((c, i) => {
              const [tone, emoji] = CARD[c.kind]
              const name = c.user ? c.user.displayName : c.city.name
              const value = c.kind === 'top_local' || c.kind === 'top_player' ? t('spot.points', { count: c.value })
                : c.kind === 'streak' ? t('spot.days', { count: c.value }) : c.kind === 'newest' ? t('spot.sayWelcome')
                : c.kind === 'city_week' ? t('spot.photos', { count: c.value }) : t('spot.sayHello', { hello: HELLO[c.city.country] ?? t('spot.hi') })
              const flag = c.city?.country
              return (
                <button type="button" key={c.kind} className={`mb-card mb-card--${tone}${i === 2 ? ' is-tilt' : ''}`}
                        onClick={() => (c.user ? open(c.user) : world && pickCity(c.city.id))} aria-label={`${t(`spot.${c.kind}`)}: ${name}, ${value}`}>
                  <small>{t(`spot.${c.kind}`)}</small>
                  <span className="mb-card-mid">{c.user ? <MemberAvatar photo={c.user.photo} name={c.user.displayName} size={28} /> : <span className="mb-card-emoji">{emoji}</span>}</span>
                  <b>{name}</b>
                  <span className="mb-card-value">{flag ? <CityFlag country={flag} size={12} /> : null}{value}</span>
                  {c.user && <span className="mb-card-corner" aria-hidden="true">{emoji}</span>}
                </button>
              )
            })}
          </div>
        </>)}

        {!!cityMatches.length && (<>
          <div className="mb-sec"><span>{t('cities')}</span></div>
          <div className="mb-list">
            {cityMatches.map(c => (
              <button type="button" key={c.id} className="mb-city-row" onClick={() => { setQuery(''); pickCity(c.id) }}>
                <CityFlag country={c.country} size={16} /><b>{c.name}</b><small>{t('memberCount', { count: c.members })}</small>
              </button>
            ))}
          </div>
        </>)}

        <div className="mb-sec">
          <span>{searching ? t('results') : selectedCity ? t('crewOf', { city: selectedCity.name }) : t('everyone')}</span>
          {selectedCity && <button type="button" onClick={() => pickCity(null)}>{t('clearCity')}</button>}
        </div>
        {!searching && (
          <div className="mb-chips" role="tablist">
            {filters.map(f => <button type="button" role="tab" key={f} aria-selected={filter === f} className={`mb-chip${filter === f ? ' is-on' : ''}`} onClick={() => pickFilter(f)}>{t(`filter.${f}`)}</button>)}
          </div>
        )}

        <div className="mb-list">
          {rows === null ? [0, 1, 2, 3].map(i => <div key={i} className="mb-skeleton" aria-hidden="true" />)
            : failed ? <div className="mb-empty"><b>{t('errorTitle')}</b><p>{t('errorBody')}</p><button type="button" className="btn-secondary" onClick={() => load(0)}>{t('retry')}</button></div>
            : !rows.length ? <div className="mb-empty">{searching ? t('noResults', { q }) : filter !== 'all' ? t(`emptyFilter.${filter}`)
                : <><b>{t('emptyTitle')}</b><p>{world ? t('emptyWorld') : t('emptyCity', { city: cityName })}</p></>}</div>
            : rows.map(m => <MemberRow key={m.id} member={m} world={world && worldCity === null} account={account} onOpen={open} onNeedAccount={onNeedAccount} onOpenChat={onOpenChat} />)}
          {next !== null && <div ref={sentinel} className="mb-more" aria-hidden="true" />}
        </div>
      </div>
    </div>
  )
}
