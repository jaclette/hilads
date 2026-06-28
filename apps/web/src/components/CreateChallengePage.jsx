import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createChallenge, updateChallenge, fetchChannels, dismissPublicOptin } from '../api'
import DatePickerModal from './DatePickerModal'
import BackButton from './BackButton'

// max_participants retired (1:1 model). Constants removed; the stepper UI
// went with them.

/**
 * Web equivalent of mobile's app/challenge/create.tsx. Same 3 fields per spec
 * (audience toggle + 4 type squares + title); orange brand accents to match
 * mobile CreateChallengeScreen. Reuses the existing .full-page / .page-header
 * / .cef-* class skeleton so it inherits CreateTopicPage styling instead of
 * shipping a new CSS layer.
 *
 * On submit: hits POST /channels/{cityId}/challenges (Phase 2 backend). On
 * success, calls onCreated(challenge) so the host App.jsx can route to the
 * just-created challenge via setActiveChallenge.
 */

const TYPES     = [
  { value: 'food',    icon: '🍜' },
  { value: 'place',   icon: '📍' },
  { value: 'culture', icon: '🎭' },
  { value: 'help',    icon: '🤪' },
]
const AUDIENCES = [
  // 'explorers' is kept as the technical key (DB value, API enum). The
  // user-visible label was renamed to Travelers / Voyageurs / etc.
  { value: 'locals',    icon: '🏠' },
  { value: 'explorers', icon: '🧳' },
]

// Validation method - only relevant for local challenges. International
// is locked to 'photo_proof' server-side. Meet earns +50 mutual-rating
// bonus on top of the base points; Photo earns base only.
const VALIDATION_METHODS = [
  { value: 'meet',        icon: '🤝' },
  { value: 'photo_proof', icon: '📸' },
]
const MEET_BONUS_POINTS = 50

/**
 * Input with an animated marquee placeholder. When the placeholder text is
 * wider than the input, the overlay slides left to reveal the end, then back.
 * Native `placeholder` is suppressed; the overlay disappears as soon as the
 * input has a value or is focused (so the user can actually type).
 *
 * Animation is a single ResizeObserver-keyed CSS variable - no JS-driven loop,
 * the browser handles the easing. If the text fits, the animation collapses
 * to a no-op (the variable resolves to 0px).
 */
function MarqueePlaceholderInput({ placeholder, value, onChange, ...rest }) {
  const inputRef    = useRef(null)
  const overlayRef  = useRef(null)
  const textRef     = useRef(null)
  const [focused,   setFocused]   = useState(false)
  const [shiftPx,   setShiftPx]   = useState(0)

  // Recompute the marquee shift whenever the placeholder text or container
  // width changes. shift = how far we need to slide the text LEFT to bring
  // the right edge into view, plus a small buffer.
  useEffect(() => {
    const overlay = overlayRef.current
    const text    = textRef.current
    if (!overlay || !text) return
    const recalc = () => {
      const overflow = text.scrollWidth - overlay.clientWidth
      setShiftPx(overflow > 4 ? -(overflow + 8) : 0)
    }
    recalc()
    const ro = new ResizeObserver(recalc)
    ro.observe(overlay)
    return () => ro.disconnect()
  }, [placeholder])

  const showOverlay = !value && !focused

  return (
    <div className="cef-input-wrap">
      <input
        ref={inputRef}
        className="cef-input"
        type="text"
        value={value}
        onChange={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        /* Suppress native placeholder - the overlay replaces it. */
        placeholder=""
        {...rest}
      />
      {showOverlay && (
        <div
          ref={overlayRef}
          className={`cef-input-marquee${shiftPx < 0 ? ' cef-input-marquee--active' : ''}`}
          style={{ '--cef-marquee-shift': `${shiftPx}px` }}
          aria-hidden="true"
        >
          <span ref={textRef} className="cef-input-marquee-text">{placeholder}</span>
        </div>
      )}
    </div>
  )
}

export default function CreateChallengePage({ channelId, guest, account, editChallenge = null, prefill = null, onCreated, onUpdated, onBack, onPublicOptinDismissed }) {
  const { t } = useTranslation('city')
  const isEdit = !!editChallenge

  // Edit mode pre-populates from the existing challenge; create starts fresh.
  const [mode,            setMode]            = useState(editChallenge?.mode             ?? 'local')
  // Validation method - local-only choice. International rows are
  // forced to 'photo_proof' server-side. Default 'meet' preserves
  // the historical IRL flow + carries the +50 bonus.
  const [validationMethod, setValidationMethod] = useState(editChallenge?.validation_method ?? 'meet')
  const [audience,        setAudience]        = useState(editChallenge?.audience         ?? 'locals')
  // prefill seeds a fresh challenge from a "Success challenges" story
  // (title + type only); editChallenge always wins when present.
  const [type,            setType]            = useState(editChallenge?.challenge_type   ?? prefill?.challenge_type ?? 'food')
  const [title,           setTitle]           = useState(editChallenge?.title            ?? prefill?.title          ?? '')
  const [returnClause,    setReturnClause]    = useState(editChallenge?.return_clause    ?? '')
  // International-only state. Channel id for target city is stored as a
  // string ('city_<int>' minus the prefix once we ship the picker UI, but
  // for now we just use the numeric channel id like the rest of the API).
  const [targetCity,      setTargetCity]      = useState(() => {
    if (!editChallenge?.target_city_id) return null
    // Server returns 'city_<int>' on the row; the picker stores the numeric
    // channel id (string-form) to match how channelId is passed everywhere
    // else on the client.
    const numeric = String(editChallenge.target_city_id).replace(/^city_/, '')
    return { channelId: numeric, name: '', country: '' }
  })
  const [cityPickerOpen,  setCityPickerOpen]  = useState(false)
  const [proofRequirements, setProofRequirements] = useState(editChallenge?.proof_requirements ?? '')
  // First user edit pins the return clause - type switches after that won't
  // overwrite it. In edit mode the stored clause is treated as pinned from the
  // start (we never want to clobber what the creator already saved).
  const returnClauseDirty                     = useRef(!!editChallenge?.return_clause)
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState(null)

  // Group meet (Phase 4): a LOCAL MEET challenge is a GROUP challenge - the
  // creator sets one meet date + place at creation (DatePickerModal returns
  // startsAt + endsAt + venue). Required to submit. Create-path only for now.
  const [meetAt,         setMeetAt]         = useState(null)
  const [meetEndsAt,     setMeetEndsAt]     = useState(null)
  const [meetVenue,      setMeetVenue]      = useState(null)
  const [meetPickerOpen, setMeetPickerOpen] = useState(false)
  const [meetError,      setMeetError]      = useState(false)
  // Photo-proof group (P4): photo_proof (local) + international challenges are
  // GROUP with a submission DEADLINE (preset hours; reuses meet_at). Meet group
  // keeps the date+place picker.
  const [deadlineHours,  setDeadlineHours]  = useState(null)
  const isGroupMeet  = !isEdit && mode === 'local' && validationMethod === 'meet'
  const isGroupPhoto = !isEdit && (validationMethod === 'photo_proof' || mode === 'international')
  const isGroup = isGroupMeet || isGroupPhoto

  // Visibility selector. International rows are always public - the toggle
  // is rendered but locked, with a tooltip explaining why. Private isn't
  // settable at input time (route enforces it; the mutual privacy flow is
  // the only path) so the toggle here is two-state: public | friends.
  const [visibility, setVisibility] = useState(() => {
    if (editChallenge?.visibility === 'friends') return 'friends'
    // 'private' rows (came from the mutual flow) read back to the form as
    // a friends-default - the edit form can downgrade them, but never
    // re-set to private here.
    return 'public'
  })

  // First-time opt-in modal: when the user is about to submit a public
  // challenge AND they've never seen this warning, intercept the submit
  // and show the modal. Once they confirm (or flip to friends) we
  // proceed; the dismiss endpoint marks the flag so we don't show again.
  const [optinOpen,         setOptinOpen]         = useState(false)
  const [optinDismissing,   setOptinDismissing]   = useState(false)
  const pendingSubmitRef    = useRef(null)
  const hasSeenPublicOptin  = !!account?.has_seen_public_optin

  // Visibility is locked to 'public' whenever mode flips to International.
  // Keep the state in sync so the submit payload always matches what the
  // server will enforce anyway (defence: avoid a confusing rejection).
  useEffect(() => {
    if (mode === 'international' && visibility !== 'public') {
      setVisibility('public')
    }
  }, [mode, visibility])

  // Re-template the return clause whenever the type changes, unless the user
  // has already edited it manually.
  useEffect(() => {
    if (returnClauseDirty.current) return
    setReturnClause(t(`returnClauseTemplates.${type}`, { ns: 'challenge' }))
  }, [type, t])

  async function performSubmit() {
    const trimmed       = title.trim()
    const trimmedClause = mode === 'local'        ? (returnClause.trim()      || null) : null
    const trimmedProof  = mode === 'international' ? (proofRequirements.trim() || null) : null
    const targetForApi  = mode === 'international' ? (targetCity?.channelId ?? null)   : null
    // International is forced to 'public' server-side - match it here so
    // the payload is honest about the user's intent.
    const visibilityForApi = mode === 'international' ? 'public' : visibility
    setSubmitting(true)
    setError(null)
    try {
      if (isEdit) {
        const updated = await updateChallenge(editChallenge.id, guest.guestId, trimmed, type, audience, trimmedClause, {
          targetCityChannelId: targetForApi,
          proofRequirements:   trimmedProof,
          visibility:          visibilityForApi,
        })
        onUpdated?.(updated)
      } else {
        const nickname = account?.display_name ?? guest?.nickname ?? null
        const challenge = await createChallenge(channelId, guest.guestId, nickname, trimmed, type, audience, trimmedClause, {
          mode,
          targetCityChannelId: targetForApi,
          proofRequirements:   trimmedProof,
          // Local-only choice; server forces 'photo_proof' for international.
          validationMethod:    mode === 'local' ? validationMethod : null,
          visibility:          visibilityForApi,
          // Group: meet → date + place; photo-proof → submission deadline.
          ...(isGroup ? {
            format:     'group',
            meetAt:     isGroupMeet ? meetAt : Math.floor(Date.now() / 1000) + ((deadlineHours ?? 0) * 3600),
            meetEndsAt: isGroupMeet ? meetEndsAt : null,
            venue:      isGroupMeet ? meetVenue : null,
          } : {}),
        })
        onCreated?.(challenge)
      }
    } catch (err) {
      // Moderation hit - surface a translation-aware message so the user
      // knows to rephrase (the server never tells us which word matched).
      if (err?.code === 'moderation_blocked') {
        setError(t('visibility.moderationBlocked', { ns: 'challenge' }))
      } else {
        setError(err?.message || t('create.challengeErrStart'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim() || submitting) return

    // Group meet requires a date; the place is OPTIONAL (the picker labels it
    // so). Photo-proof group requires a deadline.
    if (isGroupMeet && !meetAt) {
      setMeetError(true)
      setError(t('group.meetRequired', { ns: 'challenge', defaultValue: 'Pick a date for the meet.' }))
      return
    }
    if (isGroupPhoto && !deadlineHours) {
      setError(t('group.deadlineRequired', { ns: 'challenge', defaultValue: 'Choose how long the challenge runs.' }))
      return
    }

    // Public + first-time → show the opt-in modal and stash a continuation.
    // Friends + edit-flow + already-seen all bypass the modal.
    const wantsPublic = (mode === 'international') || visibility === 'public'
    if (!isEdit && wantsPublic && !hasSeenPublicOptin) {
      pendingSubmitRef.current = performSubmit
      setOptinOpen(true)
      return
    }
    await performSubmit()
  }

  async function handleOptinConfirm() {
    // Best-effort dismiss - never block the create on the dismiss call
    // failing. The modal closes either way; the next session will just
    // show it once more. Cheap and forgiving.
    setOptinDismissing(true)
    try {
      await dismissPublicOptin()
      onPublicOptinDismissed?.()
    } catch { /* best-effort */ }
    setOptinDismissing(false)
    setOptinOpen(false)
    const next = pendingSubmitRef.current
    pendingSubmitRef.current = null
    if (next) await next()
  }

  function handleOptinSwitchToFriends() {
    setVisibility('friends')
    setOptinOpen(false)
    pendingSubmitRef.current = null
    // The user explicitly chose Friends - we DON'T mark optin as seen
    // (they didn't agree to Public, they ducked it). Next time they try
    // Public, they'll see the modal again. That's the intended shape:
    // the modal teaches what Public means; ducking is not learning.
  }

  return (
    <div className="full-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{t('create.challengePageTitle')}</span>
      </div>

      <div className="page-body">
        <form className="cef-form" onSubmit={handleSubmit}>

          {/* Mode toggle - Local (hero) vs International. Edit mode locks
              this - mode is not editable; delete+recreate is the path. */}
          <div className="cef-section">
            <p className="cef-label">{t('mode.label', { ns: 'challenge' })}</p>
            <div className="cef-audience-row">
              {['local', 'international'].map(m => {
                const selected = mode === m
                const locked   = isEdit && !selected
                return (
                  <button
                    key={m}
                    type="button"
                    className={`cef-audience-btn${selected ? ' selected' : ''}${locked ? ' cef-audience-btn--locked' : ''}`}
                    onClick={() => !isEdit && setMode(m)}
                    disabled={locked}
                  >
                    <span className="cef-audience-emoji" aria-hidden="true">{m === 'local' ? '🏙️' : '🌐'}</span>
                    <span>{t(`mode.${m}`, { ns: 'challenge' })}</span>
                  </button>
                )
              })}
            </div>
            <p className="cef-hint">
              {mode === 'local'
                ? t('mode.localHint',         { ns: 'challenge' })
                : t('mode.internationalHint', { ns: 'challenge' })}
            </p>
          </div>

          {/* "Who's it for?" (Locals / Travelers) removed - the audience idea was
              dropped (mobile already removed it). audience stays 'locals' by
              default so the API enum is still satisfied. */}

          {/* Validation method (Local only). Meet is celebrated with the
              +50 bonus chip below; Photo is the lower-friction
              alternative (no chip, no negative copy). */}
          {mode === 'local' && (
            <div className="cef-section">
              <p className="cef-label">{t('validation.label', { ns: 'challenge', defaultValue: 'How will you validate?' })}</p>
              <div className="cef-audience-row">
                {VALIDATION_METHODS.map(vm => (
                  <button
                    key={vm.value}
                    type="button"
                    className={`cef-audience-btn${validationMethod === vm.value ? ' selected' : ''}`}
                    onClick={() => setValidationMethod(vm.value)}
                  >
                    <span className="cef-audience-emoji" aria-hidden="true">{vm.icon}</span>
                    <span>{t(`validation.${vm.value}.label`, { ns: 'challenge', defaultValue: vm.value === 'meet' ? 'Meet' : 'Photo proof' })}</span>
                    <span className="cef-audience-hint">
                      {t(`validation.${vm.value}.hint`, { ns: 'challenge', defaultValue: vm.value === 'meet' ? 'share the experience in person' : 'accept proof at a distance' })}
                    </span>
                  </button>
                ))}
              </div>
              {validationMethod === 'meet' && (
                <div className="cef-bonus-chip" role="status">
                  {t('validation.meet.bonusChip', {
                    ns: 'challenge',
                    points: MEET_BONUS_POINTS,
                    defaultValue: `🏆 Meet bonus: +${MEET_BONUS_POINTS} pts on top of the base reward`,
                  })}
                </div>
              )}

              {/* Group meet: one date + place, set at creation. Required. */}
              {isGroupMeet && (
                <div style={{ marginTop: 12 }}>
                  <p className="cef-label">{t('group.meetLabel', { ns: 'challenge', defaultValue: 'When & where' })}</p>
                  <button
                    type="button"
                    onClick={() => setMeetPickerOpen(true)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                      padding: '12px 14px', borderRadius: 12, background: 'var(--bg2, #1a1614)',
                      border: `1px solid ${meetError ? '#FF6B5C' : 'var(--border, #2a2422)'}`,
                      color: 'var(--text, #eee)', fontSize: 14, cursor: 'pointer', textAlign: 'left', gap: 8,
                    }}
                  >
                    <span>
                      {meetAt
                        ? `📅 ${new Date(meetAt * 1000).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}${meetVenue ? `  ·  📍 ${meetVenue}` : ''}`
                        : t('group.meetCta', { ns: 'challenge', defaultValue: 'Set the meet date' })}
                    </span>
                    <span aria-hidden style={{ opacity: 0.6 }}>›</span>
                  </button>
                  <p className="cef-hint" style={meetError ? { color: '#FF6B5C' } : undefined}>
                    {meetError
                      ? t('group.meetRequired', { ns: 'challenge', defaultValue: 'Pick a date for the meet.' })
                      : t('group.meetHint', { ns: 'challenge', defaultValue: 'Everyone who joins meets here together. You validate who showed up afterwards.' })}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Target city (International only) - opens picker. Null = anywhere. */}
          {mode === 'international' && (
            <div className="cef-section">
              <p className="cef-label">{t('intl.targetCityLabel', { ns: 'challenge' })}</p>
              <button
                type="button"
                className="cef-city-picker-btn"
                onClick={() => setCityPickerOpen(true)}
              >
                <span>{targetCity?.name
                  ? `${targetCity.name}${targetCity.country ? ' · ' + targetCity.country : ''}`
                  : t('intl.targetCityAnywhere', { ns: 'challenge' })}</span>
                <span aria-hidden="true">›</span>
              </button>
              <p className="cef-hint">{t('intl.targetCityHint', { ns: 'challenge' })}</p>
            </div>
          )}

          {/* Type - 4 emoji squares */}
          <div className="cef-section">
            <p className="cef-label">{t('create.challengeType')}</p>
            <div className="cef-type-grid">
              {TYPES.map(tp => (
                <button
                  key={tp.value}
                  type="button"
                  className={`cef-type-btn${type === tp.value ? ' selected' : ''}`}
                  onClick={() => setType(tp.value)}
                >
                  <span style={{ fontSize: 26 }}>{tp.icon}</span>
                  <span className="cef-type-label">
                    {tp.value === 'food'    ? t('create.challengeTypeFood')
                     : tp.value === 'place' ? t('create.challengeTypePlace')
                     : tp.value === 'culture' ? t('create.challengeTypeCulture')
                     :                        t('create.challengeTypeHelp')}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Title - native placeholder is suppressed and overlayed by an
              auto-marquee span. Long localised hints ("e.g. Bring me to your
              favorite hidden coffee spot") overflow mobile-width inputs, so
              the overlay slides left-and-back when it actually overflows.
              Pure CSS animation; only activates via JS once we know the
              measured widths. Hidden as soon as the user starts typing. */}
          <div className="cef-section">
            <label className="cef-label">{t('create.challengeTitleLabel')}</label>
            <MarqueePlaceholderInput
              placeholder={t(`titlePh.${type}`, { ns: 'challenge', defaultValue: t('create.challengeTitlePlaceholder') })}
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={100}
              autoFocus
            />
          </div>

          {/* Photo-proof group: a submission DEADLINE (reuses meet_at). Shown
              for both local-photo and international. Presets keep it one tap. */}
          {isGroupPhoto && (
            <div className="cef-section">
              <p className="cef-label">{t('group.deadlineLabel', { ns: 'challenge', defaultValue: 'Submission deadline' })}</p>
              <div className="cef-segmented" role="radiogroup">
                {[
                  { h: 24,  k: 'group.deadline24h', dv: '24h' },
                  { h: 72,  k: 'group.deadline3d',  dv: '3 days' },
                  { h: 168, k: 'group.deadline1w',  dv: '1 week' },
                ].map(opt => (
                  <button
                    key={opt.h}
                    type="button"
                    role="radio"
                    aria-checked={deadlineHours === opt.h}
                    className={`cef-segment ${deadlineHours === opt.h ? 'cef-segment--active' : ''}`}
                    onClick={() => setDeadlineHours(opt.h)}
                  >
                    <span>{t(opt.k, { ns: 'challenge', defaultValue: opt.dv })}</span>
                  </button>
                ))}
              </div>
              <p className="cef-hint">
                {t('group.deadlineHint', { ns: 'challenge', defaultValue: 'Everyone who joins submits a photo before the deadline. You pick the winner afterwards.' })}
              </p>
            </div>
          )}

          {/* Visibility - two-state pill (Public / Friends). Locked to
              Public when mode=international with a tooltip explaining why.
              Private isn't settable here - only via the mutual privacy
              flow once the challenge has an acceptor. */}
          <div className="cef-section">
            <p className="cef-label">{t('visibility.label', { ns: 'challenge' })}</p>
            <div className="cef-segmented" role="radiogroup">
              {['public', 'friends'].map(v => {
                const selected = visibility === v
                const isFriendsAndIntl = v === 'friends' && mode === 'international'
                return (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-disabled={isFriendsAndIntl}
                    disabled={isFriendsAndIntl}
                    title={isFriendsAndIntl ? t('visibility.intlLocked', { ns: 'challenge' }) : undefined}
                    className={`cef-segment ${selected ? 'cef-segment--active' : ''} ${isFriendsAndIntl ? 'cef-segment--disabled' : ''}`}
                    onClick={() => !isFriendsAndIntl && setVisibility(v)}
                  >
                    <span>{t(`visibility.${v}`, { ns: 'challenge' })}</span>
                  </button>
                )
              })}
            </div>
            <p className="cef-hint">
              {mode === 'international'
                ? t('visibility.intlLocked', { ns: 'challenge' })
                : t(visibility === 'public' ? 'visibility.publicHint' : 'visibility.friendsHint', { ns: 'challenge' })}
            </p>
          </div>

          {/* Return clause (Local only) - the "...and come tell me about
              it in person" half. Pre-filled per type; user-editable; first
              edit pins it. Forces every Local challenge to lead to a real
              meetup (the heart of the redesign). */}
          {mode === 'local' && (
            <div className="cef-section">
              <label className="cef-label">{t('returnClauseLabel', { ns: 'challenge' })}</label>
              <input
                className="cef-input"
                type="text"
                value={returnClause}
                onChange={e => { returnClauseDirty.current = true; setReturnClause(e.target.value) }}
                placeholder={t('returnClauseTemplates.food', { ns: 'challenge' })}
                maxLength={200}
              />
            </div>
          )}

          {/* Proof requirements (International only) - creator-authored spec
              shown to the acceptor before they submit their proof. */}
          {mode === 'international' && (
            <div className="cef-section">
              <label className="cef-label">{t('intl.proofRequirementsLabel', { ns: 'challenge' })}</label>
              <textarea
                className="cef-input cef-textarea"
                rows={3}
                value={proofRequirements}
                onChange={e => setProofRequirements(e.target.value)}
                placeholder={t('intl.proofRequirementsPlaceholder', { ns: 'challenge' })}
                maxLength={300}
              />
              <p className="cef-hint">{t('intl.proofRequirementsHint', { ns: 'challenge' })}</p>
            </div>
          )}

          {/* Max-participants stepper retired (1:1 model). A challenge serves
              one taker at a time, freeing back to "available" after the meet-
              up - no cap to configure. */}

          {error && <p className="cef-error">{error}</p>}

          {/* Submit - orange brand button (same colour as ChallengeChatPage's accept-btn) */}
          <button
            type="submit"
            className="cef-submit cef-submit--challenge"
            disabled={submitting || !title.trim()}
          >
            {submitting ? '…' : t('create.challengeCta')}
          </button>

          {/* Examples - 3 tappable starters that swap based on the selected
              type. Keeps the screen useful when the user has no idea what
              to write. Tapping fills the input directly (real challenge
              title, not just inspiration). Pulls from the `challenge` ns. */}
          {(() => {
            const examples = t(`examples.${type}`, { ns: 'challenge', returnObjects: true })
            if (!Array.isArray(examples) || examples.length === 0) return null
            return (
              <div className="cef-examples">
                <p className="cef-examples-label">{t('examples.label', { ns: 'challenge' })}</p>
                <div className="cef-examples-grid">
                  {examples.map((ex, i) => (
                    <button
                      key={i}
                      type="button"
                      className="cef-example-chip"
                      onClick={() => setTitle(ex)}
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )
          })()}

        </form>
      </div>

      {cityPickerOpen && (
        <TargetCityPicker
          currentCityChannelId={channelId}
          selected={targetCity}
          onClose={() => setCityPickerOpen(false)}
          onSelect={(c) => { setTargetCity(c); setCityPickerOpen(false) }}
        />
      )}

      {/* Group meet date + place (reuses the schedule picker). */}
      {meetPickerOpen && (
        <DatePickerModal
          submitLabel={t('group.meetSet', { ns: 'challenge', defaultValue: 'Set the meet' })}
          requireEndTime={false}
          initialStartsAt={meetAt}
          initialVenue={meetVenue}
          onClose={() => setMeetPickerOpen(false)}
          onSubmit={(startsAt, endsAt, venue) => {
            setMeetAt(startsAt)
            setMeetEndsAt(endsAt)
            setMeetVenue(venue && venue.trim() ? venue.trim() : null)
            setMeetError(false)
            setMeetPickerOpen(false)
          }}
        />
      )}

      {optinOpen && (
        <PublicOptinModal
          dismissing={optinDismissing}
          onConfirm={handleOptinConfirm}
          onSwitchToFriends={handleOptinSwitchToFriends}
          onClose={() => { setOptinOpen(false); pendingSubmitRef.current = null }}
        />
      )}
    </div>
  )
}

// First-time public opt-in modal. Shown once per user (the
// has_seen_public_optin flag flips on the server when they confirm).
// Switching to Friends from inside the modal does NOT mark optin as
// seen - that's a duck, not a learning event.
function PublicOptinModal({ dismissing, onConfirm, onSwitchToFriends, onClose }) {
  const { t } = useTranslation('challenge')
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel modal-panel--challenge-optin" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">{t('visibility.optin.title')}</h3>
        <p className="modal-body">{t('visibility.optin.body')}</p>
        <div className="modal-actions modal-actions--stack">
          <button
            type="button"
            className="modal-btn modal-btn--primary"
            disabled={dismissing}
            onClick={onConfirm}
          >
            {dismissing ? '…' : t('visibility.optin.cta')}
          </button>
          <button
            type="button"
            className="modal-btn modal-btn--ghost"
            disabled={dismissing}
            onClick={onSwitchToFriends}
          >
            {t('visibility.optin.switchToFriends')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Target city picker (International only) ─────────────────────────────────
// Modal listing every available city (deduped, with the creator's own city
// removed). "🌍 Anywhere" pinned at the top so the creator can clear the
// selection in one click.

function TargetCityPicker({ currentCityChannelId, selected, onClose, onSelect }) {
  const { t } = useTranslation('challenge')
  const [cities,  setCities]  = useState([])
  const [loading, setLoading] = useState(true)
  const [query,   setQuery]   = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    // Web's fetchChannels returns the raw envelope `{channels: [...]}` - NOT
    // a bare array like the mobile client does. Unwrap so the .filter()
    // below operates on a list. Without the unwrap we threw "o.filter is
    // not a function" the moment the picker opened.
    fetchChannels()
      .then(data => { if (active) setCities(Array.isArray(data?.channels) ? data.channels : []) })
      .catch(() => { if (active) setCities([]) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const filtered = useMemo(() => {
    const pool = cities.filter(c => String(c.channelId) !== String(currentCityChannelId))
    const q = query.trim().toLowerCase()
    if (q === '') return pool
    return pool.filter(c =>
      // Web's /channels payload uses `city` (display name) - mobile's
      // fetchChannels remaps it to `name`. Read both so a future shape
      // unification doesn't silently break search.
      (c.city ?? c.name ?? '').toLowerCase().includes(q)
      || (c.country ?? '').toLowerCase().includes(q),
    )
  }, [cities, currentCityChannelId, query])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel cef-city-modal" onClick={e => e.stopPropagation()}>
        <div className="cef-city-modal-head">
          <span className="cef-city-modal-title">{t('intl.cityPicker.title')}</span>
          <button type="button" className="cef-city-modal-close" onClick={onClose}>✕</button>
        </div>
        <input
          type="text"
          className="cef-city-modal-search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('intl.cityPicker.searchPlaceholder')}
        />
        <div className="cef-city-modal-list">
          {loading ? (
            <div className="cef-city-modal-loading">…</div>
          ) : (
            <>
              <button
                type="button"
                className={`cef-city-modal-row${selected === null ? ' selected' : ''}`}
                onClick={() => onSelect(null)}
              >
                <span>🌍  {t('intl.cityPicker.anywhere')}</span>
                {selected === null ? <span aria-hidden="true">✓</span> : null}
              </button>
              {filtered.map(c => {
                const isSel    = selected?.channelId === String(c.channelId)
                const cityName = c.city ?? c.name ?? ''
                return (
                  <button
                    key={c.channelId}
                    type="button"
                    className={`cef-city-modal-row${isSel ? ' selected' : ''}`}
                    onClick={() => onSelect({
                      channelId: String(c.channelId),
                      name:      cityName,
                      country:   c.country,
                    })}
                  >
                    <span>{cityName}{c.country ? ` · ${c.country}` : ''}</span>
                    {isSel ? <span aria-hidden="true">✓</span> : null}
                  </button>
                )
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
