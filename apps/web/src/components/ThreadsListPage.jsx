import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchMyAcceptances, fetchRatePrompts } from '../api'
import BackButton from './BackButton'
import RateSheet from './RateSheet'

/**
 * PR2 - "My challenge threads" index. Lists every relationship I'm in
 * (as creator OR acceptor) with last-message preview. Sorted by activity.
 *
 * Reached from the profile drawer / a "My threads" CTA. Mounted by App.jsx
 * with `account`; tapping a row calls `onOpenChallenge(challenge)` which
 * routes to the challenge channel where the inline thread chat lives.
 */

const TYPE_ICONS = { food: '🍜', place: '📍', culture: '🎭', help: '🤝' }

const AVATAR_PALETTES = [
  ['#7c6aff', '#c084fc'], ['#ff6a9f', '#fb7185'], ['#22d3ee', '#38bdf8'],
  ['#4ade80', '#34d399'], ['#fb923c', '#fbbf24'], ['#f472b6', '#e879f9'],
  ['#818cf8', '#60a5fa'], ['#2dd4bf', '#a3e635'],
]
function avatarColors(name = '') {
  const hash = name.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0)
  return AVATAR_PALETTES[hash % AVATAR_PALETTES.length]
}

export default function ThreadsListPage({ account, socket, onBack, onOpenChallenge }) {
  const { t } = useTranslation('challenge')

  const [threads, setThreads] = useState([])
  const [loading, setLoading] = useState(true)
  // PR6 - rate-prompt banner state. Top entry (oldest unrated) is rendered
  // above the threads list; "+N" pill when there's a stack.
  const [ratePrompts,  setRatePrompts]  = useState([])
  const [activePrompt, setActivePrompt] = useState(null)

  const load = useCallback(async () => {
    if (!account?.id) { setThreads([]); setRatePrompts([]); setLoading(false); return }
    try {
      const [thr, prompts] = await Promise.all([fetchMyAcceptances(), fetchRatePrompts()])
      setThreads(thr)
      setRatePrompts(prompts)
    } catch { setThreads([]); setRatePrompts([]) }
    finally { setLoading(false) }
  }, [account?.id])

  useEffect(() => { load() }, [load])

  // Live updates: accept/cancel pushes via user-room.
  useEffect(() => {
    if (!socket) return
    const off1 = socket.on('challenge_accepted',             () => load())
    const off2 = socket.on('challenge_acceptance_cancelled', () => load())
    return () => { off1(); off2() }
  }, [socket, load])

  // Optimistic: drop the just-rated prompt from local state.
  const handleRatingSubmitted = useCallback((challengeId) => {
    setRatePrompts(prev => prev.filter(p => p.challenge_id !== challengeId))
  }, [])

  const topPrompt = ratePrompts[0] ?? null
  const extraPromptCount = Math.max(0, ratePrompts.length - 1)

  if (!account?.id) {
    return (
      <div className="full-page">
        <div className="page-header"><BackButton onClick={onBack} /><span className="page-title">{t('threads.title')}</span></div>
        <div className="page-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 40, gap: 12 }}>
          <span style={{ fontSize: 48 }}>🔒</span>
          <h3 style={{ margin: 0 }}>{t('threads.guestGate.title')}</h3>
          <p style={{ color: 'var(--muted, #b3b3b3)', margin: 0 }}>{t('threads.guestGate.body')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="full-page">
      <div className="page-header"><BackButton onClick={onBack} /><span className="page-title">{t('threads.title')}</span></div>
      <div className="page-body" style={{ padding: 0 }}>
        {topPrompt && (
          <RatePromptBanner
            prompt={topPrompt}
            extraCount={extraPromptCount}
            onClick={() => setActivePrompt(topPrompt)}
            t={t}
          />
        )}
        {loading && threads.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted, #b3b3b3)' }}>…</div>
        ) : threads.length === 0 && !topPrompt ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 40, gap: 12 }}>
            <span style={{ fontSize: 48 }}>🤝</span>
            <h3 style={{ margin: 0 }}>{t('threads.empty.title')}</h3>
            <p style={{ color: 'var(--muted, #b3b3b3)', margin: 0 }}>{t('threads.empty.body')}</p>
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {threads.map(thr => {
              const icon = TYPE_ICONS[thr.challenge_type] ?? '🔥'
              const cp = thr.counterparty
              const [c1, c2] = avatarColors(cp.displayName)
              const preview = thr.last_message_content
                ? (thr.last_message_content.length > 80 ? thr.last_message_content.slice(0, 80) + '…' : thr.last_message_content)
                : t('threads.noMessagesYet')
              return (
                <li key={thr.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <button
                    type="button"
                    onClick={() => onOpenChallenge?.({ id: thr.challenge_id, title: thr.challenge_title, challenge_type: thr.challenge_type })}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 16px', background: 'transparent', border: 'none',
                      color: 'inherit', textAlign: 'left', cursor: 'pointer',
                    }}
                  >
                    <span style={{
                      width: 48, height: 48, borderRadius: 24,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: `linear-gradient(135deg, ${c1}, ${c2})`,
                      color: '#fff', fontWeight: 700, fontSize: 18,
                      overflow: 'hidden', flexShrink: 0,
                    }}>
                      {cp.thumbAvatarUrl
                        ? <img src={cp.thumbAvatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : (cp.displayName ?? '?')[0].toUpperCase()}
                    </span>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text, #fff)' }}>
                        {thr.i_am_creator && <span style={{ color: '#FF7A3C', fontWeight: 800 }}>👑 </span>}
                        {cp.displayName}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--muted, #b3b3b3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {icon} {thr.challenge_title}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--muted-2, #888)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {preview}
                      </span>
                    </div>
                    <span style={{ color: 'var(--muted-2, #888)' }}>›</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <RateSheet
        prompt={activePrompt}
        visible={activePrompt !== null}
        onClose={() => setActivePrompt(null)}
        onSubmitted={handleRatingSubmitted}
      />
    </div>
  )
}

function RatePromptBanner({ prompt, extraCount, onClick, t }) {
  const cp = prompt.counterparty
  const [c1, c2] = avatarColors(cp.displayName)
  const titleKey = prompt.other_rated
    ? 'ratePrompts.banner.titleUrgent'
    : 'ratePrompts.banner.title'
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: 'calc(100% - 32px)',
        margin: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px',
        borderRadius: 14,
        background: 'rgba(255,122,60,0.12)',
        border: '1px solid rgba(255,122,60,0.35)',
        color: 'inherit', textAlign: 'left', cursor: 'pointer',
      }}
    >
      <span style={{
        width: 40, height: 40, borderRadius: 20,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: `linear-gradient(135deg, ${c1}, ${c2})`,
        color: '#fff', fontWeight: 700, fontSize: 16,
        overflow: 'hidden', flexShrink: 0,
      }}>
        {cp.thumbAvatarUrl
          ? <img src={cp.thumbAvatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : (cp.displayName ?? '?')[0].toUpperCase()}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 800, color: 'var(--text, #fff)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          <span style={{ color: '#FFC93C' }}>⭐ </span>
          {t(titleKey, { name: cp.displayName })}
        </div>
        <div style={{
          fontSize: 13, color: 'var(--muted, #b3b3b3)', marginTop: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {prompt.challenge_title}
        </div>
      </div>
      {extraCount > 0 && (
        <span style={{
          padding: '3px 8px', borderRadius: 999,
          background: '#FF7A3C', color: '#fff', fontSize: 11, fontWeight: 800,
        }}>
          +{extraCount}
        </span>
      )}
      <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 18 }}>›</span>
    </button>
  )
}
