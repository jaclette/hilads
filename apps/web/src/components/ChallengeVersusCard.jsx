import { useTranslation } from 'react-i18next'
import AttendeeAvatars from './AttendeeAvatars'
import AvatarWithFlag from './AvatarWithFlag'
import OpenChallengeSlot from './OpenChallengeSlot'
import RankBadge from './RankBadge'
import { countryToFlag } from '../lib/countryFlag'
import { Marquee } from './Marquee'

/**
 * Versus-layout challenge card. Web mirror of the mobile
 * ChallengeVersusCard.tsx: challenger avatar ← arrow → taker avatar
 * (or open slot), badges + title + participants row underneath.
 *
 * Four states map 1-to-1 to the spec, same as native:
 *   1. Available           - no taker → OpenChallengeSlot, pulses (paused
 *                            off-screen via IntersectionObserver inside)
 *   2. In Progress         - taker avatar fades + scales in (keyed on
 *                            acceptor_user_id so a fresh WS acceptance
 *                            re-triggers the entrance)
 *   3. Pseudo-Available    - same visual as state 1
 *   4. Validated           - both avatars stay, → becomes 🏆 (decorative,
 *                            non-tappable per the spec)
 *
 * Tap handling:
 *   - card click            → opens the challenge channel (existing behaviour)
 *   - open-slot click       → same destination; the accept CTA lives on
 *                             the channel page along with its guest gate
 *   - avatar click          → opens that user's profile (when onAvatarClick
 *                             provided); decorative otherwise
 *   - arrow / trophy        → pointer-events: none (decorative)
 */
export default function ChallengeVersusCard({
  challenge,
  onClick,
  onAcceptClick,
  onAvatarClick,
}) {
  const { t } = useTranslation('challenge')
  const c = challenge

  const typeIcon         = { food: '🍜', place: '📍', culture: '🎭', help: '🤝' }[c.challenge_type] ?? '🔥'
  const audienceLabel    = c.audience === 'locals' ? t('forLocals') : t('forExplorers')
  // closed = completed (one-shot, no re-take) OR manually validated/archived;
  // both show the done badge instead of "available".
  const isValidated      = c.status === 'validated' || !!c.closed
  const isInternational  = (c.mode ?? 'local') === 'international'
  const hasTaker         = !!c.acceptor_user_id

  // Country codes only flow into the avatar flag overlays when the
  // challenge is international (per spec: local cards stay flag-free
  // on the versus avatars; the inline 🇩🇪 → 🇻🇳 pill in the badge row
  // already carries the international signal).
  const challengerCountry = isInternational ? (c.country          ?? null) : null
  const takerCountry      = isInternational ? (c.acceptor_country ?? null) : null

  // Rank scope follows challenge mode: local → in_city, international
  // → worldwide. Backend already applies the score_month_ref staleness
  // guard so we just read whatever's there and pass through.
  const challengerRank = isInternational
    ? c.creator_monthly_rank_worldwide
    : c.creator_monthly_rank_in_city
  const takerRank = isInternational
    ? c.acceptor_monthly_rank_worldwide
    : c.acceptor_monthly_rank_in_city

  // Stop the avatar's onClick from also triggering the card's onClick.
  // React event bubbling, not CSS pointer-events - keeps focus/keyboard
  // behaviour intact (the inner button is still a real button).
  const handleAvatarClick = (userId) => (e) => {
    e.stopPropagation()
    if (onAvatarClick && userId) onAvatarClick(userId)
  }

  return (
    <button
      type="button"
      className="city-row event-row-card challenge-row-card"
      style={{ cursor: 'pointer', textAlign: 'left' }}
      onClick={onClick}
    >
      {/* Badge row - unchanged from the previous flat card. */}
      <div className="er-badges">
        {isInternational
          ? (() => {
              const fromFlag = countryToFlag(c.country)
              const toFlag   = countryToFlag(c.target_country) || '🌍'
              const label    = fromFlag
                ? `${fromFlag} → ${toFlag}`
                : `🌐 ${t('mode.international')}`
              return (
                <span className="challenge-badge challenge-badge--international">{label}</span>
              )
            })()
          : null /* Local = for everyone in the city; no audience pill. */}
        {(() => {
          const v = c.visibility ?? 'public'
          if (v === 'public') return null
          return (
            <span className={`challenge-badge challenge-badge--visibility challenge-badge--visibility-${v}`}>
              {t(`visibility.badge.${v}`)}
            </span>
          )
        })()}
        {/* Photo proof on a local challenge - see mobile twin for the
            reasoning. Meet stays unbadged because it's the default. */}
        {!isInternational && c.validation_method === 'photo_proof' && (
          <span className="challenge-badge challenge-badge--photo">
            📸 {t('card.photoBadge', { defaultValue: 'Photo' })}
          </span>
        )}
        {isValidated ? (
          <span className="challenge-badge challenge-badge--validated">
            ✓ {t('validatedBadge')}
          </span>
        ) : c.is_in_progress ? (
          // --in-progress (amber) instead of --status (brand orange).
          // The shared --status class is reused by interactive owner
          // controls elsewhere and reading "loud orange" on the NOW
          // feed felt overstated - switched to a calmer amber that
          // still passes the visibility bar.
          <span className="challenge-badge challenge-badge--in-progress">
            ⏳ {t('card.inProgress')}
          </span>
        ) : (
          <span className="challenge-badge challenge-badge--available">
            🟢 {t('card.available')}
          </span>
        )}
      </div>

      {/* Versus row - the hero of the card. Fixed-height; arrow / trophy
          in the middle is decorative. Each avatar slot is its own
          positioning context (.challenge-versus-avatar-stack) so the
          rank badge can absolute-anchor on top-left without leaking
          beyond its own avatar. */}
      <div className="challenge-versus-row">
        <span className="challenge-versus-avatar-stack">
          {onAvatarClick && c.created_by ? (
            <button
              type="button"
              className="challenge-versus-avatar-btn"
              onClick={handleAvatarClick(c.created_by)}
              aria-label={c.creator_display_name ?? ''}
            >
              <AvatarWithFlag
                userId={c.created_by}
                displayName={c.creator_display_name ?? '?'}
                photoUrl={c.creator_thumb_avatar_url}
                countryCode={challengerCountry}
              />
            </button>
          ) : (
            <AvatarWithFlag
              userId={c.created_by}
              displayName={c.creator_display_name ?? '?'}
              photoUrl={c.creator_thumb_avatar_url}
              countryCode={challengerCountry}
            />
          )}
          {challengerRank != null && (
            <span className="challenge-versus-rank-anchor">
              <RankBadge rank={challengerRank} ariaLabel={t('card.rankBadge', { rank: challengerRank, defaultValue: `Rank ${challengerRank}` })} />
            </span>
          )}
        </span>

        <span className="challenge-versus-center" aria-hidden="true">
          {isValidated ? '🏆' : '⚡'}
        </span>

        {hasTaker ? (
          // key on the acceptor_user_id so React unmounts + remounts when
          // a different taker lands (e.g. a fresh acceptance over WS),
          // retriggering the .challenge-versus-taker-enter animation.
          <span key={c.acceptor_user_id} className="challenge-versus-taker-enter challenge-versus-avatar-stack">
            {onAvatarClick && c.acceptor_user_id ? (
              <button
                type="button"
                className="challenge-versus-avatar-btn"
                onClick={handleAvatarClick(c.acceptor_user_id)}
                aria-label={c.acceptor_display_name ?? ''}
              >
                <AvatarWithFlag
                  userId={c.acceptor_user_id}
                  displayName={c.acceptor_display_name ?? '?'}
                  photoUrl={c.acceptor_thumb_avatar_url}
                  countryCode={takerCountry}
                />
              </button>
            ) : (
              <AvatarWithFlag
                userId={c.acceptor_user_id}
                displayName={c.acceptor_display_name ?? '?'}
                photoUrl={c.acceptor_thumb_avatar_url}
                countryCode={takerCountry}
              />
            )}
            {takerRank != null && (
              <span className="challenge-versus-rank-anchor">
                <RankBadge rank={takerRank} ariaLabel={t('card.rankBadge', { rank: takerRank, defaultValue: `Rank ${takerRank}` })} />
              </span>
            )}
          </span>
        ) : (
          <OpenChallengeSlot
            ariaLabel={t('card.takeIt', { defaultValue: 'Take it on' })}
            onClick={onAcceptClick ? (e) => { e.stopPropagation(); onAcceptClick() } : undefined}
          />
        )}
      </div>

      {/* Title + type chip. Long titles auto-scroll left through the
          same Marquee primitive the weather pill uses - short titles
          render static with the usual CSS ellipsis fallback. */}
      <div className="er-header">
        <span className="er-title">
          <span className="er-title-emoji">{typeIcon}</span>
          <Marquee text={c.title} className="er-title-marquee" fadeColor="#161210" />
        </span>
        <span className="er-going er-going--challenge">{t(`typeBadge.${c.challenge_type}`)}</span>
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
