import { useTranslation } from 'react-i18next'
import RankBadge from './RankBadge'
import { countryToFlag } from '../lib/countryFlag'

/**
 * Monthly rank section for profile screens (own + other-user).
 * Web mirror of apps/mobile/src/components/ProfileRankRow.tsx.
 *
 * Two rows:
 *   {flag}  [Badge]  #N in {city}      ← city scope
 *   🌐      [Badge]  #N worldwide      ← global scope
 *
 * Hides itself entirely when the user has no city scope AND no monthly
 * score yet (fresh signup) - there is nothing meaningful to show.
 */
export default function ProfileRankRow({ rank, cityName, cityCountry }) {
  const { t } = useTranslation('challenge')

  if (!rank) return null
  const { city, global, score_month: score, has_city: hasCity, top_n: topN } = rank
  if (!hasCity && score === 0 && global == null) return null

  const flag = cityCountry ? countryToFlag(cityCountry) : '📍'

  const cityLine =
    !hasCity || !cityName
      ? null
      : city != null
        ? t('scoreCelebration.rank.city', { rank: city, city: cityName })
        : score > 0
          ? t('scoreCelebration.rank.cityBeyond', { topN })
          : t('scoreCelebration.rank.cityUnranked', { city: cityName })

  const worldLine =
    global != null
      ? t('scoreCelebration.rank.world', { rank: global })
      : score > 0
        ? t('scoreCelebration.rank.worldBeyond', { topN })
        : t('scoreCelebration.rank.worldUnranked')

  return (
    <div className="profile-rank-row">
      {cityLine ? (
        <div className="profile-rank-row-line">
          <span className="profile-rank-row-emoji">{flag}</span>
          <span className="profile-rank-row-badge">
            {city != null ? <RankBadge rank={city} size={22} /> : null}
          </span>
          <span className="profile-rank-row-text">{cityLine}</span>
        </div>
      ) : null}
      <div className="profile-rank-row-line">
        <span className="profile-rank-row-emoji">🌐</span>
        <span className="profile-rank-row-badge">
          {global != null ? <RankBadge rank={global} size={22} /> : null}
        </span>
        <span className="profile-rank-row-text">{worldLine}</span>
      </div>
    </div>
  )
}
