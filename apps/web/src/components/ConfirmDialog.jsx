import { useTranslation } from 'react-i18next'

/**
 * Themed in-app alert / confirm dialog. Replaces native window.alert() and
 * window.confirm() — the native ones break the dark theme and read like a
 * browser error rather than an app modal. Matches the UX of mobile's
 * Alert.alert() (system-themed native modal).
 *
 * Pass `null` / `undefined` for `dialog` to keep the modal hidden.
 *
 * dialog shape:
 *   emoji?:     string         — large centered icon
 *   title:      string         — required
 *   body?:      string         — optional secondary line
 *   primary?:   {
 *     label?:        string    — defaults to "OK"
 *     onPress?:      () => void
 *     destructive?:  boolean   — red button instead of brand orange
 *   }
 *   secondary?: {              — presence flips the modal to confirm-mode
 *     label?: string           — defaults to common:cancel ("Cancel")
 *     onPress?: () => void
 *   }
 *
 * Tap on the overlay = secondary action (if present) or dismiss.
 * `onClose` is invoked AFTER `onPress` so the parent can clear state.
 */
export default function ConfirmDialog({ dialog, onClose }) {
  const { t } = useTranslation('common')
  if (!dialog) return null

  const { emoji, title, body, primary, secondary } = dialog
  const primaryLabel = primary?.label ?? 'OK'
  const cancelLabel  = secondary?.label ?? t('cancel', { defaultValue: 'Cancel' })

  const handleDismiss   = () => { onClose?.() }
  const handlePrimary   = () => { primary?.onPress?.(); onClose?.() }
  const handleSecondary = () => { secondary?.onPress?.(); onClose?.() }

  const primaryCls = `challenge-alert-btn ${primary?.destructive ? 'challenge-alert-btn--danger' : 'challenge-alert-btn--primary'}`

  return (
    <div className="modal-overlay" onClick={handleDismiss}>
      <div className="modal-panel challenge-alert-panel" onClick={e => e.stopPropagation()}>
        <div className="challenge-alert-body">
          {emoji && <div className="challenge-alert-emoji">{emoji}</div>}
          <h3 className="challenge-alert-title">{title}</h3>
          {body && <p className="challenge-alert-text">{body}</p>}
        </div>
        <div className="challenge-alert-actions">
          {secondary ? (
            <>
              <button type="button" className="challenge-alert-btn" onClick={handleSecondary}>
                {cancelLabel}
              </button>
              <button type="button" className={primaryCls} onClick={handlePrimary}>
                {primaryLabel}
              </button>
            </>
          ) : (
            <button type="button" className={primaryCls} onClick={handlePrimary}>
              {primaryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
