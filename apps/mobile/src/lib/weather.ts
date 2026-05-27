import i18n from '@/i18n';

// Maps the leading weather emoji (variation selector stripped) emitted by the
// backend's WeatherService::buildText() to a localized condition key under
// common.weather.*. The backend owns this closed emoji vocabulary, so the
// mapping is stable. ☀ resolves to "sunnyHot" when temp ≥ 30 (matches backend).
const EMOJI_CONDITION: Record<string, string> = {
  '☀':  'clear',       // code 0, day
  '🌙': 'clearNight',  // code 0/1, night
  '🌤': 'mostlyClear', // code 1, day
  '⛅':  'partly',      // code 2
  '☁':  'overcast',    // code 3
  '🌫': 'fog',         // code 45/48
  '🌦': 'drizzle',     // drizzle / light showers
  '🌧': 'rain',        // rain
  '❄':  'snow',        // snow
  '🌨': 'snowShowers', // snow showers
  '⛈':  'thunder',     // thunderstorm / heavy showers
  '🌡': '',            // unknown weather code — temperature only
};

/**
 * Localized weather pill label, derived from the backend's English weather
 * string (e.g. "☁️ 31°C in Paris — grey skies today"). The weather message is
 * stored once per city and broadcast to all locales, so it can't be localized
 * server-side; instead we read only the leading emoji + temperature — both
 * backend-controlled — and rebuild "{emoji} {temp}°C · {condition}" in the
 * active language. Falls back to the original text (em-dash → middot,
 * " in {city}" stripped) when the emoji isn't recognized.
 */
export function localizeWeather(content?: string | null, cityName?: string | null): string | null {
  if (!content) return null;

  const fallback = (): string => {
    let text = content;
    if (cityName) text = text.replace(` in ${cityName}`, '');
    return text.replace(/\s*—\s*/, ' · ').replace(/\s{2,}/g, ' ').trim();
  };

  const sp = content.indexOf(' ');
  if (sp <= 0) return fallback();

  const emojiRaw = content.slice(0, sp);
  const base = emojiRaw.replace(/[\uFE0E\uFE0F]/g, '');
  const key = EMOJI_CONDITION[base];
  if (key === undefined) return fallback();

  const m = content.match(/(-?\d+)\s*°C/);
  const temp = m ? parseInt(m[1], 10) : null;

  let condKey = key;
  if (base === '☀' && temp != null && temp >= 30) condKey = 'sunnyHot';

  const cond = condKey ? i18n.t(`weather.${condKey}`, { ns: 'common' }) : '';
  const tempStr = temp != null ? `${temp}°C` : '';
  const head = [emojiRaw, tempStr].filter(Boolean).join(' ');

  if (cond && tempStr) return `${head} · ${cond}`;
  if (cond) return `${emojiRaw} ${cond}`;
  return head || fallback();
}
