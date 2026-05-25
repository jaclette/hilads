import { useTranslation } from 'react-i18next'

export default function InstallPromptBanner({
  canInstall = true,
  compact = false,
  instructionText,
  manualHelpVisible,
  onAdd,
  onDismiss,
  withBottomNav = false,
}) {
  const { t } = useTranslation('city')
  if (compact) {
    return (
      <div className="install-banner install-banner--compact">
        <span className="install-banner-compact-text">{instructionText}</span>
        <div className="install-banner-actions">
          {canInstall && (
            <button type="button" className="install-banner-add install-banner-add--compact" onClick={onAdd}>{t('pwa.add')}</button>
          )}
          <button type="button" className="install-banner-dismiss install-banner-dismiss--compact" onClick={onDismiss} aria-label={t('pwa.dismiss')}>×</button>
        </div>
      </div>
    )
  }

  return (
    <div className={`install-banner${withBottomNav ? ' install-banner--with-nav' : ''}`}>
      <div className="install-banner-copy">
        <p className="install-banner-title">{t('pwa.keepClose')}</p>
        <p className="install-banner-subtitle">{instructionText}</p>
        {!canInstall && manualHelpVisible && (
          <p className="install-banner-help">{instructionText}</p>
        )}
        {canInstall && manualHelpVisible && (
          <p className="install-banner-help">{t('pwa.manualHelp')}</p>
        )}
      </div>
      <div className="install-banner-actions">
        {canInstall && (
          <button type="button" className="install-banner-add" onClick={onAdd}>{t('pwa.add')}</button>
        )}
        <button type="button" className="install-banner-dismiss" onClick={onDismiss} aria-label={t('pwa.dismiss')}>×</button>
      </div>
    </div>
  )
}
