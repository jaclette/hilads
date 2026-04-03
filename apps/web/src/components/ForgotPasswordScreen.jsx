import { useState } from 'react'
import { authForgotPassword } from '../api'
import BackButton from './BackButton'

export default function ForgotPasswordScreen({ onBack }) {
  const [email,   setEmail]   = useState('')
  const [loading, setLoading] = useState(false)
  const [sent,    setSent]    = useState(false)
  const [error,   setError]   = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await authForgotPassword(email.trim().toLowerCase())
      setSent(true)
    } catch {
      // Still show success — never reveal if email exists
      setSent(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="full-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">Forgot password?</span>
      </div>

      <div className="page-body page-body--centered">
        {sent ? (
          <div className="auth-success">
            <p className="auth-success-icon">✉️</p>
            <p className="auth-success-title">Check your inbox</p>
            <p className="auth-success-body">
              If an account exists for this email, we've sent a reset link.
              Check your spam folder if you don't see it.
            </p>
            <button className="modal-submit" onClick={onBack} style={{ marginTop: 24 }}>
              Back to sign in
            </button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            <p className="auth-hint-top">
              Enter your email and we'll send you a reset link.
            </p>

            <div className="modal-field">
              <label className="modal-label">Email</label>
              <input
                className="modal-input"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
              />
            </div>

            {error && <p className="auth-error">{error}</p>}

            <button className="modal-submit" type="submit" disabled={loading}>
              {loading ? '...' : 'Send reset link'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
