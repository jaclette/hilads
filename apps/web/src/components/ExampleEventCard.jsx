import { useTranslation } from 'react-i18next'
import AvatarWithFlag from './AvatarWithFlag'

/**
 * INERT example card for the zero-activity events empty state. Web mirror of
 * the mobile ExampleEventCard. Reads like a real hangout/event row (name,
 * type, host) but is deliberately NOT joinable:
 *
 *   - The card body is a plain <div>, NOT a button/link. No onClick, no event
 *     id, no route to the remote channel, no RSVP / "going" counter, no time.
 *   - The ONLY interactive element is the bottom button, which routes the
 *     user to LOCAL creation (onCreate) - never to the example's own city.
 *
 * The backend never sends an id (kind/title/host only), so there is
 * structurally nothing to open or join. These are examples of FORMAT, not
 * live invitations - hence no date/going/RSVP.
 */
export default function ExampleEventCard({ example, sourceCity, currentCity, onCreate }) {
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
      <button type="button" className="eec-create-btn" onClick={onCreate}>
        {t('inspiration.openYours', { city: currentCity })}
      </button>
    </div>
  )
}
