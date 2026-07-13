import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AttendeeAvatars from './AttendeeAvatars'
import AvatarWithFlag from './AvatarWithFlag'
import OpenChallengeSlot from './OpenChallengeSlot'
import RankBadge from './RankBadge'
import { countryToFlag } from '../lib/countryFlag'
import { fetchChallengeParticipants } from '../api'
import { avatarColors } from '../lib/avatarColors'
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

  const typeIcon         = { food: '🍜', place: '📍', culture: '🎭', help: '🤪' }[c.challenge_type] ?? '🔥'
  const audienceLabel    = c.audience === 'locals' ? t('forLocals') : t('forExplorers')
  // closed = completed (one-shot, no re-take) OR manually validated/archived;
  // both show the done badge instead of "available".
  const isValidated      = c.status === 'validated' || !!c.closed
  const isInternational  = (c.mode ?? 'local') === 'international'
  const isGroup          = (c.challenge_format ?? 'legacy') === 'group'
  const hasTaker         = !!c.acceptor_user_id
  const meetSummary = (isGroup && c.meet_at)
    ? new Date(c.meet_at * 1000).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

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
    ? c.creator_alltime_rank_worldwide
    : c.creator_alltime_rank_in_city
  const takerRank = isInternational
    ? c.acceptor_alltime_rank_worldwide
    : c.acceptor_alltime_rank_in_city

  // Stop the avatar's onClick from also triggering the card's onClick.
  // React event bubbling, not CSS pointer-events - keeps focus/keyboard
  // behaviour intact (the inner button is still a real button).
  const handleAvatarClick = (userId) => (e) => {
    e.stopPropagation()
    if (onAvatarClick && userId) onAvatarClick(userId)
  }

  const acceptPill = (e) => { e.stopPropagation(); if (onAcceptClick) onAcceptClick() }
  // "Who joined" peek - opened by tapping the participant avatar stack.
  const [peek, setPeek] = useState(null)  // null | { loading, users }

  // ── GROUP CARD ──────────────────────────────────────────────────────────────
  // One challenger → a group. No "vs" duel. Mirrors the native ChallengeVersusCard
  // group branch: resolution badge + challenger-alone header + a group bottom row
  // (avatar stack + count, then join CTA for meet / deadline countdown for photo).
  if (isGroup) {
    const isGroupPhoto     = (c.validation_method ?? 'meet') === 'photo_proof' || isInternational
    const participantCount = c.participant_count ?? 0
    const submissionCount  = c.submission_count ?? 0
    const zeroParticipants = participantCount === 0
    const deadlineDaysLeft = (isGroupPhoto && c.meet_at)
      ? Math.ceil((c.meet_at * 1000 - Date.now()) / 86_400_000)
      : null
    // Meet date / submission deadline passed but not resolved yet → "ended",
    // never "Available" + Join (you can't join a finished meet or submit late).
    const isEnded = !isValidated && c.meet_at != null && (c.meet_at * 1000) < Date.now()
    // International shows the full route "🇻🇳 Origin → 🇧🇷 Target" with flags.
    const groupLocation = (isInternational && c.city_name && c.target_city_name)
      ? `${countryToFlag(c.country ?? null)} ${c.city_name} → ${countryToFlag(c.target_country ?? null) || '🌍'} ${c.target_city_name}`
      : (c.venue || c.target_city_name || null)
    const groupSubtitle = [
      c.creator_display_name ? t('byCreator', { name: c.creator_display_name }) : null,
      groupLocation,
      !isGroupPhoto && meetSummary ? meetSummary : null,
    ].filter(Boolean).join('  ·  ')

    const openPeek = (e) => {
      e.stopPropagation()
      setPeek({ loading: true, users: c.participants_preview ?? [] })
      fetchChallengeParticipants(c.id)
        .then((r) => setPeek({ loading: false, users: r.participants || [] }))
        .catch(() => setPeek((p) => ({ loading: false, users: p?.users ?? [] })))
    }

    return (
      <>
      <button
        type="button"
        className={`city-row event-row-card challenge-row-card challenge-card-group${zeroParticipants && !isValidated ? ' challenge-card-group--accent' : ''}`}
        style={{ cursor: 'pointer', textAlign: 'left' }}
        onClick={onClick}
      >
        {/* Top: resolution badge, category, then status (pushed right). */}
        <div className="er-badges">
          <span className={`challenge-badge ${isGroupPhoto ? 'challenge-badge--photo' : 'challenge-badge--meet'}`}>
            {isGroupPhoto
              ? `📸 ${t('card.photoBadge', { defaultValue: 'Photo proof' })}`
              : `📍 ${t('card.meetBadge', { defaultValue: 'Meet' })}`}
          </span>
          <span className="challenge-badge challenge-badge--kind">{t(`typeBadge.${c.challenge_type}`)}</span>
          {/* Photo-proof deadline lives up here with the status so the bottom
              row can carry the Join CTA. */}
          {!isValidated && !isEnded && isGroupPhoto && deadlineDaysLeft != null && (
            <span className="challenge-badge challenge-group-deadline" style={{ marginLeft: 'auto' }}>
              ⏳ {deadlineDaysLeft >= 2
                ? t('card.daysLeft', { count: deadlineDaysLeft, defaultValue: '{{count}}d left' })
                : t('card.lastDay', { defaultValue: 'Expires soon' })}
            </span>
          )}
          {isValidated ? (
            <span className="challenge-badge challenge-badge--validated" style={(!isGroupPhoto || deadlineDaysLeft == null) ? { marginLeft: 'auto' } : undefined}>
              ✓ {t('validatedBadge')}
            </span>
          ) : isEnded ? (
            <span className="challenge-badge challenge-badge--ended" style={{ marginLeft: 'auto' }}>
              ⌛ {t('card.ended', { defaultValue: 'Ended' })}
            </span>
          ) : (
            <span className="challenge-badge challenge-badge--available" style={(!isGroupPhoto || deadlineDaysLeft == null) ? { marginLeft: 'auto' } : undefined}>
              🟢 {t('card.available')}
            </span>
          )}
        </div>

        {/* Challenger alone + title + subtitle. No facing avatar. */}
        <div className="challenge-group-header">
          <span className="challenge-versus-avatar-stack challenge-group-host">
            {onAvatarClick && c.created_by ? (
              <button
                type="button"
                className="challenge-versus-avatar-btn"
                onClick={handleAvatarClick(c.created_by)}
                aria-label={c.creator_display_name ?? ''}
              >
                <AvatarWithFlag userId={c.created_by} displayName={c.creator_display_name ?? '?'} photoUrl={c.creator_thumb_avatar_url} countryCode={challengerCountry} />
              </button>
            ) : (
              <AvatarWithFlag userId={c.created_by} displayName={c.creator_display_name ?? '?'} photoUrl={c.creator_thumb_avatar_url} countryCode={challengerCountry} />
            )}
            {challengerRank != null && (
              <span className="challenge-versus-rank-anchor">
                <RankBadge rank={challengerRank} ariaLabel={t('card.rankBadge', { rank: challengerRank, defaultValue: `Rank ${challengerRank}` })} />
              </span>
            )}
          </span>
          <div className="challenge-group-headtext">
            <span className="er-title">
              <span className="er-title-emoji">{typeIcon}</span>
              <Marquee text={c.title} className="er-title-marquee" fadeColor="#161210" />
            </span>
            {groupSubtitle ? <span className="challenge-group-subtitle">{groupSubtitle}</span> : null}
          </div>
        </div>

        {/* Bottom = the GROUP dimension. Lead with action; the left side only
            carries a count once there's something real to count - never
            "0 photos" / "no one joined" (those read as dead). */}
        <div className="challenge-group-bottom">
          {isEnded ? (
            <>
              {participantCount > 0 ? (
                <span className="challenge-group-stackwrap challenge-group-stackwrap--tappable" role="button" tabIndex={0} onClick={openPeek}>
                  <AttendeeAvatars preview={(c.participants_preview ?? []).slice(0, 4)} total={participantCount} />
                  {(!isGroupPhoto || submissionCount >= 1) && (
                    <span className="challenge-group-count">
                      {isGroupPhoto
                        ? `📸 ${t('card.photosCount', { count: submissionCount, defaultValue: '{{count}} photos' })}`
                        : t('card.joinedCount', { count: participantCount, defaultValue: '{{count}} joined' })}
                    </span>
                  )}
                </span>
              ) : <span style={{ flex: 1 }} />}
              <span className="challenge-group-pill challenge-group-pill--ended">
                ⌛ {t('card.awaitingResults', { defaultValue: 'Awaiting results' })}
              </span>
            </>
          ) : zeroParticipants ? (
            <>
              <span style={{ flex: 1 }} />
              <span role="button" tabIndex={0} className="challenge-group-pill challenge-group-pill--first" onClick={acceptPill}>
                {t('card.beFirst', { defaultValue: '⚡ Be the first · +2' })}
              </span>
            </>
          ) : (
            <>
              <span className="challenge-group-stackwrap challenge-group-stackwrap--tappable" role="button" tabIndex={0} onClick={openPeek}>
                <AttendeeAvatars preview={(c.participants_preview ?? []).slice(0, 4)} total={participantCount} />
                {(!isGroupPhoto || submissionCount >= 1) && (
                  <span className="challenge-group-count">
                    {isGroupPhoto
                      ? `📸 ${t('card.photosCount', { count: submissionCount, defaultValue: '{{count}} photos' })}`
                      : t('card.joinedCount', { count: participantCount, defaultValue: '{{count}} joined' })}
                  </span>
                )}
              </span>
              {/* Join CTA - group challenges stay open, so always invite more
                  people in (meet AND photo). */}
              <span role="button" tabIndex={0} className="challenge-group-pill challenge-group-pill--join" onClick={acceptPill}>
                {t('card.joinGroup', { defaultValue: 'Join the challenge' })} ⚡
              </span>
            </>
          )}
        </div>
      </button>

      {/* "Who joined" peek - read-only list of everyone in the group. */}
      {peek && (
        <div className="gmp-backdrop" onClick={() => setPeek(null)}>
          <div className="gmp-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="gmp-head">
              <span className="gmp-title">👥 {t('card.whoJoined', { count: participantCount, defaultValue: 'Who joined ({{count}})' })}</span>
              <button type="button" className="gmp-close" onClick={() => setPeek(null)} aria-label="Close">✕</button>
            </div>
            {peek.loading && peek.users.length === 0 ? (
              <p className="gmp-empty">…</p>
            ) : peek.users.length === 0 ? (
              <p className="gmp-empty">{t('group.noParticipants', { defaultValue: 'Nobody has joined yet.' })}</p>
            ) : (
              <div className="gmp-list">
                {peek.users.map((u) => {
                  const [a1, a2] = avatarColors(u.id)
                  // Card preview is camelCase; /participants is snake_case.
                  const name  = u.displayName ?? u.display_name ?? '?'
                  const photo = u.thumbAvatarUrl || u.avatarUrl || u.profile_thumb_photo_url || u.profile_photo_url
                  return (
                    <button
                      key={u.id}
                      type="button"
                      className="gmp-row"
                      onClick={() => { setPeek(null); onAvatarClick?.(u.id) }}
                    >
                      <span className="gmp-avatar" style={{ background: `linear-gradient(135deg, ${a1}, ${a2})` }}>
                        {photo ? <img src={photo} alt="" /> : (name?.[0] ?? '?').toUpperCase()}
                      </span>
                      <span className="gmp-name">{name}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
      </>
    )
  }

  // ── LEGACY CARD (1-to-1 duel) - unchanged; drains as legacy challenges end ──
  return (
    <button
      type="button"
      className={`city-row event-row-card challenge-row-card${c.is_campaign ? ' challenge-row-card--campaign' : ''}`}
      style={{ cursor: 'pointer', textAlign: 'left' }}
      onClick={onClick}
    >
      {/* Badge row - unchanged from the previous flat card. */}
      <div className="er-badges">
        {c.is_campaign && (
          <span className="challenge-badge challenge-badge--campaign">⚡ {t('campaignBadge', { defaultValue: '2× points' })}</span>
        )}
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
      {/* Bottom attendee row - spectators who joined a legacy challenge. */}
      <AttendeeAvatars
        preview={c.participants_preview ?? []}
        total={c.participant_count ?? 0}
      />
    </button>
  )
}
