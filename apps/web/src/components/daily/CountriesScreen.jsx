import { useEffect, useMemo, useRef, useState } from 'react'
import BackButton from '../BackButton'
import { fetchDailyProofsByIds, fetchDailyTodayCountries } from '../../api'
import { shortCityName } from '../../i18n/cityName'
import { track } from '../../lib/analytics'
import Icon from '../Icon'
import AvatarWithFlag from '../AvatarWithFlag'
import { FlagSticker } from '../joy/Joy'
import { thumbFallback } from '../../lib/thumbFallback'
import { answerText, captionRepeatsAnswer } from './compareShared'
import { compareCountryGroups, lastCountries, rankCountryProofs } from './countryOrder'
import {
  EarlyBadge, LocalPassBadge, ProofViewer, RoleLabel, SheetSkeleton, VoteButton, getLastToday, personName, seedProofs,
  useDaily, useDc, useHere,
} from './dailyShared'
import { SeasonalZone } from '../event/seasonal'
import { thumbUrl } from '../../lib/imageThumb'
import { placeholderStyle } from '../../lib/thumbhash'

/** The server lists at most 50 photos per call. */
const BATCH = 50

/**
 * Same challenge. Different worlds. on the web, like the app's /daily/countries:
 * every country that played, one section each (flag, city, top answer, photo
 * count) with all its photos in a 2-column grid of light cards; "By country |
 * Top 10". Countries in the shared order (compareCountryGroups), a country's
 * photos best first, its mosaic photo leading. `date` a past day (default
 * today), `country` scrolls to that section. By city only: the photo ranking is World › Photos.
 * A photo opens Today's photos on it (a past day: on its own).
 */
// A seasonal event's live look (Halloween...) re-colors the screen.
export default function CountriesScreen(props) {
  return <SeasonalZone><CountriesScreenContent {...props} /></SeasonalZone>
}

function CountriesScreenContent({ date: dateParam = null, country = null, source = 'today', onBack }) {
  const { t, i18n } = useDc()
  const { openDaily } = useDaily()
  const here = useHere()
  const lastToday = getLastToday()
  const date = dateParam && dateParam !== lastToday?.challenge?.date ? dateParam : null
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
  useEffect(() => { track('today_countries_all', { source, past: !!date, platform_surface: 'web' }); load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!country || scrolled.current || sections.length === 0) return
    scrolled.current = true
    requestAnimationFrame(() => document.getElementById(`country-${country.toUpperCase()}`)?.scrollIntoView({ block: 'start' }))
  }, [sections, country])

  const open = (p) => (date ? setViewing(p) : openDaily('photos', { proofId: p.id, source: 'today_all' }))

  return (
    <div className="full-page dc-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{t('worlds.tagline')}</span>
      </div>
      <div className="page-body dc-body">
        {failed ? (
          <div className="dc-center">
            <p className="dc-muted">{t('loadFailed')}</p>
            <button type="button" className="dc-link" onClick={load}>{t('retry')}</button>
          </div>
        ) : !proofs ? <SheetSkeleton /> : sections.length === 0 ? (
          <div className="dc-center"><p className="dc-empty-title">{t('beFirst')}</p><p className="dc-muted">{t('beFirstSub')}</p></div>
        ) : sections.map(({ group, list }) => {
          // 👑 the most liked photo, when the city has several and it has likes (ties: the best ranked).
          const best = list.reduce((a, p) => ((p.voteCount ?? 0) > (a.voteCount ?? 0) ? p : a), list[0])
          const topId = list.length > 1 && (best.voteCount ?? 0) > 0 ? best.id : null
          return (
            <section key={group.country} id={`country-${group.country}`} className="dc-country">
              {/* The city only (flag, name, photo count): each photo carries its own caption. */}
              <div className="dc-country-head">
                <FlagSticker country={group.country} size={24} />
                <span className="dc-country-city">{shortCityName(group.city.name)}<span className="dc-country-count"> · {t('today.proofs', { count: group.count })}</span></span>
              </div>
              <div className="dc-grid">
                {list.map(p => <CompactTile key={p.id} proof={p} top={p.id === topId} onOpen={() => open(p)} />)}
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
 * A card of a city's section, laid out like Today's mosaic cards: the photo,
 * its own title (answer, else caption) in big type, the caption when it says
 * more, the author row (avatar, handle, a check when validated by a local (a
 * tap explains it), small labels wrapping), then comments and the vote at the
 * foot. `top`: the city's most liked photo ("👑 Top photo").
 */
function CompactTile({ proof, top, onOpen }) {
  const { t, i18n } = useDc()
  const [hint, setHint] = useState(false)
  useEffect(() => {
    if (!hint) return
    const id = setTimeout(() => setHint(false), 3000)
    return () => clearTimeout(id)
  }, [hint])
  const answer = proof.answer && !proof.backHome ? proof.answer : null
  const title = answer ? answerText(answer, i18n.language) : proof.caption ?? proof.spot?.name ?? proof.place?.name ?? ''
  // The caption under the title when the title is the answer and the caption says more.
  const caption = answer && proof.caption && !captionRepeatsAnswer(proof.caption, answer, i18n.language) ? proof.caption : null
  const handle = proof.user.username ? `@${proof.user.username}` : personName(proof.user)
  const comments = proof.commentCount ?? 0
  return (
    <div className="dc-ctile">
      <button type="button" className="dc-ctile-photo" onClick={onOpen} aria-label={[top ? t('countries.topPhoto') : null, title, handle].filter(Boolean).join(', ')}>
        <img src={thumbUrl(proof.thumbUrl || proof.photoUrl)} style={placeholderStyle(proof.thumbHash)} onError={thumbFallback(proof.photoUrl)} alt="" loading="lazy" />
        {proof.selfieUrl && <img loading="lazy" className="dp-mini" src={thumbUrl(proof.selfieThumbUrl ?? proof.selfieUrl)} style={placeholderStyle(proof.selfieThumbHash)} alt="" />}
        {top && <span className="dc-ctile-top">👑 {t('countries.topPhoto')}</span>}
      </button>
      <div className="dc-ctile-meta">
        {title && <p className="dc-ctile-title">{title}</p>}
        {caption && <p className="dc-ctile-caption">{caption}</p>}
        <div className="dc-ctile-name">
          {proof.user && <AvatarWithFlag userId={proof.user.id} displayName={personName(proof.user)} photoUrl={proof.user.photoUrl} size={20} />}
          <strong>{handle}</strong>
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
        {/* Comments and the vote at the card's foot: the cards of a row end level. */}
        <div className="dc-ctile-foot">
          {comments > 0 && <span className="pc-count"><Icon name="chatbubble-outline" size={13} />{comments}</span>}
          <VoteButton proof={proof} variant="tile" source="countries_tile" />
        </div>
      </div>
    </div>
  )
}

