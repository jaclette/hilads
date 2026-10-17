import { useTranslation } from 'react-i18next'
import Icon from './Icon'

// One-time congrats screen shown right after account creation (not login).
// Friendly + emoji-forward, easy to dismiss (✕ or CTA).
export default function AccountWelcome({ username, onClose }) {
  const { t } = useTranslation('common')
  const features = [
    t('accountWelcome.fc1'),   // local challenge — the primary action
    t('accountWelcome.fc2'),   // international challenge
    t('accountWelcome.f1'),
    t('accountWelcome.f2'),
    t('accountWelcome.f3'),
    t('accountWelcome.f4'),
    t('accountWelcome.f5'),
  ]
  return (
    <div className="account-welcome-overlay" role="dialog" aria-modal="true" aria-label="Welcome">
      <button className="account-welcome-close" onClick={onClose} aria-label={t('close', { defaultValue: 'Close' })}><Icon name="close" size={20} /></button>
      <div className="account-welcome-card">
        <div className="account-welcome-emoji" style={{ color: 'var(--primary-text)' }}><Icon name="sparkles-outline" size={48} /></div>
        <h2 className="account-welcome-title">{t('accountWelcome.title', { username })}</h2>
        <p className="account-welcome-subtitle">{t('accountWelcome.subtitle')}</p>
        <ul className="account-welcome-features">
          {features.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
        <button className="account-welcome-cta" onClick={onClose}>{t('accountWelcome.cta')}</button>
      </div>
    </div>
  )
}
