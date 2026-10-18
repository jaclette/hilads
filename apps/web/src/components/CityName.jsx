import { localizeCityName, shortCityName } from '../i18n/cityName'

const CODE = /^[A-Za-z]{2}$/

/**
 * A city's country flag: an SVG from /flags (4:3, about 16 px wide) with a
 * hairline border so white flags stay visible. It stands for the place, never
 * for a person's nationality, and is decorative: screen readers read the city
 * name next to it. Nothing for a missing or unknown code.
 */
export function CityFlag({ country, size = 16 }) {
  if (typeof country !== 'string' || !CODE.test(country)) return null
  return (
    <img className="city-flag" src={`/flags/${country.toLowerCase()}.svg`} alt="" aria-hidden="true"
         width={size} height={Math.round(size * 0.75)} loading="lazy" decoding="async"
         onError={(e) => { e.currentTarget.style.display = 'none' }} />
  )
}

/** Flag + localized city name; short = the city's short name ("Saigon") where space is tight. */
export function CityName({ name, country, short = false, className = '' }) {
  if (!name) return null
  return (
    <span className={`city-name ${className}`.trim()}>
      <CityFlag country={country} />
      <span className="city-name-text">{short ? shortCityName(name) : localizeCityName(name)}</span>
    </span>
  )
}
