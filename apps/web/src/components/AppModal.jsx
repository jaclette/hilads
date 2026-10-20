import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import { track } from '../lib/analytics'
import { getLink, storeForAgent, storeLink } from '../lib/storeLinks.mjs'
import Icon from './Icon'

/**
 * "Download the app" (web): every action that needs the app opens this modal
 * first, never a store directly. Title by action ("Download the app to play
 * for Saigon"), "It's free, and it takes a minute.", then one button to the
 * device's store; on desktop, a QR code to hilads.live/get and both store
 * badges. "Keep exploring" closes it. Store links carry the action, the city
 * and the surface (src/lib/storeLinks.mjs).
 *
 * openAppModal({ action, city, cityId, surface }) - action: 'play' (default),
 * 'vote', 'join_plan', 'say_hi', 'propose'; city: the short name shown in the title.
 */
let show = null
let queued = null

export function openAppModal(opts = {}) {
  if (!show) {
    queued = opts
    const host = document.createElement('div')
    document.body.appendChild(host)
    createRoot(host).render(<AppModal />)
    return
  }
  show(opts)
}

const TITLE_WITH_CITY = { play: 'appModal.title.playCity', vote: 'appModal.title.vote', say_hi: 'appModal.title.sayHi' }
const TITLE = { join_plan: 'appModal.title.joinPlan', propose: 'appModal.title.propose' }

function AppModal() {
  const { t } = useTranslation('common')
  const [opts, setOpts] = useState(queued)
  useEffect(() => { show = setOpts; queued = null; return () => { show = null } }, [])

  const action = opts?.action ?? 'play'
  useEffect(() => {
    if (!opts) return
    track('web_app_modal_shown', { action, surface: opts.surface ?? null, city: opts.city ?? null })
    const onKey = (e) => { if (e.key === 'Escape') close('escape') }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [opts]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!opts) return null
  const close = (how) => {
    track('web_app_modal_dismissed', { action, surface: opts.surface ?? null, how })
    setOpts(null)
  }
  const store = storeForAgent(navigator.userAgent || '')
  const link = (s) => storeLink(s, { action, city: opts.city, cityId: opts.cityId, surface: opts.surface })
  const clicked = (s) => () => track('web_store_clicked', { store: s, action, surface: opts.surface ?? null })
  const title = opts.city && TITLE_WITH_CITY[action] ? t(TITLE_WITH_CITY[action], { city: opts.city })
    : TITLE[action] ? t(TITLE[action]) : t('appModal.title.play')

  return (
    <div className="v3-sheet-wrap app-modal-wrap" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="v3-sheet-scrim" onClick={() => close('scrim')} aria-label={t('appModal.keepExploring')} />
      <div className="v3-sheet app-modal">
        <span className="v3-sheet-grabber" aria-hidden="true" />
        <img className="app-modal-icon" src="/logo/icon.svg" alt="" width="56" height="56" />
        <p className="app-modal-title">{title}</p>
        <p className="app-modal-sub">{t('appModal.sub')}</p>
        {store ? (
          <a className="app-modal-cta" href={link(store)} target="_blank" rel="noopener noreferrer" onClick={clicked(store)}>
            <Icon name="download-outline" size={20} />{t('appModal.download')}
          </a>
        ) : (
          <div className="app-modal-desktop">
            <QrCode text={getLink({ action, city: opts.city, cityId: opts.cityId, surface: opts.surface })} />
            <p className="app-modal-scan">{t('appModal.scan')}</p>
            <div className="app-modal-badges">
              <a className="app-modal-badge" href={link('ios')} target="_blank" rel="noopener noreferrer" onClick={clicked('ios')}>
                <AppleLogo />App Store
              </a>
              <a className="app-modal-badge" href={link('android')} target="_blank" rel="noopener noreferrer" onClick={clicked('android')}>
                <PlayLogo />Google Play
              </a>
            </div>
          </div>
        )}
        <button type="button" className="app-modal-keep" onClick={() => close('keep_exploring')}>{t('appModal.keepExploring')}</button>
      </div>
    </div>
  )
}

/** The QR code (desktop only): qrcode-generator, loaded on demand. */
function QrCode({ text }) {
  const [svg, setSvg] = useState(null)
  useEffect(() => {
    let alive = true
    import('qrcode-generator').then(({ default: qrcode }) => {
      const qr = qrcode(0, 'M')
      qr.addData(text)
      qr.make()
      if (alive) setSvg(qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true }))
    }).catch(() => {})
    return () => { alive = false }
  }, [text])
  return <div className="app-modal-qr" aria-hidden="true" dangerouslySetInnerHTML={svg ? { __html: svg } : undefined} />
}

const AppleLogo = () => (
  <svg viewBox="0 0 384 512" width="17" height="20" fill="currentColor" aria-hidden="true" focusable="false">
    <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/>
  </svg>
)
const PlayLogo = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true" focusable="false"><path d="M5 3.5v17a1 1 0 0 0 1.5.86l14-8.5a1 1 0 0 0 0-1.72l-14-8.5A1 1 0 0 0 5 3.5z"/></svg>
)
