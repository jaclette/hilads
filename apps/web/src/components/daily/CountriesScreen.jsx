import { useEffect, useMemo, useRef, useState } from 'react'
import BackButton from '../BackButton'
import { fetchDailyProof, fetchDailyProofsByIds, fetchDailySheet, fetchDailyTodayCountries } from '../../api'
import { shortCityName } from '../../i18n/cityName'
import { track } from '../../lib/analytics'
import Icon from '../Icon'
import { FlagSticker } from '../joy/Joy'
import { thumbFallback } from '../../lib/thumbFallback'
import { AnswerChip, answerText, captionRepeatsAnswer } from './compareShared'
import { compareCountryGroups, lastCountries, rankCountryProofs } from './countryOrder'
import { LeaderboardPanel } from './dailyBoard'
import {
  EarlyBadge, LocalPassBadge, ProofViewer, RoleLabel, SheetSkeleton, VoteButton, getLastToday, personName, seedProofs,
  useCountdown, useDaily, useDc, useHere,
} from './dailyShared'

/** The server lists at most 50 photos per call. */
const BATCH = 50

/**
 * Same challenge. Different worlds. on the web, like the app's /daily/countries:
 * every country that played, one section each (flag, city, top answer, photo
 * count) with all its photos in a 2-column grid of light cards; "By country |
 * Top 10". Countries in the shared order (compareCountryGroups), a country's
 * photos best first, its mosaic photo leading. `date` a past day (default
 * today), `country` scrolls to that section, `sort` 'top10' opens on Top 10.
 * A photo opens Today's photos on it (a past day: on its own).
 */
export default function CountriesScreen({ date: dateParam = null, country = null, sort: initialSort = 'country', source = 'today', onBack }) {
  const { t, i18n } = useDc()
  const { openDaily } = useDaily()
  const here = useHere()
  const lastToday = getLastToday()
  const date = dateParam && dateParam !== lastToday?.challenge?.date ? dateParam : null
  const [sort, setSort] = useState(initialSort === 'top10' ? 'top10' : 'country')
  const [data, setData] = useState(date ? null : lastCountries())
  const [proofs, setProofs] = useState(null)
  const [failed, setFailed] = useState(false)
  const [viewing, setViewing] = useState(null)

  const load = async () => {
    setFailed(false)
    try {
      const next = await fetchDailyTodayCountries({ date, cityId: here?.id ?? lastToday?.city?.id ?? null, locale: i18n.language })
      setData(next)
      const ids = next.items.flatMap(g => g.ids)
      const chunks = Array.from({ length: Math.ceil(ids.length / BATCH) }, (_, i) => ids.slice(i * BATCH, (i + 1) * BATCH))
      const all = (await Promise.all(chunks.map(c => fetchDailyProofsByIds(c, i18n.language)))).flat()
      seedProofs(all, !date && !!lastToday?.challenge?.isActive)
      setProofs(new Map(all.map(p => [p.id, p])))
    } catch {
      setFailed(true)
    }
  }
  useEffect(() => { track('today_countries_all', { source, past: !!date, sort, platform_surface: 'web' }); load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const sections = useMemo(() => {
    if (!data || !proofs) return []
    const mine = here?.country ?? lastToday?.city?.country ?? null
    return [...data.items].sort((a, b) => compareCountryGroups(a, b, mine)).flatMap(g => {
      const list = rankCountryProofs(g.ids.map(id => proofs.get(id)).filter(Boolean), g.top.id)
      return list.length ? [{ group: g, list }] : []
    })
  }, [data, proofs, here?.country]) // eslint-disable-line react-hooks/exhaustive-deps

  // `country` (a bubble of the challenge screen): that country's section, once.
  const scrolled = useRef(false)
  useEffect(() => {
    if (!country || scrolled.current || sort !== 'country' || sections.length === 0) return
    scrolled.current = true
    requestAnimationFrame(() => document.getElementById(`country-${country.toUpperCase()}`)?.scrollIntoView({ block: 'start' }))
  }, [sections, country, sort])

  const open = (p) => (date ? setViewing(p) : openDaily('photos', { proofId: p.id, source: 'today_all' }))

  return (
    <div className="full-page dc-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{t('worlds.tagline')}</span>
      </div>
      <div className="page-body dc-body">
        <div className="dc-sort" role="tablist">
          {[['country', t('countries.byCountry')], ['top10', t('leaderboard.tab')]].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={sort === k} className={`dc-sort-btn${sort === k ? ' dc-sort-btn--on' : ''}`}
                    onClick={() => { setSort(k); track('today_countries_sort', { sort: k, platform_surface: 'web' }) }}>{label}</button>
          ))}
        </div>
        {sort === 'top10' ? (
          <TopTen date={data?.date ?? date ?? lastToday?.challenge?.date ?? null} onOpen={open} />
        ) : failed ? (
          <div className="dc-center">
            <p className="dc-muted">{t('loadFailed')}</p>
            <button type="button" className="dc-link" onClick={load}>{t('retry')}</button>
          </div>
        ) : !proofs ? <SheetSkeleton /> : sections.length === 0 ? (
          <div className="dc-center"><p className="dc-empty-title">{t('beFirst')}</p><p className="dc-muted">{t('beFirstSub')}</p></div>
        ) : sections.map(({ group, list }) => {
          const main = group.top.answer && !group.top.backHome ? answerText(group.top.answer, i18n.language) : null
          return (
            <section key={group.country} id={`country-${group.country}`} className="dc-country">
              <div className="dc-country-head">
                <FlagSticker country={group.country} size={24} />
                <span className="dc-country-body">
                  <span className="dc-country-city">{shortCityName(group.city.name)}{main && <span className="dc-country-answer"> · {main}</span>}</span>
                  <span className="dc-muted">{t('today.proofs', { count: group.count })}</span>
                </span>
              </div>
              <div className="dc-grid">
                {list.map(p => <CompactTile key={p.id} proof={p} mainAnswer={main} onOpen={() => open(p)} />)}
              </div>
            </section>
          )
        })}
      </div>
      <ProofViewer proof={viewing} onClose={() => setViewing(null)} />
    </div>
  )
}

/**
 * A light card (a country's section): the photo, the name with a check when
 * validated by a local (a tap explains it) and small labels, the answer only
 * when it differs from the section's, the caption (2 lines) and the vote.
 */
function CompactTile({ proof, mainAnswer, onOpen }) {
  const { t, i18n } = useDc()
  const [hint, setHint] = useState(false)
  useEffect(() => {
    if (!hint) return
    const id = setTimeout(() => setHint(false), 3000)
    return () => clearTimeout(id)
  }, [hint])
  const answer = proof.answer && !proof.backHome ? proof.answer : null
  const ownAnswer = !!answer && !(mainAnswer && captionRepeatsAnswer(mainAnswer, answer, i18n.language))
  return (
    <div className="dc-ctile">
      <button type="button" className="dc-ctile-photo" onClick={onOpen} aria-label={personName(proof.user)}>
        <img src={proof.thumbUrl || proof.photoUrl} onError={thumbFallback(proof.photoUrl)} alt="" loading="lazy" />
      </button>
      <div className="dc-ctile-meta">
        <div className="dc-ctile-name">
          <strong>{personName(proof.user)}</strong>
          {proof.validatedByLocal && (
            <button type="button" className="dc-ctile-check" onClick={() => setHint(h => !h)} aria-label={t('vote.validatedHint')} title={t('vote.validatedHint')}>
              <Icon name="checkmark-circle-outline" size={15} />
            </button>
          )}
          {proof.user.localPass && <LocalPassBadge />}
          <span className="dc-ctile-label"><RoleLabel isLocal={proof.isLocal} /></span>
          {proof.isEarly && <EarlyBadge />}
        </div>
        {hint && <p className="dc-ctile-hint" role="status">{t('vote.validatedHint')}</p>}
        {ownAnswer && <AnswerChip answer={answer} />}
        {proof.caption && !captionRepeatsAnswer(proof.caption, answer, i18n.language) && <p className="dc-ctile-caption">{proof.caption}</p>}
        <VoteButton proof={proof} variant="tile" source="countries_tile" />
      </div>
    </div>
  )
}

/** Top 10: the live leaderboard while the challenge is open, the official podium once closed. */
function TopTen({ date, onOpen }) {
  const { i18n } = useDc()
  const { cityId } = useDaily()
  const [sheet, setSheet] = useState(null)
  useEffect(() => {
    if (!date) return
    let alive = true
    fetchDailySheet(date, { scope: 'world', cityId, locale: i18n.language })
      .then(s => { if (alive) { seedProofs([...s.proofs, ...(s.results?.world ?? []), ...(s.results?.cities ?? [])], !!s.challenge?.isActive); setSheet(s) } })
      .catch(() => {})
    return () => { alive = false }
  }, [date, cityId, i18n.language])
  const secondsLeft = useCountdown(sheet?.challenge?.isActive ? sheet.challenge.endsAt : null)
  if (!sheet) return <SheetSkeleton rows />
  const known = [...sheet.proofs, ...(sheet.results?.world ?? []), ...(sheet.results?.cities ?? [])]
  return (
    <LeaderboardPanel sheet={sheet} secondsLeft={secondsLeft}
                      onOpenProof={id => { const p = known.find(x => x.id === id); if (p) onOpen(p); else fetchDailyProof(id, i18n.language).then(onOpen).catch(() => {}) }} />
  )
}
