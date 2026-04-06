import { useState } from 'react'
import { authSignup, authLogin } from '../api'
import BackButton from './BackButton'

const MODES = [
  { key: 'local',     emoji: '🌍', label: 'Local',     desc: 'You know this city'    },
  { key: 'exploring', emoji: '🧭', label: 'Exploring', desc: "You're discovering it" },
]

export default function AuthScreen({ guestId, guestNickname, onSuccess, onBack, onForgotPassword, initialTab = 'signup' }) {
  const [tab, setTab]         = useState(initialTab) // 'signup' | 'login'
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [name, setName]       = useState(guestNickname || '')
  const [mode, setMode]       = useState(null)
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (tab === 'signup' && !mode) {
      setError('Please choose a mode to continue')
      return
    }
    setLoading(true)
    try {
      const data = tab === 'signup'
        ? await authSignup(email, password, name, guestId, mode)
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
                <label className="modal-label">Display name</label>
                <input
                  className="modal-input"
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="How you'll appear in the app"
                  maxLength={30}
                  required
                  autoFocus
                />
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
