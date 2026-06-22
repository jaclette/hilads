import { thumbUrl } from '../lib/imageThumb'
import { createPortal } from 'react-dom'
import ThumbImg from './ThumbImg'
import { useTranslation } from 'react-i18next'
import { countryToFlag } from '../lib/countryFlag'

const TYPE_ICON = { food: '🍜', place: '📍', culture: '🎭', help: '🤪' }

function Person({ label, name, avatar, country, userId, onAvatar }) {
  const flag = countryToFlag(country)
  const initial = (name || '?')[0]?.toUpperCase() ?? '?'
  return (
    <button
      type="button"
      className="showcase-person"
      onClick={userId && onAvatar ? () => onAvatar(userId) : undefined}
    >
      {avatar
        ? <img className="showcase-person-avatar" src={avatar} alt="" />
        : <span className="showcase-person-avatar showcase-person-avatar--fallback">{initial}</span>}
      <span className="showcase-person-text">
        <span className="showcase-person-label">{label}</span>
        <span className="showcase-person-name">{name || '—'}{flag ? ` ${flag}` : ''}</span>
      </span>
    </button>
  )
}

/**
 * Tapping a showcase card opens this preview (not the challenge): a bigger
 * photo, who the challenger + taker were, the appreciation note, and a
 * "Try this challenge" CTA that kicks off a new challenge from the same idea.
 */
export default function ShowcasePreviewModal({ item, onClose, onTry, onAvatar }) {
  const { t } = useTranslation('challenge')
  if (!item) return null

  const intl     = item.mode === 'international'
  const icon     = TYPE_ICON[item.challenge_type] ?? '🔥'
  const fromFlag = countryToFlag(item.country)
  const toFlag   = countryToFlag(item.target_country)
  const hasProof = item.proof_media_url && item.proof_media_type === 'image'
  const cityLabel = intl
    ? [item.city_name, item.target_city_name].filter(Boolean).join(' → ')
    : item.city_name

  // Portal to <body> - rendered inside .full-page (a z-index:200 stacking
  // context) the sheet's bottom would hide behind the .bottom-nav (z-300).
  return createPortal((
    <div className="showcase-preview-backdrop" onClick={onClose}>
      <div className="showcase-preview" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="showcase-preview-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="showcase-preview-scroll">
          {hasProof && <ThumbImg className="showcase-preview-proof" src={item.proof_media_url} alt="" />}

          <div className="showcase-badges">
            {intl
              ? <span className="showcase-mode showcase-mode--intl">{(fromFlag || '🌐')} → {(toFlag || '🌍')}</span>
              : <span className="showcase-mode showcase-mode--local">{(fromFlag || '📍')} {t('showcase.localTag')}</span>}
            {(item.rating_count ?? 0) > 0 && item.avg_stars != null && <span className="showcase-stars">★ {item.avg_stars.toFixed(1)}</span>}
          </div>

          <div className="showcase-preview-title">{icon} {item.title}</div>
          {cityLabel && <div className="showcase-city showcase-city--preview">📍 {cityLabel}</div>}

          <div className="showcase-people">
            <Person
              label={t('challengerTag')}
              name={item.creator_display_name}
              avatar={thumbUrl(item.creator_thumb_avatar_url)}
              country={item.country}
              userId={item.created_by}
              onAvatar={onAvatar}
            />
            {item.acceptor_display_name && (
              <Person
                label={t('card.takerLabel')}
                name={item.acceptor_display_name}
                avatar={item.acceptor_thumb_avatar_url}
                country={item.acceptor_country}
                userId={item.acceptor_user_id}
                onAvatar={onAvatar}
              />
            )}
          </div>

          {(item.creator_comment || item.acceptor_comment || item.comment) && (
            <div className="showcase-note">
              <div className="showcase-note-label">{t('showcase.note')}</div>
              {item.creator_comment && (
                <div className="showcase-note-quote">
                  <span className="showcase-note-who">
                    {(item.creator_display_name ?? t('challengerTag'))} <span className="showcase-note-role">· {t('challengerTag')}</span>
                  </span>
                  <span className="showcase-note-text">“{item.creator_comment}”</span>
                </div>
              )}
              {item.acceptor_comment && (
                <div className="showcase-note-quote">
                  <span className="showcase-note-who">
                    {(item.acceptor_display_name ?? t('card.takerLabel'))} <span className="showcase-note-role">· {t('card.takerLabel')}</span>
                  </span>
                  <span className="showcase-note-text">“{item.acceptor_comment}”</span>
                </div>
              )}
              {/* Fallback (legacy rows with only a single unattributed comment):
                  attribute to the challenger - host_comment is always theirs. */}
              {!item.creator_comment && !item.acceptor_comment && item.comment && (
                <div className="showcase-note-quote">
                  <span className="showcase-note-who">
                    {(item.creator_display_name ?? t('challengerTag'))} <span className="showcase-note-role">· {t('challengerTag')}</span>
                  </span>
                  <span className="showcase-note-text">“{item.comment}”</span>
                </div>
              )}
            </div>
          )}
        </div>

        <button type="button" className="showcase-try-btn" onClick={() => onTry(item)}>
          🔥 {t('showcase.tryCta')}
        </button>
      </div>
    </div>
  ), document.body)
}
