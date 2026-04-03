import { useState, useEffect } from 'react'
import { authValidateResetToken, authResetPassword } from '../api'

export default function ResetPasswordScreen({ token, onSuccess, onRequestNew }) {
  const [valid,    setValid]    = useState(null)  // null=checking, true, false
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [loading,  setLoading]  = useState(false)
  const [done,     setDone]     = useState(false)
  const [error,    setError]    = useState(null)

  useEffect(() => {
    if (!token) { setValid(false); return }
    authValidateResetToken(token).then(setValid).catch(() => setValid(false))
  }, [token])

  async function handleSubmit(e) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8)  { setError('Password must be at least 8 characters'); return }

    setError(null)
    setLoading(true)
    try {
      const data = await authResetPassword(token, password, confirm)
      setDone(true)
      onSuccess?.(data.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Validating token
  if (valid === null) {
    return (
      <div className="full-page">
        <div className="page-body page-body--centered">
          <p className="auth-hint-top" style={{ textAlign: 'center' }}>Checking reset link…</p>
        </div>
      </div>
    )
  }

  // Invalid / expired token
  if (valid === false) {
    return (
      <div className="full-page">
        <div className="page-body page-body--centered">
          <div className="auth-success">
            <p className="auth-success-icon">⚠️</p>
            <p className="auth-success-title">Link expired</p>
            <p className="auth-success-body">
              This reset link is invalid or expired.
            </p>
            <button className="modal-submit" onClick={onRequestNew} style={{ marginTop: 24 }}>
              Request a new link
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Success state
  if (done) {
    return (
      <div className="full-page">
        <div className="page-body page-body--centered">
          <div className="auth-success">
            <p className="auth-success-icon">✅</p>
            <p className="auth-success-title">Password updated</p>
            <p className="auth-success-body">Your password has been updated. You are now signed in.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="full-page">
      <div className="page-header">
        <span className="page-title">Choose a new password</span>
      </div>

      <div className="page-body page-body--centered">
        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="modal-field">
            <label className="modal-label">New password</label>
            <input
              className="modal-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              autoFocus
            />
          </div>

          <div className="modal-field">
            <label className="modal-label">Confirm password</label>
            <input
              className="modal-input"
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat your new password"
              required
            />
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button className="modal-submit" type="submit" disabled={loading}>
            {loading ? '...' : 'Reset password'}
          </button>
        </form>
      </div>
    </div>
  )
}
