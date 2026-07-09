import { useState, useRef, useEffect } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { authSignup, authLogin, checkUsernameAvailability } from '../api'
import BackButton from './BackButton'

const MODES = [
  { key: 'local',     emoji: '🌍' },
  { key: 'exploring', emoji: '🧭' },
]

export default function AuthScreen({ guestId, guestNickname, onSuccess, onBack, onForgotPassword, initialTab = 'signup' }) {
  const { t } = useTranslation('auth')
  const [tab, setTab]         = useState(initialTab) // 'signup' | 'login'
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [username, setUsername] = useState('')
  const [mode, setMode]       = useState('local') // Local pre-selected by default
  const [eula, setEula]       = useState(false) // EULA - must start UNCHECKED (explicit user action)
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(false)

  // Username availability - debounced check against the backend.
  const [uStatus, setUStatus] = useState('idle') // idle|checking|available|taken|invalid
  const [uReason, setUReason] = useState(null)
  const uTimer = useRef(null)
  const bodyRef = useRef(null)
  // Open the form scrolled to the TOP so the S'inscrire/Se connecter tabs are
  // always visible — on short screens the tall form could otherwise open
  // scrolled down, hiding the tabs.
  useEffect(() => { bodyRef.current?.scrollTo?.(0, 0) }, [tab])

  function handleUsernameChange(val) {
    const cleaned = val.toLowerCase().replace(/[^a-z0-9_]/g, '')
    setUsername(cleaned)
    setUReason(null)
    clearTimeout(uTimer.current)
    if (cleaned.length < 3) { setUStatus(cleaned.length === 0 ? 'idle' : 'invalid'); return }
    setUStatus('checking')
    uTimer.current = setTimeout(async () => {
      try {
        const r = await checkUsernameAvailability(cleaned)
        if (!r.valid)         { setUStatus('invalid');   setUReason(r.reason) }
        else if (r.available) { setUStatus('available') }
        else                  { setUStatus('taken');     setUReason(r.reason) }
      } catch { setUStatus('idle') }
    }, 450)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (tab === 'signup') {
      if (!mode)                 { setError(t('errors.chooseMode')); return }
      if (username.length < 3)   { setError(t('errors.pickUsername')); return }
      if (uStatus === 'taken')   { setError(t('errors.usernameTaken')); return }
      if (uStatus === 'invalid') { setError(uReason || t('errors.usernameInvalid')); return }
      if (!eula)                 { setError(t('errors.acceptTerms')); return }
    }
    setLoading(true)
    try {
      const data = tab === 'signup'
        ? await authSignup(email, password, username, username, guestId, mode, true /* eulaAccepted */)
        : await authLogin(email, password)
      onSuccess(data.user, tab === 'signup')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="full-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{tab === 'signup' ? t('title.signup') : t('title.login')}</span>
      </div>

      <div className="page-body page-body--centered" ref={bodyRef}>
        <div className="auth-tabs">
          <button
            className={`auth-tab${tab === 'signup' ? ' auth-tab--active' : ''}`}
            onClick={() => { setTab('signup'); setError(null) }}
          >{t('tabs.signup')}</button>
          <button
            className={`auth-tab${tab === 'login' ? ' auth-tab--active' : ''}`}
            onClick={() => { setTab('login'); setError(null) }}
          >{t('tabs.login')}</button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {tab === 'signup' && (
            <>

              <div className="modal-field">
                <label className="modal-label">{t('fields.username')}</label>
                <div className="username-input-row">
                  <span className="username-at">@</span>
                  <input
                    className="modal-input username-input"
                    type="text"
                    value={username}
                    onChange={e => handleUsernameChange(e.target.value)}
                    placeholder={t('fields.usernamePlaceholder')}
                    maxLength={20}
                    autoComplete="off"
                    autoCapitalize="none"
                    required
                  />
                </div>
                {uStatus === 'checking'  && <span className="username-hint username-hint--muted">{t('fields.checking')}</span>}
                {uStatus === 'available' && <span className="username-hint username-hint--ok">{t('fields.available', { username })}</span>}
                {(uStatus === 'taken' || uStatus === 'invalid') && uReason && (
                  <span className="username-hint username-hint--bad">{uReason}</span>
                )}
              </div>

              <div className="profile-mode-section">
                <span className="profile-mode-label">{t('mode')}</span>
                <div className="profile-mode-btns">
                  {MODES.map(m => (
                    <button
                      key={m.key}
                      type="button"
                      className={`profile-mode-btn${mode === m.key ? ' profile-mode-btn--on' : ''}`}
                      onClick={() => setMode(m.key)}
                    >
                      <span className="profile-mode-btn-emoji">{m.emoji}</span>
                      <span className="profile-mode-btn-name">{t(`modes.${m.key}`)}</span>
                      <span className="profile-mode-btn-desc">{t(`modes.${m.key}Desc`)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="modal-field">
            <label className="modal-label">{t('fields.email')}</label>
            <input
              className="modal-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={t('fields.emailPlaceholder')}
              required
              autoFocus={tab === 'login'}
            />
          </div>

          <div className="modal-field">
            <label className="modal-label">{t('fields.password')}</label>
            {/* PR32 - show/hide eye toggle. The reveal helps users catch
                typos in a long autocomplete-disabled password field
                (the #1 source of "wrong password" abandons). Type swaps
                between 'password' and 'text'; the input is otherwise
                identical so autofill / password managers still work. */}
            <div className="password-field">
              <input
                className="modal-input password-field-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={tab === 'signup' ? t('fields.passwordPlaceholder') : ''}
                required
              />
              <button
                type="button"
                className="password-field-toggle"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? t('fields.passwordHide', { defaultValue: 'Hide password' }) : t('fields.passwordShow', { defaultValue: 'Show password' })}
                aria-pressed={showPassword}
                tabIndex={-1}
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          {tab === 'signup' && (
            <div className="auth-eula">
              <p className="auth-eula-warning">
                {t('eula.warning')}
              </p>
              <label className="auth-eula-check">
                <input
                  type="checkbox"
                  checked={eula}
                  onChange={e => setEula(e.target.checked)}
                />
                <span>
                  <Trans
                    ns="auth"
                    i18nKey="eula.agree"
                    components={{
                      terms:   <a href="https://hilads.live/terms" target="_blank" rel="noopener noreferrer" />,
                      privacy: <a href="https://hilads.live/privacy" target="_blank" rel="noopener noreferrer" />,
                    }}
                  />
                </span>
              </label>
            </div>
          )}

          {error && <p className="auth-error">{error}</p>}

          <button className="modal-submit" type="submit" disabled={loading}>
            {loading ? '...' : tab === 'signup' ? t('title.signup') : t('title.login')}
          </button>

          {tab === 'login' && onForgotPassword && (
            <button type="button" className="auth-forgot-btn" onClick={onForgotPassword}>
              {t('forgot')}
            </button>
          )}
        </form>

        <p className="profile-hint">{t('guestHint')}</p>
      </div>
    </div>
  )
}
