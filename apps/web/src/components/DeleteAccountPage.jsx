export default function DeleteAccountPage() {
  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <a href="/" style={styles.logo}>
          <div style={styles.logoMark}>🌍</div>
          <span style={styles.logoName}>Hilads</span>
        </a>

        <h1 style={styles.title}>Delete your account</h1>

        <p style={styles.body}>
          To delete your Hilads account and all associated data, send an email to:
        </p>

        <a href="mailto:jacques.huynh@gmail.com" style={styles.email}>
          jacques.huynh@gmail.com
        </a>

        <div style={styles.divider} />

        <p style={styles.note}>
          Include your username in your request. Your data will be permanently deleted within 48 hours.
        </p>
      </div>

      <footer style={styles.footer}>
        <a href="/" style={styles.footerLink}>Back to Hilads</a>
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
    background: 'linear-gradient(135deg, #FF7A3C, #C24A38)',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
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
    color: '#FF7A3C',
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
