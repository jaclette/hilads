import { useTranslation } from 'react-i18next'

/**
 * A quiet city chat (V3 polish 5, the app's QuickStart): three quick-start
 * chips above the composer, "👋 Hi Saigon!", "Who's around tonight?" and one
 * on today's theme; a tap fills the composer (never sends). During an event
 * with its chat chips on (Halloween first), the event's three chips instead.
 */
export default function QuickStart({ city, themeKey, eventKey, onPick }) {
  const { t } = useTranslation('chat')
  const chips = eventKey === 'halloween' ? [
    t('quick.halloween.boo'),
    city ? t('quick.halloween.happy', { city }) : t('quick.halloween.happyNoCity'),
    t('quick.halloween.tonight'),
  ] : [
    city ? t('quick.hi', { city }) : null,
    t('quick.tonight'),
    themeKey ? t(`quick.theme.${themeKey}`, { defaultValue: '' }) : null,
  ].filter(Boolean)
  return (
    <div className="quick-row">
      {chips.map(c => <button key={c} type="button" className="quick-chip" onClick={() => onPick(c)}>{c}</button>)}
    </div>
  )
}
