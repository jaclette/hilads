import { useTranslation } from 'react-i18next'
import AttendeeAvatars from './AttendeeAvatars'
import { countryToFlag } from '../lib/countryFlag'

/**
 * Web mirror of the mobile ChallengeVersusCard. This first commit extracts
 * the previous inline JSX block from App.jsx verbatim (same DOM, same
 * className surface, same i18n keys) so the versus-layout redesign can land
 * cleanly in a follow-up without mixing extraction noise with new logic.
 *
 * Props mirror the inline block's closure:
 *   - challenge   — Challenge DTO (acceptor_* fields populated server-side
 *                   for the redesign; ignored in this extraction step)
 *   - onClick     — opens the challenge drawer in App.jsx
 *
 * Until the redesign lands, this component renders an identical card to
 * the one users see today — the diff vs the extraction commit must be
 * "pure move", nothing else.
 */
export default function ChallengeVersusCard({ challenge, onClick }) {
  const { t } = useTranslation('challenge')
  const c = challenge

  const typeIcon = { food: '🍜', place: '📍', culture: '🎭', help: '🤝' }[c.challenge_type] ?? '🔥'
  const audienceLabel = c.audience === 'locals' ? t('forLocals') : t('forExplorers')
  const isValidated     = c.status === 'validated'
  const isInternational = (c.mode ?? 'local') === 'international'

  return (
    <button
      className="city-row event-row-card challenge-row-card"
      style={{ cursor: 'pointer', textAlign: 'left' }}
      onClick={onClick}
    >
      <div className="er-header">
        <span className="er-title">{typeIcon} {c.title}</span>
        <span className="er-going er-going--challenge">{t(`typeBadge.${c.challenge_type}`)}</span>
      </div>
      <div className="er-badges">
        {isInternational
          ? (() => {
              // 🇩🇪 → 🇻🇳 when both countries are known. Falls back to "🌍"
              // for the target when "anywhere" (no target_city_id) or
              // unknown. Origin always has a country since challenges are
              // created from a city.
              const fromFlag = countryToFlag(c.country)
              const toFlag   = countryToFlag(c.target_country) || '🌍'
              const label    = fromFlag
                ? `${fromFlag} → ${toFlag}`
                : `🌐 ${t('mode.international')}`
              return (
                <span className="challenge-badge challenge-badge--international">{label}</span>
              )
            })()
          : (
            <span className="challenge-badge challenge-badge--audience">{audienceLabel}</span>
          )}
        {/* Visibility badge — only renders for non-public rows so the
            NOW card stays uncluttered on the common case. */}
        {(() => {
          const v = c.visibility ?? 'public'
          if (v === 'public') return null
          return (
            <span className={`challenge-badge challenge-badge--visibility challenge-badge--visibility-${v}`}>
              {t(`visibility.badge.${v}`)}
            </span>
          )
        })()}
        {isValidated ? (
          <span className="challenge-badge challenge-badge--validated">
            ✓ {t('validatedBadge')}
          </span>
        ) : c.is_in_progress ? (
          <span className="challenge-badge challenge-badge--status">
            ⏳ {t('card.inProgress')}
          </span>
        ) : (
          <span className="challenge-badge challenge-badge--available">
            🟢 {t('card.available')}
          </span>
        )}
      </div>
      {c.creator_display_name && (
        <span className="er-host">{t('byCreator', { name: c.creator_display_name })}</span>
      )}
      <AttendeeAvatars
        preview={c.participants_preview ?? []}
        total={c.participant_count ?? 0}
      />
    </button>
  )
}
