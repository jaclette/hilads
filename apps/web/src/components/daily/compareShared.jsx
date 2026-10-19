import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchDailyRates } from '../../api'
import { shortCityName } from '../../i18n/cityName'
import { CityFlag } from '../CityName'
import Icon from '../Icon'
import { useDaily } from './dailyShared'

// "Same challenge. Different worlds." on the web (SPEC 10): answers, Back home
// and prices in the viewer's currency. Ports of the app's features/compare.

/** The currency people pay in, per country (backend Currencies::BY_COUNTRY). */
const BY_COUNTRY = { AE: 'AED', AF: 'AFN', AL: 'ALL', AM: 'AMD', AO: 'AOA', AR: 'ARS', AT: 'EUR', AU: 'AUD', AZ: 'AZN', BA: 'BAM', BD: 'BDT', BE: 'EUR', BF: 'XOF', BG: 'EUR', BH: 'BHD', BN: 'BND', BO: 'BOB', BR: 'BRL', BY: 'BYN', CA: 'CAD', CD: 'CDF', CG: 'XAF', CH: 'CHF', CI: 'XOF', CL: 'CLP', CM: 'XAF', CN: 'CNY', CO: 'COP', CR: 'CRC', CU: 'CUP', CY: 'EUR', CZ: 'CZK', DE: 'EUR', DJ: 'DJF', DK: 'DKK', DO: 'DOP', DZ: 'DZD', EC: 'USD', EE: 'EUR', EG: 'EGP', ER: 'ERN', ES: 'EUR', ET: 'ETB', FI: 'EUR', FR: 'EUR', GA: 'XAF', GB: 'GBP', GE: 'GEL', GH: 'GHS', GN: 'GNF', GR: 'EUR', GT: 'GTQ', HK: 'HKD', HR: 'EUR', HU: 'HUF', ID: 'IDR', IE: 'EUR', IL: 'ILS', IN: 'INR', IQ: 'IQD', IR: 'IRR', IS: 'ISK', IT: 'EUR', JO: 'JOD', JP: 'JPY', KE: 'KES', KG: 'KGS', KH: 'KHR', KR: 'KRW', KW: 'KWD', KZ: 'KZT', LA: 'LAK', LB: 'LBP', LK: 'LKR', LT: 'EUR', LU: 'EUR', LV: 'EUR', LY: 'LYD', MA: 'MAD', MC: 'EUR', MD: 'MDL', ME: 'EUR', MG: 'MGA', MK: 'MKD', ML: 'XOF', MM: 'MMK', MN: 'MNT', MO: 'MOP', MT: 'EUR', MU: 'MUR', MV: 'MVR', MW: 'MWK', MX: 'MXN', MY: 'MYR', MZ: 'MZN', NG: 'NGN', NL: 'EUR', NO: 'NOK', NP: 'NPR', NZ: 'NZD', OM: 'OMR', PA: 'USD', PE: 'PEN', PH: 'PHP', PK: 'PKR', PL: 'PLN', PR: 'USD', PT: 'EUR', PY: 'PYG', QA: 'QAR', RO: 'RON', RS: 'RSD', RU: 'RUB', RW: 'RWF', SA: 'SAR', SD: 'SDG', SE: 'SEK', SG: 'SGD', SI: 'EUR', SK: 'EUR', SN: 'XOF', SO: 'SOS', SY: 'SYP', TH: 'THB', TN: 'TND', TR: 'TRY', TW: 'TWD', TZ: 'TZS', UA: 'UAH', UG: 'UGX', US: 'USD', UY: 'UYU', UZ: 'UZS', VE: 'VES', VN: 'VND', ZA: 'ZAR', ZM: 'ZMW', ZW: 'USD' }

function viewerCurrency(cityCountry) {
  if (cityCountry && BY_COUNTRY[cityCountry]) return BY_COUNTRY[cityCountry]
  try {
    const region = new Intl.Locale(navigator.language).maximize().region
    if (region && BY_COUNTRY[region]) return BY_COUNTRY[region]
  } catch { /* fall through */ }
  return 'USD'
}

let cachedRates = null
let pendingRates = null
function loadRates() {
  if (cachedRates) return Promise.resolve(cachedRates)
  pendingRates ??= fetchDailyRates()
    .then(r => (cachedRates = r && Object.keys(r.rates || {}).length ? r : null))
    .catch(() => null)
    .finally(() => { pendingRates = null })
  return pendingRates
}

/** A converted amount, rounded to 3 significant digits from 100 up ("≈ ₫45,000", not ₫45,010). */
export function approx(v) {
  if (v < 100) return Math.round(v * 100) / 100
  const step = 10 ** (Math.floor(Math.log10(v)) - 2)
  return Math.round(v / step) * step
}

export function formatMoney(amount, currency, locale) {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency', currency, currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: amount >= 100 || Number.isInteger(amount) ? 0 : 2,
    }).format(amount)
  } catch {
    return `${amount} ${currency}`
  }
}

/** Prices in the viewer's currency: {fromEur(eur), price(p) → {main, original}}. */
export function useMoney() {
  const { cityCountry } = useDaily()
  const { i18n } = useTranslation()
  const [rates, setRates] = useState(cachedRates)
  useEffect(() => {
    let alive = true
    if (!cachedRates) loadRates().then(r => { if (alive) setRates(r) })
    return () => { alive = false }
  }, [])
  const currency = viewerCurrency(cityCountry)
  const fromEur = (eur) => {
    const r = rates?.rates?.[currency]
    return eur == null || !r ? null : formatMoney(approx(eur * r), currency, i18n.language)
  }
  const price = (p) => {
    const own = formatMoney(p.amount, p.currency, i18n.language)
    if (p.currency === currency) return { main: own, original: null }
    const conv = fromEur(p.eur)
    return conv ? { main: `≈ ${conv}`, original: own } : { main: own, original: null }
  }
  return { currency, fromEur, price }
}

function formatTime(hhmm, locale) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm))
  if (!m) return String(hhmm)
  try {
    return new Date(2000, 0, 1, +m[1], +m[2]).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  } catch {
    return String(hhmm)
  }
}

/** An answer as shown: "Prost!", "37 years", "7:30 PM". */
export function answerText(a, locale) {
  if (!a) return ''
  if (a.type === 'time') return formatTime(a.value, locale)
  if (a.type === 'number') {
    let n = String(a.value)
    try { n = new Intl.NumberFormat(locale).format(Number(a.value)) } catch { /* raw */ }
    return a.unit ? `${n} ${a.unit}` : n
  }
  return String(a.value)
}

/** A proof's answer chip. */
export function AnswerChip({ answer, onDark = false }) {
  const { i18n } = useTranslation()
  if (!answer) return null
  return (
    <span className={`dc-answer${onDark ? ' dc-answer--dark' : ''}`}>
      <Icon name="earth-outline" size={13} />{answerText(answer, i18n.language)}
    </span>
  )
}

/** Back home's split block (SPEC 10.4): "Here in Saigon" / "Back home in Paris", then the line. */
export function BackHomeBlock({ proof }) {
  const { t } = useTranslation('challenge', { keyPrefix: 'dc' })
  const money = useMoney()
  const home = proof.backHome
  if (!home) return null
  const side = (label, country, answer, price, line) => {
    const p = price ? money.price(price) : null
    return (
      <div className="dc-home-side">
        <span className="dc-home-label"><CityFlag country={country} />{label}</span>
        {answer ? <AnswerChip answer={answer} onDark /> : <span className="dc-home-none">-</span>}
        {p && <span className="dc-home-price">{p.main}{p.original && <small>{p.original}</small>}</span>}
        {line && <p className="dc-home-line">{line}</p>}
      </div>
    )
  }
  return (
    <div className="dc-home">
      <div className="dc-home-row">
        {side(t('backHome.hereIn', { city: shortCityName(proof.city?.name ?? '') }), proof.city?.country, proof.answer, proof.price)}
        {side(t('backHome.homeIn', { city: shortCityName(home.city.name) }), home.city.country, home.answer, home.price, home.line)}
      </div>
    </div>
  )
}
