import { useTranslation } from 'react-i18next'
import Icon from '../Icon'

/** "Hilads pick" (full label: detail page, sheet, Compare): an editorial spot, never a player's photo. */
export function PickBadge() {
  const { t } = useTranslation('common')
  return <span className="pick-badge"><Icon name="star" size={12} />{t('pick.badge')}</span>
}

/**
 * The compact pick mark on a photo (Today strips): a small dark pill in the
 * top-left corner, a gold star and "Hilads" (a brand name: the same in every
 * locale), so it never truncates. Its parent photo box is position: relative.
 */
export function PickPill() {
  const { t } = useTranslation('common')
  return <span className="pick-pill" aria-label={t('pick.badge')}><Icon name="star" size={10} />Hilads</span>
}

/** A pick's "Good to know": context that stays when players' photos take the cover. */
export function GoodToKnow({ note }) {
  const { t } = useTranslation('common')
  if (!note) return null
  return (
    <div className="good-to-know">
      <span className="good-to-know-title">{t('pick.goodToKnow')}</span>
      <p>{note}</p>
    </div>
  )
}

/** A cover's credit: "Photo by @username", or a pick's "Photo: Jane Doe / Unsplash". */
export function PhotoCredit({ cover, className, url = null }) {
  const { t } = useTranslation('common')
  if (!cover?.by && !cover?.credit) return null
  return (
    <span className={className}>
      {cover.credit ? t('pick.credit', { credit: cover.credit }) : t('photoBy', { username: cover.by })}
      {/* The photo's page: what CC BY / BY-SA attribution asks for. */}
      {url && <> · <a href={url} target="_blank" rel="noopener noreferrer" className="photo-credit-source">{t('pick.source')}</a></>}
    </span>
  )
}

/** The author alone from a credit ("Chivista, CC0, Wikimedia Commons" → "Chivista"; "Jane Doe / Unsplash" → "Jane Doe"). */
export function creditAuthor(credit) {
  return credit.split(',')[0].split(' / ')[0].trim() || credit
}
