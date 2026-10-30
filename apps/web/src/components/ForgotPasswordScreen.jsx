import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { authForgotPassword } from '../api'
import BackButton from './BackButton'
import Icon from './Icon'

export default function ForgotPasswordScreen({ onBack }) {
  const { t } = useTranslation('auth')
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
      // Still show success - never reveal if email exists
      setSent(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="full-page auth-page">
      <div className="page-header">
        <BackButton onClick={onBack} />
        <span className="page-title">{t('forgotPassword.title')}</span>
      </div>

      <div className="page-body page-body--centered">
        {sent ? (
          <div className="auth-success">
            <p className="auth-success-icon" style={{ color: 'var(--primary-text)' }}><Icon name="mail-outline" size={40} /></p>
            <p className="auth-success-title">{t('forgotPassword.sentTitle')}</p>
            <p className="auth-success-body">
              {t('forgotPassword.sentBody')}
            </p>
            <button className="modal-submit" onClick={onBack} style={{ marginTop: 24 }}>
              {t('forgotPassword.backToSignIn')}
            </button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            <p className="auth-hint-top">
              {t('forgotPassword.subtitle')}
            </p>

            <div className="modal-field">
              <label className="modal-label">{t('forgotPassword.email')}</label>
              <input
                className="modal-input"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t('forgotPassword.emailPlaceholder')}
                required
                autoFocus
              />
            </div>

            {error && <p className="auth-error">{error}</p>}

            <button className="modal-submit" type="submit" disabled={loading}>
              {loading ? '...' : t('forgotPassword.submit')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
