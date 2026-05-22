import { useState, useRef } from 'react'
import { authSignup, authLogin, checkUsernameAvailability } from '../api'
import BackButton from './BackButton'

const MODES = [
  { key: 'local',     emoji: '🌍', label: 'Local',     desc: 'You know this city'    },
  { key: 'exploring', emoji: '🧭', label: 'Exploring', desc: "You're discovering it" },
]

export default function AuthScreen({ guestId, guestNickname, onSuccess, onBack, onForgotPassword, initialTab = 'signup' }) {
  const [tab, setTab]         = useState(initialTab) // 'signup' | 'login'
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [mode, setMode]       = useState(null)
  const [eula, setEula]       = useState(false) // EULA — must start UNCHECKED (explicit user action)
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(false)

  // Username availability — debounced check against the backend.
  const [uStatus, setUStatus] = useState('idle') // idle|checking|available|taken|invalid
  const [uReason, setUReason] = useState(null)
  const uTimer = useRef(null)

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
      if (!mode)                 { setError('Please choose a mode to continue'); return }
      if (username.length < 3)   { setError('Pick a username (3+ characters)'); return }
      if (uStatus === 'taken')   { setError('That username is taken'); return }
      if (uStatus === 'invalid') { setError(uReason || 'Invalid username'); return }
      if (!eula)                 { setError('Please accept the Terms of Service and Privacy Policy'); return }
    }
    setLoading(true)
    try {
      const data = tab === 'signup'
        ? await authSignup(email, password, username, username, guestId, mode, true /* eulaAccepted */)
        : await authLogin(email, password)
      onSuccess(data.user)
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
        <span className="page-title">{tab === 'signup' ? 'Create account' : 'Log in'}</span>
      </div>

      <div className="page-body page-body--centered">
        <div className="auth-tabs">
          <button
            className={`auth-tab${tab === 'signup' ? ' auth-tab--active' : ''}`}
            onClick={() => { setTab('signup'); setError(null) }}
          >Sign up</button>
          <button
            className={`auth-tab${tab === 'login' ? ' auth-tab--active' : ''}`}
            onClick={() => { setTab('login'); setError(null) }}
          >Log in</button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {tab === 'signup' && (
            <>

              <div className="modal-field">
                <label className="modal-label">Username</label>
                <div className="username-input-row">
                  <span className="username-at">@</span>
                  <input
                    className="modal-input username-input"
                    type="text"
                    value={username}
                    onChange={e => handleUsernameChange(e.target.value)}
                    placeholder="username"
                    maxLength={20}
                    autoComplete="off"
                    autoCapitalize="none"
                    required
                  />
                </div>
                {uStatus === 'checking'  && <span className="username-hint username-hint--muted">Checking…</span>}
                {uStatus === 'available' && <span className="username-hint username-hint--ok">@{username} is available</span>}
                {(uStatus === 'taken' || uStatus === 'invalid') && uReason && (
                  <span className="username-hint username-hint--bad">{uReason}</span>
                )}
              </div>

              <div className="profile-mode-section">
                <span className="profile-mode-label">Mode</span>
                <div className="profile-mode-btns">
                  {MODES.map(m => (
                    <button
                      key={m.key}
                      type="button"
                      className={`profile-mode-btn${mode === m.key ? ' profile-mode-btn--on' : ''}`}
                      onClick={() => setMode(m.key)}
                    >
                      <span className="profile-mode-btn-emoji">{m.emoji}</span>
                      <span className="profile-mode-btn-name">{m.label}</span>
                      <span className="profile-mode-btn-desc">{m.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="modal-field">
            <label className="modal-label">Email</label>
            <input
              className="modal-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus={tab === 'login'}
            />
          </div>

          <div className="modal-field">
            <label className="modal-label">Password</label>
            <input
              className="modal-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={tab === 'signup' ? 'At least 8 characters' : ''}
              required
            />
          </div>

          {tab === 'signup' && (
            <div className="auth-eula">
              <p className="auth-eula-warning">
                Hilads has zero tolerance for objectionable content or abusive behavior. Violations may result in immediate account termination.
              </p>
              <label className="auth-eula-check">
                <input
                  type="checkbox"
                  checked={eula}
                  onChange={e => setEula(e.target.checked)}
                />
                <span>
                  I agree to the{' '}
                  <a href="https://hilads.live/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>
                  {' '}and{' '}
                  <a href="https://hilads.live/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
                </span>
              </label>
            </div>
          )}

          {error && <p className="auth-error">{error}</p>}

          <button className="modal-submit" type="submit" disabled={loading}>
            {loading ? '...' : tab === 'signup' ? 'Create account' : 'Log in'}
          </button>

          {tab === 'login' && onForgotPassword && (
            <button type="button" className="auth-forgot-btn" onClick={onForgotPassword}>
              Forgot password?
            </button>
          )}
        </form>

        <p className="profile-hint">// your guest messages are kept</p>
      </div>
    </div>
  )
}
