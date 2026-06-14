import { useTranslation } from 'react-i18next'
import AvatarWithFlag from './AvatarWithFlag'

/**
 * INERT example card for the zero-challenge empty state. Web mirror of the
 * mobile ExampleChallengeCard. Reads like a real challenge card (type badge,
 * title, creator) but is deliberately NOT takeable:
 *
 *   - The card body is a plain <div>, NOT a button/link. No onClick, no
 *     challenge id, no route to the remote challenge's channel.
 *   - The ONLY interactive element is the bottom button, which routes the
 *     user to LOCAL challenge creation (onCreate) - never to the example's
 *     own city or channel.
 *
 * The backend never sends a challenge id here (title/type/creator only), so
 * there is structurally nothing to open or accept. The other city is a
 * recipe book, never a destination.
 */
export default function ExampleChallengeCard({ example, sourceCity, currentCity, onCreate }) {
  const { t } = useTranslation('challenge')
  const typeIcon = { food: '🍜', place: '📍', culture: '🎭', help: '🤝' }[example.challenge_type] ?? '🔥'
  const name     = example.creator_display_name || example.creator_username || '?'

  return (
    <div className="example-challenge-card">
      <div className="ecc-badges">
        <span className="challenge-badge challenge-badge--kind">
          {t(`typeBadge.${example.challenge_type}`)}
        </span>
      </div>

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

      {/* The ONLY action: create YOUR OWN challenge locally. */}
      <button type="button" className="ecc-create-btn" onClick={onCreate}>
        {t('inspiration.createYours', { city: currentCity })}
      </button>
    </div>
  )
}
