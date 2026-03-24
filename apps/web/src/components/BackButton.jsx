export default function BackButton({ onClick, label = null, className = '', title = 'Back', ariaLabel = 'Go back' }) {
  const classes = ['back-button', label ? 'back-button--with-label' : '', className].filter(Boolean).join(' ')

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
    >
      <span className="back-button__icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </span>
      {label && <span className="back-button__label">{label}</span>}
    </button>
  )
}
