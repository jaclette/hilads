import { thumbUrl } from '../lib/imageThumb'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchCityMembers, inviteToChallenge } from '../api'
import { avatarColors } from '../lib/avatarColors'

/**
 * Two-step floating modal shown right after publishing a challenge.
 *
 * Step 1 ("seed"): two CTAs - "Send it to someone in {city}" (opens picker)
 * and "Share outside Hilads" (delegates to host's share handler).
 *
 * Step 2 ("picker"): multi-select list of city members filtered by audience.
 * Submit fires /challenges/:id/invite which creates per-invitee notifications
 * + push (with Accept / Ignore inline actions on native push tray; web push
 * fans out a plain notification with a deep link to the challenge).
 */
export default function ChallengePostCreateModal({
  challenge,
  cityChannelId,
  cityName,
  currentUserId,
  onClose,
  onShare,
}) {
  const { t } = useTranslation('challenge')
  const [step, setStep] = useState('seed') // 'seed' | 'picker'

  if (!challenge) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel challenge-post-create" onClick={e => e.stopPropagation()}>
        {step === 'seed' ? (
          <SeedView
            challenge={challenge}
            cityName={cityName}
            t={t}
            onPickPeople={() => setStep('picker')}
            onShare={() => { onShare?.(); onClose() }}
            onSkip={onClose}
          />
        ) : (
          <PickerView
            challenge={challenge}
            cityChannelId={cityChannelId}
            cityName={cityName}
            currentUserId={currentUserId}
            t={t}
            onDone={onClose}
            onBack={() => setStep('seed')}
          />
        )}
      </div>
    </div>
  )
}

function SeedView({ challenge, cityName, t, onPickPeople, onShare, onSkip }) {
  const city = cityName || t('postCreate.thisCity')
  // International picker pings any city member; audience filter only
  // applies to local challenges (the backend gate matches this).
  const isInternational = (challenge.mode ?? 'local') === 'international'
  const audienceLabel = isInternational
    ? t('aud.members', { defaultValue: 'Members' })
    : (challenge.audience === 'locals' ? t('aud.locals') : t('aud.explorers'))
  return (
    <>
      <div className="cpcm-title">{t('postCreate.title')} 🎯</div>
      <div className="cpcm-sub">{t('postCreate.subtitle')}</div>

      <button type="button" className="cpcm-cta-primary" onClick={onPickPeople}>
        <span className="cpcm-cta-icon" aria-hidden>👥</span>
        <span className="cpcm-cta-body">
          <span className="cpcm-cta-line">{t('postCreate.ctaInvite', { city })}</span>
          <span className="cpcm-cta-sub">{t('postCreate.ctaInviteSub', { audience: audienceLabel })}</span>
        </span>
        <span className="cpcm-cta-arrow" aria-hidden>›</span>
      </button>

      <button type="button" className="cpcm-cta-secondary" onClick={onShare}>
        <span aria-hidden>🔗</span>
        <span>{t('postCreate.ctaShare')}</span>
      </button>

      <button type="button" className="cpcm-skip" onClick={onSkip}>
        {t('postCreate.skip')}
      </button>
    </>
  )
}

function PickerView({ challenge, cityChannelId, cityName, currentUserId, t, onDone, onBack }) {
  // International targets ANYONE in the target city (locals + travelers) -
  // the backend accept gate doesn't check mode for international. Skip the
  // mode filter so the picker doesn't hide half the eligible people.
  const isInternational = (challenge.mode ?? 'local') === 'international'
  const mode = isInternational
    ? undefined
    : (challenge.audience === 'locals' ? 'local' : 'exploring')
  const [members,   setMembers]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const [selected,  setSelected]  = useState(() => new Set())
  const [sending,   setSending]   = useState(false)
  const [sentCount, setSentCount] = useState(null)
  // When the strict mode='local'/'exploring' filter returns no rows (most
  // accounts have mode IS NULL - they joined before mode was a thing) we
  // fall back to the full city roster so the picker isn't a dead-end. We
  // expose `fellBack` to the UI so we can show a small "showing everyone"
  // hint instead of pretending nothing is wrong.
  const [fellBack,  setFellBack]  = useState(false)

  useEffect(() => {
    let active = true
    if (!cityChannelId) {
      // Caller hasn't resolved the city yet (e.g. fetchChallengeById still
      // in flight). Stay in loading state so the cached useEffect re-fires
      // as soon as the prop transitions to a real id; meanwhile leave the
      // members array empty so we don't render stale rows.
      setLoading(true)
      return
    }
    setLoading(true); setError(null); setFellBack(false)

    const filterUsable = (arr) => (arr ?? []).filter(m =>
      m.accountType === 'registered' && m.id !== currentUserId,
    )

    ;(async () => {
      try {
        // International: no mode filter - fetch all members in one pass.
        if (mode === undefined) {
          const all = await fetchCityMembers(cityChannelId, { limit: 50 })
          if (!active) return
          setMembers(filterUsable(all.members))
          return
        }
        // Local: strict mode filter first, fall back to the whole city if
        // empty. Most accounts have mode IS NULL (joined before the picker
        // existed); the accept path re-checks mode and surfaces a clear
        // error if the invitee can't take it on.
        const strict = await fetchCityMembers(cityChannelId, { limit: 50, mode })
        if (!active) return
        let list = filterUsable(strict.members)
        if (list.length === 0) {
          const all = await fetchCityMembers(cityChannelId, { limit: 50 })
          if (!active) return
          list = filterUsable(all.members)
          if (list.length > 0) setFellBack(true)
        }
        setMembers(list)
      } catch (e) {
        if (active) setError(e.message || 'Failed to load')
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => { active = false }
  }, [cityChannelId, mode, currentUserId])

  function toggle(uid) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  async function handleSend() {
    if (selected.size === 0 || sending) return
    setSending(true)
    try {
      const res = await inviteToChallenge(challenge.id, Array.from(selected))
      setSentCount(res.count)
      setTimeout(onDone, 900)
    } catch (e) {
      setError(e.message || 'Failed to send')
      setSending(false)
    }
  }

  // International picker reads "Members in {city}" - both modes welcome.
  const audienceLabel = isInternational
    ? t('aud.members', { defaultValue: 'Members' })
    : (challenge.audience === 'locals' ? t('aud.locals') : t('aud.explorers'))
  const city = cityName || ''

  if (sentCount !== null) {
    return (
      <div className="cpcm-success">
        <div className="cpcm-success-emoji" aria-hidden>🤝</div>
        <div className="cpcm-title">{t('postCreate.sentTitle', { count: sentCount })}</div>
        <div className="cpcm-sub">{t('postCreate.sentSubtitle')}</div>
      </div>
    )
  }

  return (
    <>
      <div className="cpcm-picker-head">
        <button type="button" className="cpcm-back" onClick={onBack} aria-label="Back">‹</button>
        <div>
          <div className="cpcm-title">{t('postCreate.pickerTitle', { audience: audienceLabel, city })}</div>
          <div className="cpcm-sub">
            {fellBack
              ? t('postCreate.pickerSubtitleAll', { city: city || t('postCreate.thisCity') })
              : t('postCreate.pickerSubtitle')}
          </div>
        </div>
      </div>

      <div className="cpcm-list">
        {loading ? (
          <div className="cpcm-loading">…</div>
        ) : error ? (
          <div className="cpcm-error">{error}</div>
        ) : members.length === 0 ? (
          <div className="cpcm-empty">{t('postCreate.pickerEmpty', { audience: audienceLabel.toLowerCase() })}</div>
        ) : (
          members.map(m => {
            const isSel = selected.has(m.id)
            const [c1, c2] = avatarColors(m.id)
            return (
              <button
                key={m.id}
                type="button"
                className={`cpcm-row${isSel ? ' cpcm-row--selected' : ''}`}
                onClick={() => toggle(m.id)}
              >
                {m.avatarUrl || m.thumbAvatarUrl
                  ? <img src={thumbUrl(m.thumbAvatarUrl || m.avatarUrl)} alt="" className="cpcm-avatar" />
                  : <span className="cpcm-avatar" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                      {(m.displayName ?? '?')[0].toUpperCase()}
                    </span>}
                <span className="cpcm-row-info">
                  <span className="cpcm-row-name">{m.displayName}</span>
                  {m.username ? <span className="cpcm-row-handle">@{m.username}</span> : null}
                </span>
                <span className={`cpcm-check${isSel ? ' cpcm-check--on' : ''}`} aria-hidden>
                  {isSel ? '✓' : ''}
                </span>
              </button>
            )
          })
        )}
      </div>

      <button
        type="button"
        className="cpcm-send"
        disabled={selected.size === 0 || sending}
        onClick={handleSend}
      >
        {sending
          ? '…'
          : selected.size === 0
            ? t('postCreate.sendCtaEmpty')
            : t('postCreate.sendCta', { count: selected.size })}
      </button>
    </>
  )
}
