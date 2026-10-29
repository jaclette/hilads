import { useTranslation } from 'react-i18next'

/**
 * A quiet city chat (V3 polish 5, the app's QuickStart): three quick-start
 * chips above the composer, "👋 Hi Saigon!", "Who's around tonight?" and one
 * on today's theme; a tap fills the composer (never sends).
 */
export default function QuickStart({ city, themeKey, onPick }) {
  const { t } = useTranslation('chat')
  const chips = [
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
