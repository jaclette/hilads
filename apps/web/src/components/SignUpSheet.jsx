import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { track } from '../lib/analytics'
import { useBackLayer } from '../lib/backLayers'

// The app's reasons (apps/mobile auth-gate); the web's old "view_profile"
// fallback covers anything else.
const REASONS = [
  'view_profile', 'create_event', 'send_dm', 'join_hangout', 'create_hangout',
  'create_challenge', 'accept_challenge', 'join_challenge', 'daily_proof', 'daily_vote', 'daily_comment',
]

/**
 * The sign-up sheet (W5, the app's auth-gate, SPEC 9.9): shown when a guest
 * tries an action that needs an account. One line says why, then Sign up /
 * I have an account / Not now. Auth opens above the current screen, so the
 * guest is back where they were afterwards.
 */
export default function SignUpSheet({ reason, city = null, onAuth, onClose }) {
  useBackLayer(true, onClose)   // browser back closes it
  const { t } = useTranslation('auth')
  const r = REASONS.includes(reason) ? reason : 'view_profile'
  useEffect(() => { track('guest_signup_prompted', { action: r }) }, [r])
  // A vote names its city: "Sign up to vote for Lisbon".
  const title = r === 'daily_vote' && city ? t('sheet.reason.daily_vote_city', { city }) : t(`sheet.reason.${r}`)
  return (
    <div className="v3-sheet-wrap su-wrap" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="v3-sheet-scrim" onClick={onClose} aria-label={t('sheet.notNow')} />
      <div className="v3-sheet su-sheet">
        <span className="v3-sheet-grabber" aria-hidden="true" />
        <img className="v3-mark su-mark" src="/logo/icon.svg" alt="" aria-hidden="true" />
        <h2 className="su-title">{title}</h2>
        <p className="dc-muted su-sub">{t('sheet.comeBack')}</p>
        <button type="button" className="today-cta dc-full" onClick={() => onAuth('signup', r)}>{t('sheet.signUp')}</button>
        <button type="button" className="su-secondary" onClick={() => onAuth('login', r)}>{t('sheet.haveAccount')}</button>
        <button type="button" className="dc-link su-notnow" onClick={onClose}>{t('sheet.notNow')}</button>
      </div>
    </div>
  )
}
