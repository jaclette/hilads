import { useTranslation } from 'react-i18next'

/**
 * Web mirror of mobile's ChallengePipeline. Visualises the 4-step challenge
 * lifecycle and highlights the viewer's current step. See the mobile
 * component (apps/mobile/src/features/challenge/ChallengePipeline.tsx) for
 * the full design rationale.
 */

const STEPS  = ['accept', 'date', 'meet', 'wrap']
const ICONS  = { accept: '🤝', date: '📅', meet: '👋', wrap: '✨' }

// Compact "sam. 6 juin · 21:30" — locale-aware via Intl using the active
// i18n language (NOT undefined, which falls back to the device locale and
// reads English even for French-speaking users).
function formatMeetupDate(unixSeconds, locale) {
  const d = new Date(unixSeconds * 1000)
  const day  = d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  return `${day} · ${time}`
}

function derive(acceptance, iAmCreator, locale) {
  if (!acceptance) {
    // Visitors don't get a sub-CTA here — the participants row below has the
    // labeled "Take on the challenge" button. Two prompts read as a repeat.
    return {
      active: null,
      done:   new Set(),
      rejected: false,
      subCtaKey: iAmCreator ? 'pipeline.subcta.creatorWaiting' : '',
    }
  }
  const phase  = acceptance.effective_phase ?? acceptance.phase
  const cpName = acceptance.counterparty.displayName

  if (phase === 'accepted') {
    const hasProposal = acceptance.proposed_starts_at != null
    return {
      active: 'date',
      done:   new Set(['accept']),
      rejected: false,
      subCtaKey: hasProposal
        ? (iAmCreator ? 'pipeline.subcta.approveDate' : 'pipeline.subcta.dateAwaiting')
        : 'pipeline.subcta.proposeDate',
    }
  }
  if (phase === 'scheduled') {
    return {
      active: 'meet',
      done: new Set(['accept', 'date']),
      rejected: false,
      subCtaKey: 'pipeline.subcta.meetSoon',
      subCtaDate: acceptance.proposed_starts_at ? formatMeetupDate(acceptance.proposed_starts_at, locale) : undefined,
    }
  }
  if (phase === 'debrief') {
    return {
      active: 'wrap',
      done:   new Set(['accept', 'date', 'meet']),
      rejected: false,
      subCtaKey: iAmCreator ? 'pipeline.subcta.creatorVerdict' : 'pipeline.subcta.acceptorWaitingVerdict',
      subCtaName: cpName,
    }
  }
  if (phase === 'approved') {
    return { active: null, done: new Set(['accept', 'date', 'meet', 'wrap']), rejected: false, subCtaKey: 'pipeline.subcta.accomplished' }
  }
  return { active: null, done: new Set(['accept', 'date', 'meet']), rejected: true, subCtaKey: 'pipeline.subcta.closed' }
}

export default function ChallengePipeline({ acceptance, iAmCreator, onClick }) {
  const { t, i18n } = useTranslation('challenge')
  const state   = derive(acceptance, iAmCreator, i18n.language)
  const interactive = !!onClick && !!acceptance

  return (
    <div
      onClick={interactive ? onClick : undefined}
      style={{
        padding: '8px 16px 10px',
        cursor: interactive ? 'pointer' : 'default',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}
    >
      {/* Dots row */}
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        {STEPS.map((step, i) => {
          const isDone   = state.done.has(step)
          const isActive = state.active === step
          const isReject = state.rejected && step === 'wrap'
          const connectorLit = state.done.has(STEPS[i - 1]) || state.active === step
          return (
            <div key={step} style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {/* Connector from prev dot — inset by DOT_RADIUS so the line
                  stops at each dot's edge instead of crossing through. The
                  dot is 30px wide, so half-width = 15. */}
              {i > 0 && (
                <div style={{
                  position: 'absolute', top: 14, left: '-50%', right: '50%', height: 2,
                  marginLeft: 15, marginRight: 15,
                  background: connectorLit ? '#FF7A3C' : 'rgba(255,255,255,0.10)',
                }} />
              )}
              <div style={{
                width: 30, height: 30, borderRadius: 15,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1.5px solid',
                ...(isReject ? {
                  background: 'var(--bg-2, #1f1a17)', borderColor: 'rgba(255,255,255,0.20)', color: 'var(--muted, #b3b3b3)',
                } : isDone ? {
                  background: '#FF7A3C', borderColor: '#FF7A3C', color: '#fff',
                } : isActive ? {
                  background: 'rgba(255,122,60,0.15)', borderColor: '#FF7A3C', color: '#FF7A3C',
                } : {
                  background: 'var(--bg-2, #1f1a17)', borderColor: 'rgba(255,255,255,0.10)', color: 'var(--muted, #b3b3b3)',
                }),
                position: 'relative', zIndex: 1, fontSize: 14,
              }}>
                {isDone ? '✓' : <span style={{ opacity: isActive ? 1 : 0.45 }}>{ICONS[step]}</span>}
              </div>
              <span style={{
                fontSize: 10, fontWeight: isActive ? 800 : isDone ? 700 : 600,
                color: isActive ? '#FF7A3C' : isDone ? 'var(--text, #fff)' : 'var(--muted, #b3b3b3)',
                marginTop: 4, letterSpacing: 0.2,
              }}>
                {t(`pipeline.step.${step}`)}
              </span>
            </div>
          )
        })}
      </div>

      {/* Sub-CTA — empty key suppresses the row (visitor with no acceptance:
          the labeled accept button below handles the call to action). */}
      {!!state.subCtaKey && (
        <div style={{
          alignSelf: 'center',
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '6px 12px', borderRadius: 999,
          background: 'rgba(255,122,60,0.08)',
          border: '1px solid rgba(255,122,60,0.20)',
        }}>
          <span style={{ color: '#FF7A3C', fontWeight: 700, fontSize: 12 }}>
            {t(state.subCtaKey, {
              ...(state.subCtaName ? { name: state.subCtaName } : {}),
              ...(state.subCtaDate ? { date: state.subCtaDate } : {}),
            })}
          </span>
          {interactive && <span style={{ color: '#FF7A3C', fontSize: 12 }}>›</span>}
        </div>
      )}
    </div>
  )
}
