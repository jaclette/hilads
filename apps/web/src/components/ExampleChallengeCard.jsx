import { useTranslation } from 'react-i18next'
import AvatarWithFlag from './AvatarWithFlag'
import { countryToFlag } from '../lib/countryFlag'

/**
 * Example challenge card for the zero-challenge inspiration block. Web mirror of
 * the mobile ExampleChallengeCard. Shows a real open challenge from the
 * most-active other city. The card BODY (title + creator) opens that challenge
 * (onOpen); the bottom button instead routes to LOCAL creation (onCreate).
 * International challenges show a "from -> to" flag pair.
 */
export default function ExampleChallengeCard({ example, sourceCity, currentCity, onOpen, onCreate }) {
  const { t } = useTranslation('challenge')
  const typeIcon = { food: '🍜', place: '📍', culture: '🎭', help: '🤪' }[example.challenge_type] ?? '🔥'
  const name     = example.creator_display_name || example.creator_username || '?'
  const isIntl   = example.mode === 'international'
  const fromFlag = countryToFlag(example.country)
  const toFlag   = countryToFlag(example.target_country) || '🌍'

  return (
    <div className="example-challenge-card">
      <div className="ecc-badges">
        <span className="challenge-badge challenge-badge--kind">
          {t(`typeBadge.${example.challenge_type}`)}
        </span>
        {isIntl && fromFlag && (
          <span className="challenge-badge challenge-badge--international">{fromFlag} → {toFlag}</span>
        )}
      </div>

      {/* Title + creator - clicking opens the real challenge. */}
      <button type="button" className="ecc-open" onClick={onOpen}>
        <div className="ecc-title-row">
          <span className="ecc-title-emoji">{typeIcon}</span>
          <span className="ecc-title">{example.title}</span>
        </div>
        <div className="ecc-by-row">
          <AvatarWithFlag
            userId={null}
            displayName={name}
            photoUrl={example.creator_thumb_avatar_url ?? null}
            countryCode={null}
            size={24}
          />
          <span className="ecc-by-text">{t('inspiration.by', { name, city: sourceCity })}</span>
        </div>
      </button>

      {/* Create YOUR OWN challenge locally - distinct action from opening. */}
      <button type="button" className="ecc-create-btn" onClick={onCreate}>
        {t('inspiration.createYours', { city: currentCity })}
      </button>
    </div>
  )
}
