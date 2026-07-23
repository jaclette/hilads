import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { setLocale } from '../i18n'
import { setTheme } from '../lib/theme'
import { updateProfile } from '../api'

// Language list (19 locales), shared by the Me screen for members + guests.
const LANGS = [
  { code: 'en', flag: '🇬🇧', name: 'English'    },
  { code: 'fr', flag: '🇫🇷', name: 'Français'   },
  { code: 'vi', flag: '🇻🇳', name: 'Tiếng Việt' },
  { code: 'es', flag: '🇪🇸', name: 'Español'    },
  { code: 'it', flag: '🇮🇹', name: 'Italiano'   },
  { code: 'pt-br', flag: '🇧🇷', name: 'Português (Brasil)'   },
  { code: 'pt-pt', flag: '🇵🇹', name: 'Português (Portugal)' },
  { code: 'de',    flag: '🇩🇪', name: 'Deutsch'    },
  { code: 'nl',    flag: '🇳🇱', name: 'Nederlands' },
  { code: 'zh-hans', flag: '🇨🇳', name: '简体中文' },
  { code: 'zh-hant', flag: '🇹🇼', name: '繁體中文' },
  { code: 'ja',    flag: '🇯🇵', name: '日本語' },
  { code: 'ko',    flag: '🇰🇷', name: '한국어' },
  { code: 'fil',   flag: '🇵🇭', name: 'Filipino' },
  { code: 'th',    flag: '🇹🇭', name: 'ไทย' },
  { code: 'id',    flag: '🇮🇩', name: 'Bahasa Indonesia' },
  { code: 'hi',    flag: '🇮🇳', name: 'हिन्दी' },
  { code: 'ru',    flag: '🇷🇺', name: 'Русский' },
  { code: 'ar',    flag: '🇸🇦', name: 'العربية' },
]

/**
 * Appearance (light/dark theme) + Language pickers for the Me screen.
 * Available to everyone — pass `account` for members (theme also saves to the DB
 * so it follows the account across devices) or omit it for guests (local only).
 */
export default function AppearanceLanguageCard({ account = null }) {
  const { t, i18n } = useTranslation(['profile', 'common'])
  const [theme, setThemeChoice] = useState(
    () => (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme')) || 'light',
  )
  const [langOpen, setLangOpen] = useState(false)

  const pickTheme = (tv) => {
    setTheme(tv)
    setThemeChoice(tv)
    if (account?.id) updateProfile({ theme: tv }).catch(() => {}) // members: persist to DB
  }

  const cur = LANGS.find(l => l.code === i18n.language) || LANGS[0]

  return (
    <>
      {/* Appearance — light (default) / dark theme toggle. */}
      <div className="profile-mode-section">
        <span className="profile-mode-label">{t('profile:appearance', { defaultValue: 'Appearance' })}</span>
        <div className="profile-mode-btns" role="group" aria-label={t('profile:appearance', { defaultValue: 'Appearance' })}>
          <button
            type="button"
            className={`profile-mode-btn${theme !== 'dark' ? ' profile-mode-btn--on' : ''}`}
            aria-pressed={theme !== 'dark'}
            onClick={() => pickTheme('light')}
          >
            <span className="profile-mode-btn-emoji">☀️</span>
            <span className="profile-mode-btn-name">{t('profile:themeLight', { defaultValue: 'Light' })}</span>
          </button>
          <button
            type="button"
            className={`profile-mode-btn${theme === 'dark' ? ' profile-mode-btn--on' : ''}`}
            aria-pressed={theme === 'dark'}
            onClick={() => pickTheme('dark')}
          >
            <span className="profile-mode-btn-emoji">🌙</span>
            <span className="profile-mode-btn-name">{t('profile:themeDark', { defaultValue: 'Dark' })}</span>
          </button>
        </div>
      </div>

      {/* Language — collapsed to the current language; tap to pick from the list. */}
      <div className="profile-mode-section">
        <span className="profile-mode-label">{t('common:language')}</span>
        <button
          type="button"
          className="profile-lang-trigger"
          onClick={() => setLangOpen(o => !o)}
          aria-expanded={langOpen}
        >
          <span className="profile-lang-trigger-flag">{cur.flag}</span>
          <span className="profile-lang-trigger-name">{cur.name}</span>
          <span className={`profile-lang-chevron${langOpen ? ' profile-lang-chevron--open' : ''}`} aria-hidden="true">▾</span>
        </button>
        {langOpen && (
          <div className="profile-lang-list" role="listbox">
            {LANGS.map(l => (
              <button
                key={l.code}
                type="button"
                role="option"
                aria-selected={i18n.language === l.code}
                className={`profile-lang-item${i18n.language === l.code ? ' profile-lang-item--on' : ''}`}
                onClick={() => { setLocale(l.code); setLangOpen(false) }}
              >
                <span className="profile-lang-item-flag">{l.flag}</span>
                <span className="profile-lang-item-name">{l.name}</span>
                {i18n.language === l.code && <span className="profile-lang-item-check" aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
