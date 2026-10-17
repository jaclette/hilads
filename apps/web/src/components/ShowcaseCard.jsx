import { thumbUrl } from '../lib/imageThumb'
import { useTranslation } from 'react-i18next'
import ThumbImg from './ThumbImg'
import { countryToFlag } from '../lib/countryFlag'
import Icon from './Icon'
import { CHALLENGE_TYPE_ICONS } from '../lib/icons'

/**
 * One card in the public "Success challenges" showcase (web twin of the mobile
 * ShowcaseCard): title, by-whom + country, local/international, average stars,
 * photo proof (intl), and a preview of the appreciation. Tap → the challenge;
 * tap the avatar → the creator's profile.
 */
export default function ShowcaseCard({ item, onOpen, onAvatar }) {
  const { t } = useTranslation('challenge')
  const intl        = item.mode === 'international'
  const icon        = CHALLENGE_TYPE_ICONS[item.challenge_type] ?? 'flame-outline'
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
          ? <span className="showcase-mode showcase-mode--intl">{fromFlag || <Icon name="globe-outline" size={12} />} → {toFlag || <Icon name="globe-outline" size={12} />}</span>
          : <span className="showcase-mode showcase-mode--local">{fromFlag || <Icon name="location-outline" size={12} />} {t('showcase.localTag')}</span>}
        {(item.rating_count ?? 0) > 0 && item.avg_stars != null && <span className="showcase-stars"><Icon name="star" size={13} /> {item.avg_stars.toFixed(1)}</span>}
      </div>

      <div className="showcase-body">
        {hasProof && <ThumbImg className="showcase-proof" src={item.proof_media_url} alt="" />}
        <div className="showcase-text">
          <div className="showcase-title"><Icon name={icon} size={16} style={{ color: 'var(--primary-text)' }} /> {item.title}</div>
          {cityLabel && <div className="showcase-city"><Icon name="location-outline" size={13} /> {cityLabel}</div>}
          <span
            className="showcase-by"
            onClick={item.created_by && onAvatar ? (e) => { e.stopPropagation(); onAvatar(item.created_by) } : undefined}
          >
            {item.creator_thumb_avatar_url
              ? <img className="showcase-avatar" src={thumbUrl(item.creator_thumb_avatar_url)} alt="" />
              : <span className="showcase-avatar showcase-avatar--fallback">{creatorName[0]?.toUpperCase() ?? '?'}</span>}
            {t('showcase.by', { name: creatorName })}{fromFlag ? ` ${fromFlag}` : ''}
          </span>
          {item.comment && <div className="showcase-comment">“{item.comment}”</div>}
        </div>
      </div>
    </button>
  )
}
