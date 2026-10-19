import { useTranslation } from 'react-i18next'
import Icon from '../Icon'

/** "Hilads pick": an editorial spot (never a player's answer). */
export function PickBadge() {
  const { t } = useTranslation('common')
  return <span className="pick-badge"><Icon name="star" size={12} />{t('pick.badge')}</span>
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
export function PhotoCredit({ cover, className }) {
  const { t } = useTranslation('common')
  if (!cover?.by && !cover?.credit) return null
  return <span className={className}>{cover.credit ? t('pick.credit', { credit: cover.credit }) : t('photoBy', { username: cover.by })}</span>
}
