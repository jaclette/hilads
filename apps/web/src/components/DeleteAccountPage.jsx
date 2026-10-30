import Icon from './Icon'
import { useTranslation } from 'react-i18next'
export default function DeleteAccountPage() {
  const { t } = useTranslation('common')
  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <a href="/" style={styles.logo}>
          <div style={styles.logoMark}><Icon name="earth-outline" size={20} /></div>
          <span style={styles.logoName}>Hilads</span>
        </a>

        <h1 style={styles.title}>{t('deleteAccount.title')}</h1>

        <p style={styles.body}>
          {t('deleteAccount.body')}
        </p>

        <a href="mailto:contact@hilads.live" style={styles.email}>
          contact@hilads.live
        </a>

        <div style={styles.divider} />

        <p style={styles.note}>
          {t('deleteAccount.note')}
        </p>
      </div>

      <footer style={styles.footer}>
        <a href="/" style={styles.footerLink}>{t('deleteAccount.back')}</a>
      </footer>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#0f0d0b',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px 48px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  card: {
    width: '100%',
    maxWidth: '480px',
    backgroundColor: '#1a1612',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '16px',
    padding: '36px 28px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
  },
  logo: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    textDecoration: 'none',
    marginBottom: '28px',
  },
  logoMark: {
    width: '36px',
    height: '36px',
    background: 'var(--primary)',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    color: '#f0ece6',
  },
  logoName: {
    fontSize: '20px',
    fontWeight: '700',
    color: '#f0ece6',
  },
  title: {
    fontSize: 'clamp(22px, 5vw, 28px)',
    fontWeight: '700',
    color: '#f0ece6',
    lineHeight: '1.2',
    marginBottom: '16px',
  },
  body: {
    fontSize: '16px',
    color: 'rgba(240,236,230,0.75)',
    lineHeight: '1.6',
    marginBottom: '16px',
  },
  email: {
    fontSize: '17px',
    fontWeight: '600',
    color: 'var(--primary-text)',
    textDecoration: 'none',
    wordBreak: 'break-all',
  },
  divider: {
    width: '100%',
    height: '1px',
    backgroundColor: 'rgba(255,255,255,0.08)',
    margin: '24px 0',
  },
  note: {
    fontSize: '14px',
    color: 'rgba(240,236,230,0.5)',
    lineHeight: '1.6',
  },
  footer: {
    marginTop: '32px',
    fontSize: '14px',
  },
  footerLink: {
    color: 'rgba(240,236,230,0.4)',
    textDecoration: 'none',
  },
}
