import { useTranslation } from 'react-i18next'
import AvatarWithFlag from './AvatarWithFlag'

/**
 * Example hangout/event card for the zero-activity inspiration block. Web
 * mirror of the mobile ExampleEventCard. Shows a real active hangout/event from
 * the most-active other city. The card BODY (title + host) opens that
 * event/hangout (onOpen); the bottom button instead routes to LOCAL creation
 * (onCreate).
 */
export default function ExampleEventCard({ example, sourceCity, currentCity, onOpen, onCreate }) {
  const { t } = useTranslation('city')
  const isHangout = example.kind === 'hangout'
  const typeIcon  = isHangout ? '🗣️' : '🎉'
  const typeLabel = isHangout ? t('inspiration.hangout') : t('inspiration.event')
  const name      = example.host_name || '?'

  return (
    <div className="example-event-card">
      <div className="eec-badges">
        <span className="eec-kind-badge">{typeIcon} {typeLabel}</span>
      </div>

      {/* Title + host - clicking opens the real event/hangout. */}
      <button type="button" className="ecc-open" onClick={onOpen}>
        <p className="eec-title">{example.title}</p>
        <div className="eec-by-row">
          <AvatarWithFlag
            userId={null}
            displayName={name}
            photoUrl={example.host_avatar ?? null}
            countryCode={null}
            size={24}
          />
          <span className="eec-by-text">{t('inspiration.by', { name, city: sourceCity })}</span>
        </div>
      </button>

      {/* Create YOUR OWN locally - distinct action from opening. */}
      <button type="button" className="eec-create-btn" onClick={onCreate}>
        {t('inspiration.openYours', { city: currentCity })}
      </button>
    </div>
  )
}
