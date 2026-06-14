import { useTranslation } from 'react-i18next'

/**
 * Shared "lead with action" empty state for a city with ZERO challenges.
 * Single source of truth used by BOTH the home/city-channel screen and the
 * challenge tab - web mirror of the mobile EmptyCityChallenges. Leads with the
 * action (be the first local + a gradient-orange launch CTA), never with "no
 * challenges yet". Reuses the inspiration.* keys; {city} interpolates.
 */
export default function EmptyCityChallenges({ city, onCreate }) {
  const { t } = useTranslation('challenge')
  return (
    <div className="empty-city-challenges">
      <p className="ech-title">{t('inspiration.firstLocal', { city })}</p>
      <p className="ech-sub">{t('inspiration.firstLocalSub')}</p>
      <span className="ech-reward">{t('inspiration.reward')}</span>
      <button type="button" className="ech-cta" onClick={onCreate}>
        {t('inspiration.launchFirst')}
      </button>
    </div>
  )
}
