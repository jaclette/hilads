import { useTranslation } from 'react-i18next'
import { countryToFlag } from '../lib/countryFlag'

const TYPE_ICON = { food: '🍜', place: '📍', culture: '🎭', help: '🤝' }

/**
 * One card in the public "Success challenges" showcase (web twin of the mobile
 * ShowcaseCard): title, by-whom + country, local/international, average stars,
 * photo proof (intl), and a preview of the appreciation. Tap → the challenge;
 * tap the avatar → the creator's profile.
 */
export default function ShowcaseCard({ item, onOpen, onAvatar }) {
  const { t } = useTranslation('challenge')
  const intl        = item.mode === 'international'
  const icon        = TYPE_ICON[item.challenge_type] ?? '🔥'
  const fromFlag    = countryToFlag(item.country)
  const toFlag      = countryToFlag(item.target_country)
  const creatorName = item.creator_display_name ?? '?'
  const hasProof    = item.proof_media_url && item.proof_media_type === 'image'
  const cityLabel   = intl
    ? [item.city_name, item.target_city_name].filter(Boolean).join(' → ')
    : item.city_name

  return (
    <button type="button" className="showcase-card" onClick={onOpen}>
      <div className="showcase-badges">
        {intl
          ? <span className="showcase-mode showcase-mode--intl">{(fromFlag || '🌐')} → {(toFlag || '🌍')}</span>
          : <span className="showcase-mode showcase-mode--local">{(fromFlag || '📍')} {t('showcase.localTag')}</span>}
        {(item.rating_count ?? 0) > 0 && item.avg_stars != null && <span className="showcase-stars">★ {item.avg_stars.toFixed(1)}</span>}
      </div>

      <div className="showcase-body">
        {hasProof && <img className="showcase-proof" src={item.proof_media_url} alt="" />}
        <div className="showcase-text">
          <div className="showcase-title">{icon} {item.title}</div>
          {cityLabel && <div className="showcase-city">📍 {cityLabel}</div>}
          <span
            className="showcase-by"
            onClick={item.created_by && onAvatar ? (e) => { e.stopPropagation(); onAvatar(item.created_by) } : undefined}
          >
            {item.creator_thumb_avatar_url
              ? <img className="showcase-avatar" src={item.creator_thumb_avatar_url} alt="" />
              : <span className="showcase-avatar showcase-avatar--fallback">{creatorName[0]?.toUpperCase() ?? '?'}</span>}
            {t('showcase.by', { name: creatorName })}{fromFlag ? ` ${fromFlag}` : ''}
          </span>
          {item.comment && <div className="showcase-comment">“{item.comment}”</div>}
        </div>
      </div>
    </button>
  )
}
