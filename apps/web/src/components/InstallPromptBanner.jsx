export default function InstallPromptBanner({
  canInstall = true,
  compact = false,
  instructionText,
  manualHelpVisible,
  onAdd,
  onDismiss,
  withBottomNav = false,
}) {
  if (compact) {
    return (
      <div className="install-banner install-banner--compact">
        <span className="install-banner-compact-text">{instructionText}</span>
        <div className="install-banner-actions">
          {canInstall && (
            <button type="button" className="install-banner-add install-banner-add--compact" onClick={onAdd}>Add</button>
          )}
          <button type="button" className="install-banner-dismiss install-banner-dismiss--compact" onClick={onDismiss} aria-label="Dismiss install prompt">×</button>
        </div>
      </div>
    )
  }

  return (
    <div className={`install-banner${withBottomNav ? ' install-banner--with-nav' : ''}`}>
      <div className="install-banner-copy">
        <p className="install-banner-title">Keep Hilads close</p>
        <p className="install-banner-subtitle">{instructionText}</p>
        {!canInstall && manualHelpVisible && (
          <p className="install-banner-help">{instructionText}</p>
        )}
        {canInstall && manualHelpVisible && (
          <p className="install-banner-help">Open your browser menu and choose Add to Home Screen.</p>
        )}
      </div>
      <div className="install-banner-actions">
        {canInstall && (
          <button type="button" className="install-banner-add" onClick={onAdd}>Add</button>
        )}
        <button type="button" className="install-banner-dismiss" onClick={onDismiss} aria-label="Dismiss install prompt">×</button>
      </div>
    </div>
  )
}
