import { useCallback, useEffect, useRef, useState } from 'react'
import BackButton from '../BackButton'
import {
  editTwistProposal, fetchDailyToday, fetchMyProposals, fetchTwistProposal, proposeChallenge, proposeTwist,
  withdrawDailyProposal, withdrawTwistProposal,
} from '../../api'
import { shortCityName } from '../../i18n/cityName'
import { track } from '../../lib/analytics'
import { THEME_KEYS, themeName } from '../map/spotsShared'
import { THEME_ICON } from '../../lib/icons'
import Icon from '../Icon'
import { useDaily, useDc, useCountdown, formatCountdown, useOriginal, OriginalToggle } from './dailyShared'

// Proposals on the web (W2, the app's daily/propose, daily/twist and
// daily/proposals): signed-in only, same API and rules as the app.

const TEXT_MAX  = 120

const ROW = { display: 'inline-flex', alignItems: 'center', gap: 6 }
const LINE = { display: 'flex', alignItems: 'flex-start', gap: 6 }
const WHY_MAX   = 200
const TWIST_MAX = 280

function Page({ title, onBack, children }) {
  return (
    <div className="full-page dc-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{title}</span>
      </div>
      <div className="page-body dc-body">{children}</div>
    </div>
  )
}

/** Propose a Daily Challenge: text (120), theme, why, optional Local Twist for locals of a live city. */
export function ProposeScreen({ source = null, onBack }) {
  const { t, i18n } = useDc()
  const { account, cityId, openDaily, needAccount } = useDaily()
  const [today, setToday] = useState(null)
  const [text, setText]   = useState('')
  const [theme, setTheme] = useState(null)
  const [why, setWhy]     = useState('')
  const [twist, setTwist] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [sent, setSent]   = useState(false)

  useEffect(() => { fetchDailyToday(cityId, i18n.language).then(setToday).catch(() => {}) }, [cityId, i18n.language])

  const tracked = useRef(false)
  useEffect(() => {
    if (!account) { onBack(); needAccount('create_challenge'); return }
    if (tracked.current) return
    tracked.current = true
    track('daily_proposal_started', { entry: source ?? 'unknown', type: 'challenge', platform_surface: 'web' })
  }, [account]) // eslint-disable-line react-hooks/exhaustive-deps

  const canTwist = account?.mode === 'local' && !!today?.city?.isLive
  const cityName = today?.city?.name ? shortCityName(today.city.name) : ''
  const length = [...text.trim()].length
  const canSend = length > 0 && length <= TEXT_MAX && theme !== null && !sending

  const submit = async () => {
    if (!canSend) return
    setSending(true); setError(null)
    try {
      await proposeChallenge({
        text: text.trim(), theme, why: why.trim() || undefined,
        twistText: canTwist && twist.trim() ? twist.trim() : undefined,
      })
      track('daily_proposal_submitted', { theme, has_why: !!why.trim(), has_twist: canTwist && !!twist.trim(), entry: source ?? 'unknown', platform_surface: 'web' })
      setSent(true)
    } catch (err) {
      const code = err.code ?? 'generic'
      setError(code === 'pending_exists' ? 'pending_exists' : t(`propose.errors.${code}`, { defaultValue: t('errors.generic') }))
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <Page title={t('propose.title')} onBack={onBack}>
        <div className="dc-center">
          <span className="dc-big-emoji" style={{ color: 'var(--primary-text)' }}><Icon name="bulb-outline" size={44} /></span>
          <p className="dc-empty-title">{t('propose.sentTitle')}</p>
          <p className="dc-muted">{t('propose.sentBody')}</p>
          <button type="button" className="today-cta dc-full" onClick={() => { onBack(); openDaily('proposals') }}>{t('propose.seeMine')}</button>
        </div>
      </Page>
    )
  }

  return (
    <Page title={t('propose.title')} onBack={onBack}>
      <label className="dc-label" htmlFor="dc-text">{t('propose.textLabel')}</label>
      <textarea id="dc-text" className="dc-input dc-input--tall" value={text} onChange={e => setText(e.target.value)}
                placeholder={t('propose.textPlaceholder')} maxLength={TEXT_MAX + 20} />
      <span className={`dc-counter${length > TEXT_MAX ? ' dc-counter--over' : length > 100 ? ' dc-counter--near' : ''}`}>{length} / {TEXT_MAX}</span>

      <span className="dc-label">{t('propose.themeLabel')}</span>
      <div className="dc-chips">
        {THEME_KEYS.map(k => (
          <button key={k} type="button" className={`wm-chip${theme === k ? ' wm-chip--on' : ''}`} style={ROW} onClick={() => setTheme(k)} aria-pressed={theme === k}>
            <Icon name={THEME_ICON[k]} size={15} />{themeName(k)}
          </button>
        ))}
      </div>

      <label className="dc-label" htmlFor="dc-why">{t('propose.whyLabel')}</label>
      <textarea id="dc-why" className="dc-input" value={why} onChange={e => setWhy(e.target.value)} placeholder={t('propose.whyPlaceholder')} maxLength={WHY_MAX} />

      {canTwist && (
        <>
          <label className="dc-label" htmlFor="dc-twist" style={ROW}><Icon name="location-outline" size={15} />{t('propose.twistLabel', { city: cityName })}</label>
          <textarea id="dc-twist" className="dc-input" value={twist} onChange={e => setTwist(e.target.value)}
                    placeholder={t('propose.twistPlaceholder', { city: cityName })} maxLength={TWIST_MAX} />
        </>
      )}

      <div className="dc-rules">
        <p className="dc-section">{t('propose.rulesTitle')}</p>
        {[1, 2, 3, 4, 5].map(i => <p key={i} className="dc-line" style={LINE}><Icon name="checkmark" size={16} style={{ color: 'var(--green)', marginTop: 2 }} /><span>{t(`propose.rule${i}`)}</span></p>)}
        <p className="dc-muted">{t('propose.reviewed')}</p>
      </div>

      {error === 'pending_exists' ? (
        <div className="dc-error">
          <span>{t('propose.pendingExists')}</span>
          <button type="button" className="dc-link" onClick={() => { onBack(); openDaily('proposals') }}>{t('propose.seeMine')} ›</button>
        </div>
      ) : error && <div className="dc-error">{error}</div>}

      <button type="button" className="today-cta dc-full" onClick={submit} disabled={!canSend}>
        {sending ? '…' : t('propose.submit')}
      </button>
    </Page>
  )
}

/** Tomorrow's Local Twist (locals of a live city): propose, edit or withdraw while open. */
export function TwistScreen({ onBack }) {
  const { t, i18n } = useDc()
  const { account, needAccount } = useDaily()
  const [data, setData]       = useState(null)
  const [failed, setFailed]   = useState(false)
  const [editing, setEditing] = useState(false)
  const [text, setText]       = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError]     = useState(null)
  const [confirm, setConfirm] = useState(false)
  const left = useCountdown(data?.open ? data.closesAt : null)
  const [showOriginal, toggleOriginal] = useOriginal()

  const load = useCallback(async () => {
    try { setData(await fetchTwistProposal(i18n.language)); setFailed(false) } catch { setFailed(true) }
  }, [i18n.language])
  useEffect(() => {
    if (!account) { onBack(); needAccount('create_challenge'); return }
    load()
  }, [account, load]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (left === 0) load() }, [left, load])

  const cityName = data?.city ? shortCityName(data.city.name) : ''
  const showError = (err) => {
    const code = err.code ?? 'generic'
    setError(t(`twist.errors.${code}`, { city: cityName, defaultValue: t('errors.generic') }))
    if (code === 'closed' || code === 'not_editable') load()
  }

  const submit = async () => {
    const value = text.trim()
    if (!data || sending || !value) return
    setSending(true); setError(null)
    try {
      const proposal = data.proposal ? await editTwistProposal(value) : await proposeTwist(value)
      track('daily_twist_proposed', { challenge_date: data.date, city: data.city?.name ?? null, is_local: true, edit: !!data.proposal, platform_surface: 'web' })
      setData({ ...data, proposal }); setEditing(false)
    } catch (err) { showError(err) } finally { setSending(false) }
  }

  const withdraw = async () => {
    setConfirm(false)
    try { await withdrawTwistProposal(); setData(d => ({ ...d, proposal: null })); setText('') } catch (err) { showError(err) }
  }

  const proposal = data?.proposal ?? null
  const canChange = !!data?.open && proposal?.status === 'pending'
  const showForm = !!data?.open && (!proposal || editing)
  const blocked = data?.reason && data.reason !== 'closed' ? data.reason : null

  return (
    <Page title={t('twist.title')} onBack={onBack}>
      {!data && !failed ? <div className="dc-center"><span className="wm-spinner" aria-hidden="true" /></div>
      : failed ? (
        <div className="dc-center"><p className="dc-muted">{t('loadFailed')}</p><button type="button" className="dc-link" onClick={load}>{t('retry')}</button></div>
      ) : blocked ? (
        <div className="dc-center"><Icon name="leaf-outline" size={30} style={{ color: 'var(--muted2)' }} /><p className="dc-empty-title">{t('twist.title')}</p><p className="dc-muted">{t(`twist.reasons.${blocked}`, { city: cityName, defaultValue: t('errors.generic') })}</p></div>
      ) : (
        <>
          <div className="dc-card">
            <span className="today-kicker" style={ROW}><Icon name="flame-outline" size={14} />{t('twist.tomorrow')}</span>
            <p className="today-text">{showOriginal && data.challenge?.original ? data.challenge.original.text : data.challenge?.text}</p>
            {data.challenge?.context && <p className="dc-context">{showOriginal && data.challenge.original ? data.challenge.original.context : data.challenge.context}</p>}
            <OriginalToggle translated={!!data.challenge?.original} showingOriginal={showOriginal} onClick={toggleOriginal} />
          </div>
          <p className="dc-line">{t('twist.intro', { city: cityName })}</p>
          <p className={`dc-countdown${data.open ? '' : ' dc-countdown--warn'}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {data.open && left !== null && <Icon name="time-outline" size={14} />}
            {data.open && left !== null ? t('twist.closesIn', { time: formatCountdown(left) }) : t('twist.closed')}
          </p>

          {proposal && !editing && (
            <div className="dc-practical">
              <p className="dc-section">{t('twist.yours')} · {t(`twist.status.${proposal.status}`)}</p>
              <p className="dc-line">{proposal.text}</p>
              <p className="dc-muted">{t(`twist.statusHint.${proposal.status}`, { city: cityName })}</p>
              {canChange && (
                <div className="dc-actions">
                  <button type="button" className="dc-link" onClick={() => { setText(proposal.text); setEditing(true) }}>{t('edit')}</button>
                  <button type="button" className="dc-link dc-link--danger" onClick={() => setConfirm(true)}>{t('twist.withdraw')}</button>
                </div>
              )}
              {confirm && (
                <div className="dc-error">
                  <span>{t('twist.withdrawBody')}</span>
                  <div className="dc-actions">
                    <button type="button" className="dc-link" onClick={() => setConfirm(false)}>{t('cancel')}</button>
                    <button type="button" className="dc-link dc-link--danger" onClick={withdraw}>{t('twist.withdraw')}</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {showForm && (
            <>
              <label className="dc-label" htmlFor="dc-twist-text">{t('twist.label', { city: cityName })}</label>
              <textarea id="dc-twist-text" className="dc-input dc-input--tall" value={text} onChange={e => setText(e.target.value)}
                        placeholder={t('twist.placeholder')} maxLength={data.maxLength} />
              <span className={`dc-counter${text.length > data.maxLength - 20 ? ' dc-counter--near' : ''}`}>{text.length}/{data.maxLength}</span>
              <p className="dc-muted">{t('twist.hint')}</p>
              {error && <div className="dc-error">{error}</div>}
              <div className="dc-actions">
                {editing && <button type="button" className="dc-link" onClick={() => setEditing(false)}>{t('cancel')}</button>}
                <button type="button" className="today-cta dc-full" onClick={submit} disabled={!text.trim() || sending}>
                  {sending ? '…' : proposal ? t('proof.save') : t('twist.submit')}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </Page>
  )
}

/** My proposals: challenges and Local Twists with their status; withdraw one in review. */
export function ProposalsScreen({ onBack }) {
  const { t, i18n } = useDc()
  const { account, openDaily, needAccount } = useDaily()
  const [items, setItems] = useState(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    try { setItems((await fetchMyProposals(i18n.language)).items); setFailed(false) } catch { setFailed(true) }
  }, [i18n.language])
  useEffect(() => {
    if (!account) { onBack(); needAccount('create_challenge'); return }
    load()
  }, [account, load]) // eslint-disable-line react-hooks/exhaustive-deps

  const withdraw = async (p) => {
    if (!window.confirm(t('propose.withdrawBody'))) return
    try { await withdrawDailyProposal(p.id); load() } catch { /* keep the list */ }
  }

  return (
    <Page title={t('propose.mineTitle')} onBack={onBack}>
      <button type="button" className="today-cta dc-full" style={{ gap: 8 }} onClick={() => openDaily('propose', { source: 'my_proposals' })}><Icon name="bulb-outline" size={18} />{t('propose.cta')}</button>
      {failed && !items ? (
        <div className="dc-center"><p className="dc-muted">{t('loadFailed')}</p><button type="button" className="dc-link" onClick={load}>{t('retry')}</button></div>
      ) : !items ? <div className="dc-center"><span className="wm-spinner" aria-hidden="true" /></div>
      : items.length === 0 ? <p className="dc-muted dc-center">{t('propose.empty')}</p>
      : items.map(item => {
        const date = item.date
          ? new Date(`${item.date}T12:00:00Z`).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
          : ''
        const tone = item.status === 'rejected' || item.status === 'not_picked' ? 'bad' : item.status === 'pending' ? 'wait' : 'ok'
        const canOpen = !!item.date && (item.status === 'published' || item.status === 'picked')
        return (
          <div key={`${item.type}:${item.id}`} className={`dc-practical${canOpen ? ' dc-clickable' : ''}`}
               onClick={canOpen ? () => openDaily('challenge', { date: item.date }) : undefined}>
            <div className="dc-card-top">
              <span className="dc-section" style={ROW}><Icon name={item.type === 'twist' ? 'location-outline' : 'bulb-outline'} size={15} />{item.type === 'twist' ? t('propose.typeTwist') : t('propose.typeChallenge')}</span>
              <span className={`dc-status dc-status--${tone}`}>{t(`propose.status.${item.status}`, { date })}</span>
            </div>
            <p className="dc-line">{item.text}</p>
            <p className="dc-muted">{[themeName(item.theme?.key), item.city ? shortCityName(item.city.name ?? '') : ''].filter(Boolean).join(' · ')}</p>
            {item.twistText && <p className="dc-line" style={LINE}><Icon name="location-outline" size={15} style={{ marginTop: 3 }} /><span>{item.twistText}</span></p>}
            {item.rejectionReason && <p className="dc-reason">{t('propose.reason', { reason: item.rejectionReason })}</p>}
            {item.type === 'challenge' && item.status === 'pending' && (
              <button type="button" className="dc-link dc-link--danger" onClick={(e) => { e.stopPropagation(); withdraw(item) }}>{t('propose.withdraw')}</button>
            )}
          </div>
        )
      })}
    </Page>
  )
}
